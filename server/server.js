// ================================================================
// Garment Billing SaaS — Express + MySQL multi-tenant backend
// Row-level tenant isolation: every business query is scoped by
// req.tenant.id. One admin per shop (owner); staff = manager/cashier.
// ================================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const cfg = require("./config");
const { PLANS } = require("./plans");
const rzp = require("./razorpay");
const { initDb, getPool } = require("./db");

const allowedOrigins = [
  "http://localhost:5173",
  "https://garmetns.fillwithbill.com/",
];

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

// ---------------- Security headers ----------------
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );
  next();
});

// ---------------- Simple in-memory rate limiting ----------------
const rlBuckets = new Map();
function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const key =
      (req.ip || "?") + "|" + (req.originalUrl || req.path).split("?")[0];
    const now = Date.now();
    let b = rlBuckets.get(key);
    if (!b || now - b.start > 60000) {
      b = { start: now, n: 0 };
      rlBuckets.set(key, b);
    }
    if (++b.n > maxPerMinute) {
      return res
        .status(429)
        .json({ error: "Too many attempts — please try again in a minute" });
    }
    next();
  };
}
app.use("/api/login", rateLimit(30));
app.use("/api/signup", rateLimit(10));
app.use("/api/platform/login", rateLimit(10));

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent)
      res.status(500).json({ error: e.message || "Server error" });
  }
};

// ---------------- Live subscription plans (managed from the Platform Console) ----------------
// PLANS from plans.js is only the initial seed; runtime source is the subscription_plans table.
let LIVE_PLANS = null;
async function refreshPlans() {
  const [rows] = await getPool().query(
    "SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order, price",
  );
  LIVE_PLANS = Object.fromEntries(
    rows.map((r) => [
      r.plan_key,
      {
        key: r.plan_key,
        name: r.name,
        price: Number(r.price),
        users: r.users_limit,
        products: r.products_limit,
        reports: !!r.reports,
        trialDays: r.trial_days,
        tagline: r.tagline,
      },
    ]),
  );
  return LIVE_PLANS;
}
function getPlans() {
  return LIVE_PLANS || PLANS;
}
function getPlan(key) {
  return (
    getPlans()[key] || {
      key,
      name: key,
      price: 0,
      users: null,
      products: null,
      reports: false,
      trialDays: null,
      tagline: "",
    }
  );
}
// Any active plan except trial can be purchased.
const isPurchasable = (key) => Boolean(getPlans()[key]) && key !== "trial";

// Platform-wide key/value settings (defaults for new shops, etc.)
async function getPlatformSettings() {
  const [rows] = await getPool().query(
    "SELECT skey, svalue FROM platform_settings",
  );
  return Object.fromEntries(rows.map((r) => [r.skey, r.svalue]));
}

// ---------------- Cookies / sessions / auth ----------------
const COOKIE_NAME = "garment_session";
const SESSION_DAYS = 1;

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(
      pair.slice(idx + 1).trim(),
    );
  });
  return out;
}

async function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.tenant_id, u.username, u.name, u.role, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.is_active = 1`,
    [token],
  );
  if (!rows.length) return null;
  if (new Date(rows[0].expires_at) < new Date()) return null;
  return rows[0];
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  );
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await getPool().query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${SESSION_DAYS} DAY))`,
    [token, userId],
  );
  return token;
}

function trialEnded(t) {
  return (
    t.plan === "trial" &&
    t.plan_expires_at &&
    new Date(t.plan_expires_at) < new Date()
  );
}

// A subscription is "ended" when the plan has an expiry date in the past
// (applies to trials and to paid plans whose term has lapsed).
function subscriptionEnded(t) {
  return Boolean(t.plan_expires_at) && new Date(t.plan_expires_at) < new Date();
}

// ---------------- Platform (SaaS operator) auth — stateless signed cookie ----------------
const PLATFORM_USER = process.env.PLATFORM_USER || "platform";
const PLATFORM_PASS = process.env.PLATFORM_PASS || "platform@123";
const OP_SECRET =
  process.env.OPERATOR_SECRET ||
  `gb-op-${cfg.database}-${cfg.password || "dev"}`;
const OP_COOKIE = "garment_op";

function opCookieValue(opId) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const mac = crypto
    .createHmac("sha256", OP_SECRET)
    .update(`op.${opId}.${exp}`)
    .digest("hex");
  return `op.${opId}.${exp}.${mac}`;
}
function opSetCookieHeaders(opId) {
  return [
    `${OP_COOKIE}=${opCookieValue(opId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`,
  ];
}
function opIssue(res, opId) {
  res.setHeader("Set-Cookie", opSetCookieHeaders(opId));
}
// Returns the active operator behind the signed cookie, or null.
async function opUser(req) {
  const t = parseCookies(req)[OP_COOKIE];
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length !== 4 || parts[0] !== "op") return null;
  const [, id, exp, mac] = parts;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(exp) || Number(exp) < Date.now())
    return null;
  const expected = crypto
    .createHmac("sha256", OP_SECRET)
    .update(`op.${id}.${exp}`)
    .digest("hex");
  const a = Buffer.from(String(mac)),
    b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [[u]] = await getPool().query(
    "SELECT id, username, name, is_owner, is_active FROM platform_users WHERE id = ?",
    [Number(id)],
  );
  return u && u.is_active ? u : null;
}

// Gate for every authenticated API call: role (+ trial block on mutations is applied per-route)
const ROLE_RANK = { cashier: 1, manager: 2, admin: 3 };
function chk(req, minRole = "cashier", { mutation = false } = {}) {
  if (!req.user) return { statusCode: 401, error: "Not logged in" };
  if ((ROLE_RANK[req.user.role] || 0) < (ROLE_RANK[minRole] || 0)) {
    return { statusCode: 403, error: `This action needs ${minRole} access` };
  }
  if (mutation && subscriptionEnded(req.tenant)) {
    return {
      statusCode: 402,
      error:
        "Your subscription has ended — renew the plan to continue billing (Billing page).",
    };
  }
  return null;
}
function deny(res, gate) {
  if (gate) {
    res.status(gate.statusCode || 403).json({ error: gate.error });
    return true;
  }
  return false;
}

// API auth: everything under /api needs a session except login/signup/plans.
app.use("/api", async (req, res, next) => {
  try {
    if (
      ["/login", "/signup", "/plans"].includes(req.path) ||
      req.path.startsWith("/platform")
    )
      return next();
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    req.user = user;
    const [[tenant]] = await getPool().query(
      "SELECT * FROM tenants WHERE id = ?",
      [user.tenant_id],
    );
    if (!tenant) return res.status(403).json({ error: "Shop not found" });
    if (tenant.status === "suspended")
      return res
        .status(403)
        .json({ error: "This shop account is suspended. Contact support." });
    req.tenant = tenant;
    next();
  } catch (e) {
    next(e);
  }
});

// Serve built React client (SPA)
const distDir = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(distDir)) app.use(express.static(distDir));

// ---------------- Public: plans & signup ----------------
app.get("/api/plans", (req, res) => res.json(getPlans()));

app.post(
  "/api/signup",
  wrap(async (req, res) => {
    const { shop_name, owner_name, email, phone, password } = req.body || {};
    if (!shop_name?.trim() || !owner_name?.trim() || !email?.trim()) {
      return res
        .status(400)
        .json({ error: "Shop name, your name and email are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: "Enter a valid email address" });
    if (!password || String(password).length < 4)
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters" });

    const pool = getPool();
    const defaults = await getPlatformSettings();
    const defGst = defaults.default_gst_enabled === "0" ? 0 : 1;
    const defFooter =
      defaults.default_receipt_footer || "Thank you for shopping with us!";
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const trialEnds = new Date(
        Date.now() + (getPlans().trial?.trialDays || 14) * 86400000,
      );
      let r;
      try {
        [r] = await conn.execute(
          `INSERT INTO tenants (shop_name, owner_email, phone, plan, plan_expires_at, gst_enabled, receipt_footer) VALUES (?, ?, ?, 'trial', ?, ?, ?)`,
          [
            shop_name.trim(),
            email.trim().toLowerCase(),
            phone || null,
            trialEnds,
            defGst,
            defFooter,
          ],
        );
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") {
          await conn.rollback();
          return res.status(400).json({
            error: "A shop with this email already exists — please log in",
          });
        }
        throw e;
      }
      const tenantId = r.insertId;
      const username = email.trim().toLowerCase();
      try {
        [r] = await conn.execute(
          `INSERT INTO users (tenant_id, username, password_hash, name, role, email, phone) VALUES (?, ?, ?, ?, 'admin', ?, ?)`,
          [
            tenantId,
            username,
            bcrypt.hashSync(String(password), 10),
            owner_name.trim(),
            email.trim(),
            phone || null,
          ],
        );
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") {
          await conn.rollback();
          return res
            .status(400)
            .json({ error: "This email is already registered" });
        }
        throw e;
      }
      const userId = r.insertId;
      for (const name of [
        "T-Shirts",
        "Shirts",
        "Jeans & Trousers",
        "Kurtis",
        "Sarees",
        "Dresses",
        "Kids Wear",
      ]) {
        await conn.execute(
          "INSERT INTO categories (tenant_id, name) VALUES (?, ?)",
          [tenantId, name],
        );
      }
      await conn.commit();
      const token = await createSession(userId);
      setSessionCookie(res, token);
      res.json({
        ok: true,
        user: {
          id: userId,
          username,
          name: owner_name.trim(),
          role: "admin",
          tenant_id: tenantId,
        },
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);

// ---------------- Auth endpoints ----------------
app.post(
  "/api/login",
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Enter username and password" });
    const pool = getPool();
    const uname = String(username).trim().toLowerCase();
    const pwd = String(password).trim();

    // 1) Platform operator? (single login for everyone — operators go to the console)
    const [[op]] = await pool.query(
      "SELECT * FROM platform_users WHERE username = ?",
      [uname],
    );
    if (op) {
      if (!bcrypt.compareSync(pwd, op.password_hash))
        return res.status(401).json({ error: "Invalid username or password" });
      if (!op.is_active)
        return res
          .status(403)
          .json({ error: "This operator account is disabled" });
      await pool.query(
        "UPDATE platform_users SET last_login = NOW() WHERE id = ?",
        [op.id],
      );
      // clear any shop session cookie so identities never mix
      res.setHeader("Set-Cookie", [
        `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        ...opSetCookieHeaders(op.id),
      ]);
      return res.json({
        ok: true,
        operator: true,
        user: {
          id: op.id,
          username: op.username,
          name: op.name,
          role: op.is_owner ? "owner" : "operator",
        },
      });
    }

    // 2) Shop user
    const [rows] = await pool.query(
      `SELECT u.*, t.status shop_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.username = ?`,
      [uname],
    );
    if (!rows.length || !bcrypt.compareSync(pwd, rows[0].password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (!rows[0].is_active)
      return res.status(403).json({ error: "This account is disabled" });
    if (rows[0].shop_status === "suspended")
      return res
        .status(403)
        .json({ error: "This shop account is suspended. Contact support." });

    const token = await createSession(rows[0].id);
    await pool.query("UPDATE users SET last_login = NOW() WHERE id = ?", [
      rows[0].id,
    ]);
    setSessionCookie(res, token);
    res.json({
      ok: true,
      user: {
        id: rows[0].id,
        username: rows[0].username,
        name: rows[0].name,
        role: rows[0].role,
        tenant_id: rows[0].tenant_id,
      },
    });
  }),
);

app.post(
  "/api/logout",
  wrap(async (req, res) => {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token)
      await getPool().query("DELETE FROM sessions WHERE token = ?", [token]);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    res.json({ ok: true });
  }),
);

function tenantSummary(t) {
  const plan = getPlan(t.plan);
  let daysLeft = null;
  if (t.plan_expires_at) {
    daysLeft = Math.max(
      0,
      Math.ceil((new Date(t.plan_expires_at) - new Date()) / 86400000),
    );
  }
  return {
    plan: t.plan,
    plan_name: plan.name,
    price: plan.price,
    trial_days_left: t.plan === "trial" ? daysLeft : null,
    days_left: daysLeft,
    trial_ended: trialEnded(t),
    plan_expired: subscriptionEnded(t),
  };
}

app.get(
  "/api/me",
  wrap(async (req, res) => {
    const pool = getPool();
    const [[u]] = await pool.query(
      `SELECT id, tenant_id, username, name, role, email, phone, avatar_color, last_login, created_at FROM users WHERE id = ?`,
      [req.user.id],
    );
    const [[{ sessions }]] = await pool.query(
      "SELECT COUNT(*) sessions FROM sessions WHERE user_id = ? AND expires_at > NOW()",
      [u.id],
    );
    res.json({
      ...u,
      active_sessions: sessions,
      shop_name: req.tenant.shop_name,
      ...tenantSummary(req.tenant),
    });
  }),
);

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#334155",
  "#f97316",
];

app.put(
  "/api/me/profile",
  wrap(async (req, res) => {
    const { name, username, email, phone, avatar_color } = req.body || {};
    if (!name?.trim())
      return res.status(400).json({ error: "Full name is required" });
    const uname = String(username || "")
      .trim()
      .toLowerCase();
    if (!uname) return res.status(400).json({ error: "Username is required" });
    if (!/^[a-z0-9_.@-]{3,120}$/.test(uname))
      return res.status(400).json({ error: "Invalid username format" });
    const color = AVATAR_COLORS.includes(avatar_color) ? avatar_color : null;
    try {
      await getPool().execute(
        "UPDATE users SET name=?, username=?, email=?, phone=?, avatar_color=? WHERE id=?",
        [
          name.trim(),
          uname,
          email?.trim() || null,
          phone?.trim() || null,
          color,
          req.user.id,
        ],
      );
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res
          .status(400)
          .json({ error: "That username is already taken" });
      throw e;
    }
    res.json({ ok: true });
  }),
);

app.put(
  "/api/me/password",
  wrap(async (req, res) => {
    const { current, next } = req.body || {};
    if (!next || String(next).length < 4)
      return res
        .status(400)
        .json({ error: "New password must be at least 4 characters" });
    const pool = getPool();
    const [[u]] = await pool.query(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.user.id],
    );
    if (!bcrypt.compareSync(String(current || ""), u.password_hash))
      return res.status(400).json({ error: "Current password is incorrect" });
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
      bcrypt.hashSync(String(next), 10),
      req.user.id,
    ]);
    res.json({ ok: true });
  }),
);

// ---------------- Billing (plan & usage) ----------------
app.get(
  "/api/billing",
  wrap(async (req, res) => {
    let g = chk(req, "admin");
    if (deny(res, g)) return;
    const pool = getPool();
    const t = req.tenant,
      plan = getPlan(t.plan);
    const [[{ products }]] = await pool.query(
      "SELECT COUNT(*) products FROM products WHERE tenant_id=? AND is_active=1",
      [t.id],
    );
    const [[{ users }]] = await pool.query(
      "SELECT COUNT(*) users FROM users WHERE tenant_id=?",
      [t.id],
    );
    const [[{ sales30 }]] = await pool.query(
      `SELECT COUNT(*) sales30 FROM sales WHERE tenant_id=? AND status='completed' AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
      [t.id],
    );
    const [orders] = await pool.query(
      `SELECT id, plan, amount, currency, gateway, status, created_at, paid_at FROM billing_orders WHERE tenant_id=? ORDER BY id DESC LIMIT 8`,
      [t.id],
    );
    res.json({
      ...tenantSummary(t),
      plan_details: plan,
      expires_at: t.plan_expires_at,
      shop_created: t.created_at,
      usage: {
        products: { used: products, limit: plan.products },
        users: { used: users, limit: plan.users },
      },
      features: { reports: plan.reports },
      sales_last_30: sales30,
      plans: getPlans(),
      gateway: {
        provider: rzp.configured() ? "razorpay" : "demo",
        key_id: rzp.configured() ? rzp.keyId() : null,
      },
      orders,
    });
  }),
);

// Block a switch to `targetKey` when current usage exceeds that plan's limits.
async function usageExceeds(pool, tenantId, targetKey) {
  const target = getPlan(targetKey);
  const [[{ users }]] = await pool.query(
    "SELECT COUNT(*) users FROM users WHERE tenant_id=?",
    [tenantId],
  );
  if (target.users && users > target.users) {
    return `You currently have ${users} user logins but the ${target.name} plan allows only ${target.users}. Remove user logins first, then switch.`;
  }
  const [[{ products }]] = await pool.query(
    "SELECT COUNT(*) products FROM products WHERE tenant_id=? AND is_active=1",
    [tenantId],
  );
  if (target.products && products > target.products) {
    return `You currently have ${products} active products but the ${target.name} plan allows only ${target.products}. Reduce products first, then switch.`;
  }
  return null;
}

function activatePlan(pool, tenantId, planKey) {
  // Paid plans run one 30-day billing cycle; renewing repeats the purchase.
  return pool.execute(
    `UPDATE tenants SET plan=?, plan_expires_at=DATE_ADD(NOW(), INTERVAL 30 DAY), status='active' WHERE id=?`,
    [planKey, tenantId],
  );
}

// Start a purchase. With live Razorpay keys this creates a gateway order;
// without keys it returns a demo order the client confirms directly.
app.post(
  "/api/billing/checkout",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: false });
    if (deny(res, g)) return;
    const { plan } = req.body || {};
    if (!isPurchasable(plan))
      return res.status(400).json({ error: "Choose a valid plan" });
    const t = req.tenant,
      pool = getPool();
    const expiringSoon =
      t.plan_expires_at &&
      new Date(t.plan_expires_at) - new Date() < 7 * 86400000;
    const renewal = t.plan === plan && (subscriptionEnded(t) || expiringSoon);
    if (t.plan === plan && !renewal)
      return res.status(400).json({ error: "You are already on this plan" });
    const over = await usageExceeds(pool, t.id, plan);
    if (over) return res.status(400).json({ error: over });

    const amount = getPlan(plan).price * 100; // paise
    if (rzp.configured()) {
      let order;
      try {
        order = await rzp.createOrder({
          amountPaise: amount,
          receipt: `tenant_${t.id}_${plan}_${Date.now()}`,
          notes: { tenant_id: String(t.id), plan },
        });
      } catch (e) {
        return res
          .status(e.status || 502)
          .json({ error: "Payment gateway error: " + e.message });
      }
      const [r] = await pool.execute(
        `INSERT INTO billing_orders (tenant_id, plan, amount, currency, gateway, gateway_order_id, status) VALUES (?,?,?,?, 'razorpay', ?, 'created')`,
        [t.id, plan, amount, "INR", order.id],
      );
      return res.json({
        id: r.insertId,
        mode: "razorpay",
        key_id: rzp.keyId(),
        gateway_order_id: order.id,
        amount,
        currency: "INR",
        plan,
      });
    }
    const [r] = await pool.execute(
      `INSERT INTO billing_orders (tenant_id, plan, amount, currency, gateway, status) VALUES (?,?,?,?, 'demo', 'created')`,
      [t.id, plan, amount, "INR"],
    );
    res.json({ id: r.insertId, mode: "demo", amount, currency: "INR", plan });
  }),
);

// Confirm a purchase. Razorpay orders: verify the checkout signature. Demo orders: activate instantly.
app.post(
  "/api/billing/verify",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: false });
    if (deny(res, g)) return;
    const { order_id, payment_id, signature } = req.body || {};
    const pool = getPool();
    const [[order]] = await pool.query(
      "SELECT * FROM billing_orders WHERE id=? AND tenant_id=?",
      [Number(order_id), req.tenant.id],
    );
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === "paid")
      return res.json({ ok: true, already_paid: true, plan: order.plan });

    if (order.gateway === "razorpay") {
      if (!rzp.configured())
        return res.status(400).json({ error: "Gateway not configured" });
      if (!rzp.verifySignature(order.gateway_order_id, payment_id, signature)) {
        await pool.execute(
          `UPDATE billing_orders SET status='failed' WHERE id=?`,
          [order.id],
        );
        return res
          .status(400)
          .json({ error: "Payment signature verification failed" });
      }
    }
    await activatePlan(pool, req.tenant.id, order.plan);
    await pool.execute(
      `UPDATE billing_orders SET status='paid', gateway_payment_id=?, paid_at=NOW() WHERE id=?`,
      [
        payment_id || (order.gateway === "demo" ? "demo-" + Date.now() : null),
        order.id,
      ],
    );
    res.json({
      ok: true,
      plan: order.plan,
      message: `You are now on the ${getPlan(order.plan).name} plan`,
    });
  }),
);

// Manual activation (demo mode + support workflows via the platform console).
app.post(
  "/api/billing/upgrade",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: false });
    if (deny(res, g)) return;
    const { plan } = req.body || {};
    if (!isPurchasable(plan))
      return res.status(400).json({ error: "Choose a valid plan" });
    const over = await usageExceeds(getPool(), req.tenant.id, plan);
    if (over) return res.status(400).json({ error: over });
    await activatePlan(getPool(), req.tenant.id, plan);
    res.json({ ok: true, plan });
  }),
);

// ---------------- Users (admin; single admin per shop) ----------------
app.get(
  "/api/users",
  wrap(async (req, res) => {
    const g = chk(req, "admin");
    if (deny(res, g)) return;
    const [rows] = await getPool().query(
      `SELECT id, username, name, role, email, phone, avatar_color, is_active, last_login, created_at
     FROM users WHERE tenant_id = ? ORDER BY role, username`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);

app.post(
  "/api/users",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const { username, password, name, role, email, phone } = req.body || {};
    if (!username || !password || !name)
      return res
        .status(400)
        .json({ error: "Username, password and name are required" });
    if (String(password).length < 4)
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters" });
    if (!["manager", "cashier"].includes(role)) {
      return res.status(400).json({
        error:
          "Each shop has exactly one admin (the owner). Staff can be Manager or Cashier.",
      });
    }
    const plan = getPlan(req.tenant.plan);
    const pool = getPool();
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) n FROM users WHERE tenant_id = ?",
      [req.tenant.id],
    );
    if (plan.users && n + 1 > plan.users) {
      return res.status(403).json({
        error: `The ${plan.name} plan allows ${plan.users} user(s). Upgrade to add more.`,
      });
    }
    try {
      const [r] = await pool.execute(
        "INSERT INTO users (tenant_id, username, password_hash, name, role, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          req.tenant.id,
          String(username).trim().toLowerCase(),
          bcrypt.hashSync(String(password), 10),
          name.trim(),
          role,
          email?.trim() || null,
          phone?.trim() || null,
        ],
      );
      res.json({ id: r.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "Username already exists" });
      throw e;
    }
  }),
);

app.put(
  "/api/users/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const { name, role, is_active, password, email, phone } = req.body || {};
    const pool = getPool();
    const id = Number(req.params.id);
    const [[target]] = await pool.query(
      "SELECT * FROM users WHERE id = ? AND tenant_id = ?",
      [id, req.tenant.id],
    );
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "admin") {
      // The shop admin (owner) record cannot be demoted/disabled from here
      if (role !== undefined && role !== "admin")
        return res
          .status(400)
          .json({ error: "The shop admin cannot be demoted" });
      if (is_active !== undefined && !is_active)
        return res
          .status(400)
          .json({ error: "The shop admin cannot be disabled" });
    }
    if (role !== undefined && role === "admin")
      return res
        .status(400)
        .json({ error: "Each shop has exactly one admin (the owner)" });
    try {
      if (name !== undefined)
        await pool.query("UPDATE users SET name = ? WHERE id = ?", [
          name.trim(),
          id,
        ]);
      if (role !== undefined)
        await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, id]);
      if (is_active !== undefined)
        await pool.query("UPDATE users SET is_active = ? WHERE id = ?", [
          is_active ? 1 : 0,
          id,
        ]);
      if (email !== undefined)
        await pool.query("UPDATE users SET email = ? WHERE id = ?", [
          email?.trim() || null,
          id,
        ]);
      if (phone !== undefined)
        await pool.query("UPDATE users SET phone = ? WHERE id = ?", [
          phone?.trim() || null,
          id,
        ]);
      if (password)
        await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
          bcrypt.hashSync(String(password), 10),
          id,
        ]);
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "Username already exists" });
      throw e;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/users/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const id = Number(req.params.id);
    if (id === req.user.id)
      return res
        .status(400)
        .json({ error: "You cannot delete your own account" });
    const pool = getPool();
    const [[target]] = await pool.query(
      "SELECT role FROM users WHERE id = ? AND tenant_id = ?",
      [id, req.tenant.id],
    );
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "admin")
      return res
        .status(400)
        .json({ error: "The shop admin cannot be deleted" });
    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ ok: true });
  }),
);

// ---------------- Dashboard ----------------
app.get(
  "/api/dashboard",
  wrap(async (req, res) => {
    const T = req.tenant.id,
      pool = getPool();
    const q = async (sql, p = []) => (await pool.query(sql, p))[0];

    const [[today]] = await pool.query(
      `SELECT COUNT(*) c, IFNULL(SUM(total),0) t FROM sales WHERE tenant_id=? AND DATE(sale_date)=CURDATE() AND status='completed'`,
      [T],
    );
    const [[month]] = await pool.query(
      `SELECT COUNT(*) c, IFNULL(SUM(total),0) t FROM sales WHERE tenant_id=? AND status='completed' AND YEAR(sale_date)=YEAR(CURDATE()) AND MONTH(sale_date)=MONTH(CURDATE())`,
      [T],
    );
    const [[stock]] = await pool.query(
      `SELECT COUNT(*) skus, IFNULL(SUM(stock),0) units, IFNULL(SUM(stock*cost_price),0) cost_value, IFNULL(SUM(stock*sale_price),0) retail_value FROM products WHERE tenant_id=? AND is_active=1`,
      [T],
    );
    const [[low]] = await pool.query(
      `SELECT COUNT(*) c FROM products WHERE tenant_id=? AND is_active=1 AND stock <= low_stock_alert`,
      [T],
    );
    const [[cust]] = await pool.query(
      `SELECT COUNT(*) c FROM customers WHERE tenant_id=?`,
      [T],
    );

    const rows14 = await q(
      `SELECT DATE(sale_date) d, SUM(total) t, COUNT(*) c FROM sales
                          WHERE tenant_id=? AND status='completed' AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(sale_date)`,
      [T],
    );
    const map = Object.fromEntries(rows14.map((r) => [r.d, r]));
    const labels = [],
      salesTrend = [],
      countTrend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(
        d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      );
      salesTrend.push(Number(map[key]?.t || 0));
      countTrend.push(Number(map[key]?.c || 0));
    }

    const topProducts = await q(
      `SELECT si.product_name name, SUM(si.qty) qty, SUM(si.amount) amount
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.tenant_id=? AND s.status='completed' AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
    GROUP BY si.product_name ORDER BY qty DESC LIMIT 5`,
      [T],
    );

    const categorySales = await q(
      `SELECT IFNULL(c.name,'Uncategorised') name, SUM(si.amount) amount
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE s.tenant_id=? AND s.status='completed' AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
    GROUP BY c.name ORDER BY amount DESC`,
      [T],
    );

    const paymentSplit = await q(
      `SELECT payment_method m, COUNT(*) c, SUM(total) t FROM sales
    WHERE tenant_id=? AND status='completed' AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) GROUP BY payment_method`,
      [T],
    );

    const recent = await q(
      `SELECT s.id, s.invoice_no, s.sale_date, s.total, s.payment_method, s.status,
    IFNULL(cu.name,'Walk-in Customer') customer, (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) items
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id
    WHERE s.tenant_id=? AND s.status='completed' ORDER BY s.id DESC LIMIT 6`,
      [T],
    );

    const lowStockList = await q(
      `SELECT id, name, size, color, sku, stock, low_stock_alert FROM products
    WHERE tenant_id=? AND is_active=1 AND stock <= low_stock_alert ORDER BY stock ASC LIMIT 8`,
      [T],
    );

    res.json({
      kpi: {
        todaySales: Number(today.t),
        todayInvoices: today.c,
        monthSales: Number(month.t),
        monthInvoices: month.c,
        skus: stock.skus,
        stockUnits: stock.units,
        costValue: Number(stock.cost_value),
        retailValue: Number(stock.retail_value),
        lowStock: low.c,
        customers: cust.c,
      },
      trend: { labels, sales: salesTrend, invoices: countTrend },
      topProducts,
      categorySales,
      paymentSplit,
      recent,
      lowStockList,
    });
  }),
);

// ---------------- Categories ----------------
app.get(
  "/api/categories",
  wrap(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) products FROM categories c WHERE c.tenant_id=? ORDER BY c.name`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);
app.post(
  "/api/categories",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const { name, description } = req.body;
    if (!name?.trim())
      return res.status(400).json({ error: "Category name is required" });
    try {
      const [r] = await getPool().execute(
        "INSERT INTO categories (tenant_id, name, description) VALUES (?, ?, ?)",
        [req.tenant.id, name.trim(), description || null],
      );
      res.json({ id: r.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "Category already exists" });
      throw e;
    }
  }),
);
app.put(
  "/api/categories/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const { name, description } = req.body;
    const [r] = await getPool().execute(
      "UPDATE categories SET name=?, description=? WHERE id=? AND tenant_id=?",
      [name?.trim(), description || null, req.params.id, req.tenant.id],
    );
    if (!r.affectedRows)
      return res.status(404).json({ error: "Category not found" });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/categories/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const pool = getPool();
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) n FROM products WHERE category_id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    if (n > 0)
      return res.status(400).json({
        error: `Cannot delete: ${n} product(s) still use this category`,
      });
    await pool.execute("DELETE FROM categories WHERE id=? AND tenant_id=?", [
      req.params.id,
      req.tenant.id,
    ]);
    res.json({ ok: true });
  }),
);

// ---------------- Products ----------------
app.get(
  "/api/products",
  wrap(async (req, res) => {
    const { q, category_id, low } = req.query;
    let sql = `SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.tenant_id=? AND p.is_active=1`;
    const params = [req.tenant.id];
    if (category_id) {
      sql += " AND p.category_id=?";
      params.push(category_id);
    }
    if (low === "1") sql += " AND p.stock <= p.low_stock_alert";
    if (q) {
      sql +=
        " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ? OR p.color LIKE ?)";
      const t = `%${q}%`;
      params.push(t, t, t, t, t);
    }
    sql += " ORDER BY p.name, p.size";
    res.json((await getPool().query(sql, params))[0]);
  }),
);

app.get(
  "/api/products/lookup",
  wrap(async (req, res) => {
    const code = (req.query.code || "").trim();
    if (!code) return res.status(400).json({ error: "Enter a barcode or SKU" });
    const [rows] = await getPool().query(
      `SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.tenant_id=? AND p.is_active=1 AND (p.barcode=? OR p.sku=?) LIMIT 1`,
      [req.tenant.id, code, code.toUpperCase()],
    );
    if (!rows.length)
      return res.status(404).json({ error: `No product found for "${code}"` });
    res.json(rows[0]);
  }),
);

app.get(
  "/api/products/:id",
  wrap(async (req, res) => {
    const [rows] = await getPool().query(
      "SELECT * FROM products WHERE id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  }),
);

app.post(
  "/api/products",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const plan = getPlan(req.tenant.plan);
    if (plan.products) {
      const [[{ n }]] = await getPool().query(
        "SELECT COUNT(*) n FROM products WHERE tenant_id=? AND is_active=1",
        [req.tenant.id],
      );
      if (n + 1 > plan.products)
        return res.status(403).json({
          error: `The ${plan.name} plan allows ${plan.products} products. Upgrade to add more.`,
        });
    }
    const b = req.body;
    if (!b.name?.trim())
      return res.status(400).json({ error: "Product name is required" });
    try {
      const [r] = await getPool().execute(
        `INSERT INTO products (tenant_id, name, category_id, brand, sku, barcode, size, color, gender, cost_price, mrp, sale_price, tax_rate, stock, low_stock_alert, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          req.tenant.id,
          b.name.trim(),
          b.category_id || null,
          b.brand || null,
          b.sku || null,
          b.barcode || null,
          b.size || null,
          b.color || null,
          b.gender || "Unisex",
          b.cost_price || 0,
          b.mrp || 0,
          b.sale_price || 0,
          b.tax_rate ?? 5,
          b.stock || 0,
          b.low_stock_alert ?? 5,
          b.is_active ?? 1,
        ],
      );
      res.json({ id: r.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "SKU or Barcode already exists" });
      throw e;
    }
  }),
);

app.put(
  "/api/products/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body;
    try {
      const [r] = await getPool().execute(
        `UPDATE products SET name=?, category_id=?, brand=?, sku=?, barcode=?, size=?, color=?, gender=?, cost_price=?, mrp=?, sale_price=?, tax_rate=?, low_stock_alert=?, is_active=?
       WHERE id=? AND tenant_id=?`,
        [
          b.name,
          b.category_id || null,
          b.brand || null,
          b.sku || null,
          b.barcode || null,
          b.size || null,
          b.color || null,
          b.gender || "Unisex",
          b.cost_price || 0,
          b.mrp || 0,
          b.sale_price || 0,
          b.tax_rate ?? 5,
          b.low_stock_alert ?? 5,
          b.is_active ?? 1,
          req.params.id,
          req.tenant.id,
        ],
      );
      if (!r.affectedRows)
        return res.status(404).json({ error: "Product not found" });
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "SKU or Barcode already exists" });
      throw e;
    }
  }),
);

app.delete(
  "/api/products/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    await getPool().execute(
      "UPDATE products SET is_active=0 WHERE id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    res.json({ ok: true });
  }),
);

// ---------------- Customers ----------------
app.get(
  "/api/customers",
  wrap(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT cu.*, (SELECT COUNT(*) FROM sales s WHERE s.customer_id=cu.id AND s.status='completed') orders,
       IFNULL((SELECT SUM(s.total) FROM sales s WHERE s.customer_id=cu.id AND s.status='completed'),0) total_spent
     FROM customers cu WHERE cu.tenant_id=? ORDER BY cu.name`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);
app.post(
  "/api/customers",
  wrap(async (req, res) => {
    let g = chk(req, "cashier", { mutation: true });
    if (deny(res, g)) return;
    const { name, phone, email, address, city } = req.body;
    if (!name?.trim())
      return res.status(400).json({ error: "Customer name is required" });
    const [r] = await getPool().execute(
      "INSERT INTO customers (tenant_id, name, phone, email, address, city) VALUES (?,?,?,?,?,?)",
      [
        req.tenant.id,
        name.trim(),
        phone || null,
        email || null,
        address || null,
        city || null,
      ],
    );
    res.json({ id: r.insertId });
  }),
);
app.put(
  "/api/customers/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const { name, phone, email, address, city } = req.body;
    await getPool().execute(
      "UPDATE customers SET name=?, phone=?, email=?, address=?, city=? WHERE id=? AND tenant_id=?",
      [
        name,
        phone || null,
        email || null,
        address || null,
        city || null,
        req.params.id,
        req.tenant.id,
      ],
    );
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/customers/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    await getPool().execute(
      "DELETE FROM customers WHERE id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    res.json({ ok: true });
  }),
);

// ---------------- Suppliers ----------------
app.get(
  "/api/suppliers",
  wrap(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT su.*, (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id=su.id) purchases,
       IFNULL((SELECT SUM(p.total - p.paid_amount) FROM purchases p WHERE p.supplier_id=su.id),0) balance_due
     FROM suppliers su WHERE su.tenant_id=? ORDER BY su.name`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);
app.post(
  "/api/suppliers",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body;
    if (!b.name?.trim())
      return res.status(400).json({ error: "Supplier name is required" });
    const [r] = await getPool().execute(
      "INSERT INTO suppliers (tenant_id, name, contact_person, phone, email, address, gstin) VALUES (?,?,?,?,?,?,?)",
      [
        req.tenant.id,
        b.name.trim(),
        b.contact_person || null,
        b.phone || null,
        b.email || null,
        b.address || null,
        b.gstin || null,
      ],
    );
    res.json({ id: r.insertId });
  }),
);
app.put(
  "/api/suppliers/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body;
    await getPool().execute(
      "UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, gstin=? WHERE id=? AND tenant_id=?",
      [
        b.name,
        b.contact_person || null,
        b.phone || null,
        b.email || null,
        b.address || null,
        b.gstin || null,
        req.params.id,
        req.tenant.id,
      ],
    );
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/suppliers/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const pool = getPool();
    const [[{ n }]] = await pool.query(
      "SELECT COUNT(*) n FROM purchases WHERE supplier_id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    if (n > 0)
      return res.status(400).json({
        error: `Cannot delete: ${n} purchase(s) reference this supplier`,
      });
    await pool.execute("DELETE FROM suppliers WHERE id=? AND tenant_id=?", [
      req.params.id,
      req.tenant.id,
    ]);
    res.json({ ok: true });
  }),
);

// ---------------- Purchases ----------------
app.get(
  "/api/purchases",
  wrap(async (req, res) => {
    let g = chk(req, "manager");
    if (deny(res, g)) return;
    const [rows] = await getPool().query(
      `SELECT pu.*, IFNULL(su.name,'—') supplier, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id=pu.id) items
     FROM purchases pu LEFT JOIN suppliers su ON su.id=pu.supplier_id WHERE pu.tenant_id=? ORDER BY pu.id DESC LIMIT 200`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);
app.get(
  "/api/purchases/:id",
  wrap(async (req, res) => {
    let g = chk(req, "manager");
    if (deny(res, g)) return;
    const pool = getPool();
    const [head] = await pool.query(
      `SELECT pu.*, IFNULL(su.name,'—') supplier FROM purchases pu LEFT JOIN suppliers su ON su.id=pu.supplier_id WHERE pu.id=? AND pu.tenant_id=?`,
      [req.params.id, req.tenant.id],
    );
    if (!head.length)
      return res.status(404).json({ error: "Purchase not found" });
    const [items] = await pool.query(
      "SELECT * FROM purchase_items WHERE purchase_id=?",
      [req.params.id],
    );
    res.json({ ...head[0], items });
  }),
);
app.post(
  "/api/purchases",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body;
    if (!b.items?.length)
      return res.status(400).json({ error: "Add at least one item" });
    const T = req.tenant.id,
      pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let subtotal = 0;
      const rows = [];
      for (const it of b.items) {
        const [p] = await conn.query(
          "SELECT id, name, size, color FROM products WHERE id=? AND tenant_id=?",
          [it.product_id, T],
        );
        if (!p.length) throw new Error(`Product ${it.product_id} not found`);
        const qty = Math.max(1, parseInt(it.qty) || 1);
        const cost = round2(it.cost_price || 0);
        const amount = round2(qty * cost);
        subtotal += amount;
        rows.push({ p: p[0], qty, cost, amount });
      }
      subtotal = round2(subtotal);
      const tax = round2(b.tax_amount || 0),
        disc = round2(b.discount || 0);
      const total = round2(subtotal + tax - disc);
      const paid = Math.min(round2(b.paid_amount ?? total), total);
      const status = paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
      const [r] = await conn.execute(
        `INSERT INTO purchases (tenant_id, purchase_no, supplier_id, supplier_invoice, purchase_date, subtotal, tax_amount, discount, total, paid_amount, payment_status, notes)
       VALUES (?, 'PUR-TEMP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          T,
          b.supplier_id || null,
          b.supplier_invoice || null,
          b.purchase_date || new Date().toISOString().slice(0, 10),
          subtotal,
          tax,
          disc,
          total,
          paid,
          status,
          b.notes || null,
        ],
      );
      await conn.execute("UPDATE purchases SET purchase_no=? WHERE id=?", [
        `PUR-${String(r.insertId).padStart(6, "0")}`,
        r.insertId,
      ]);
      for (const it of rows) {
        await conn.execute(
          "INSERT INTO purchase_items (purchase_id, product_id, product_name, qty, cost_price, amount) VALUES (?,?,?,?,?,?)",
          [
            r.insertId,
            it.p.id,
            `${it.p.name} (${it.p.size || ""}/${it.p.color || ""})`,
            it.qty,
            it.cost,
            it.amount,
          ],
        );
        await conn.execute(
          "UPDATE products SET stock = stock + ?, cost_price = ? WHERE id = ? AND tenant_id = ?",
          [it.qty, it.cost, it.p.id, T],
        );
      }
      await conn.commit();
      res.json({ id: r.insertId });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);
app.delete(
  "/api/purchases/:id",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const T = req.tenant.id,
      pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[pur]] = await conn.query(
        "SELECT id FROM purchases WHERE id=? AND tenant_id=?",
        [req.params.id, T],
      );
      if (!pur) {
        await conn.rollback();
        return res.status(404).json({ error: "Purchase not found" });
      }
      const [items] = await conn.query(
        "SELECT * FROM purchase_items WHERE purchase_id=?",
        [pur.id],
      );
      for (const it of items) {
        const [[p]] = await conn.query(
          "SELECT stock FROM products WHERE id=? AND tenant_id=? FOR UPDATE",
          [it.product_id, T],
        );
        if (p && p.stock < it.qty) {
          await conn.rollback();
          return res.status(400).json({
            error: `Cannot remove: not enough stock of "${it.product_name}" to reverse`,
          });
        }
      }
      for (const it of items)
        await conn.execute(
          "UPDATE products SET stock = stock - ? WHERE id=? AND tenant_id=?",
          [it.qty, it.product_id, T],
        );
      await conn.execute("DELETE FROM purchases WHERE id=?", [pur.id]);
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);

// ---------------- Sales / POS ----------------
app.get(
  "/api/sales",
  wrap(async (req, res) => {
    const { status, from, to, q } = req.query;
    let sql = `SELECT s.*, IFNULL(cu.name,'Walk-in Customer') customer,
    (SELECT SUM(qty) FROM sale_items WHERE sale_id=s.id) items
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id WHERE s.tenant_id=?`;
    const params = [req.tenant.id];
    if (status) {
      sql += " AND s.status=?";
      params.push(status);
    }
    if (from) {
      sql += " AND DATE(s.sale_date) >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND DATE(s.sale_date) <= ?";
      params.push(to);
    }
    if (q) {
      sql += " AND (s.invoice_no LIKE ? OR cu.name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY s.id DESC LIMIT 300";
    res.json((await getPool().query(sql, params))[0]);
  }),
);

app.get(
  "/api/sales/:id",
  wrap(async (req, res) => {
    const pool = getPool();
    const [head] = await pool.query(
      `SELECT s.*, IFNULL(cu.name,'Walk-in Customer') customer, cu.phone customer_phone
    FROM sales s LEFT JOIN customers cu ON cu.id=s.customer_id WHERE s.id=? AND s.tenant_id=?`,
      [req.params.id, req.tenant.id],
    );
    if (!head.length) return res.status(404).json({ error: "Sale not found" });
    const [items] = await pool.query(
      "SELECT * FROM sale_items WHERE sale_id=? ORDER BY id",
      [req.params.id],
    );
    const t = req.tenant;
    res.json({
      ...head[0],
      items,
      shop: {
        shop_name: t.shop_name,
        tagline: t.tagline,
        address: t.address,
        phone: t.phone,
        gstin: t.gstin,
        receipt_footer: t.receipt_footer,
      },
    });
  }),
);

app.post(
  "/api/sales",
  wrap(async (req, res) => {
    let g = chk(req, "cashier", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body;
    if (!b.items?.length)
      return res.status(400).json({ error: "Cart is empty" });
    const held = b.status === "held";
    const T = req.tenant.id,
      pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let subtotal = 0,
        taxTotal = 0;
      const rows = [];
      for (const it of b.items) {
        const [[p]] = await conn.query(
          "SELECT * FROM products WHERE id=? AND tenant_id=? " +
            (held ? "" : "FOR UPDATE"),
          [it.product_id, T],
        );
        if (!p) throw new Error("A product in the cart no longer exists");
        const qty = Math.max(1, parseInt(it.qty) || 1);
        if (!held && p.stock < qty)
          throw new Error(
            `Insufficient stock for "${p.name} (${p.size}/${p.color})" — only ${p.stock} left`,
          );
        const price = round2(it.price ?? p.sale_price);
        const line = round2(qty * price);
        const disc = Math.min(round2(it.discount || 0), line);
        const lineNet = round2(line - disc);
        const gstOn =
          req.tenant.gst_enabled === undefined ? 1 : req.tenant.gst_enabled;
        const taxRate = gstOn ? round2(p.tax_rate) : 0;
        const taxAmt = round2((lineNet * taxRate) / 100);
        subtotal += lineNet;
        taxTotal += taxAmt;
        rows.push({
          p,
          qty,
          price,
          disc,
          taxRate,
          taxAmt,
          amount: round2(lineNet + taxAmt),
        });
      }
      subtotal = round2(subtotal);
      taxTotal = round2(taxTotal);
      const invDisc = Math.min(round2(b.discount || 0), subtotal);
      const total = round2(subtotal + taxTotal - invDisc);
      const paid = held ? 0 : round2(b.paid_amount ?? total);
      const change = Math.max(0, round2(paid - total));
      const [r] = await conn.execute(
        `INSERT INTO sales (tenant_id, invoice_no, customer_id, sale_date, subtotal, discount, tax_amount, total, paid_amount, change_amount, payment_method, status, notes)
       VALUES (?, 'INV-TEMP', ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          T,
          b.customer_id || null,
          subtotal,
          invDisc,
          taxTotal,
          total,
          held ? 0 : paid,
          held ? 0 : change,
          b.payment_method || "cash",
          held ? "held" : "completed",
          b.notes || null,
        ],
      );
      await conn.execute("UPDATE sales SET invoice_no=? WHERE id=?", [
        `INV-${String(r.insertId).padStart(6, "0")}`,
        r.insertId,
      ]);
      for (const it of rows) {
        await conn.execute(
          `INSERT INTO sale_items (sale_id, product_id, product_name, qty, price, discount, tax_rate, tax_amount, cost_price, amount) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            r.insertId,
            it.p.id,
            `${it.p.name} (${it.p.size || ""}/${it.p.color || ""})`,
            it.qty,
            it.price,
            it.disc,
            it.taxRate,
            it.taxAmt,
            it.p.cost_price,
            it.amount,
          ],
        );
        if (!held)
          await conn.execute(
            "UPDATE products SET stock = stock - ? WHERE id=? AND tenant_id=?",
            [it.qty, it.p.id, T],
          );
      }
      await conn.commit();
      res.json({
        id: r.insertId,
        invoice_no: `INV-${String(r.insertId).padStart(6, "0")}`,
        total,
        change,
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);

app.delete(
  "/api/sales/:id",
  wrap(async (req, res) => {
    let g = chk(req, "cashier", { mutation: true });
    if (deny(res, g)) return;
    const pool = getPool();
    const [[s]] = await pool.query(
      "SELECT status FROM sales WHERE id=? AND tenant_id=?",
      [req.params.id, req.tenant.id],
    );
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.status !== "held")
      return res.status(400).json({ error: "Only held sales can be deleted" });
    await pool.execute("DELETE FROM sales WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  }),
);

app.put(
  "/api/sales/:id/return",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const T = req.tenant.id,
      pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[s]] = await conn.query(
        "SELECT * FROM sales WHERE id=? AND tenant_id=? FOR UPDATE",
        [req.params.id, T],
      );
      if (!s) {
        await conn.rollback();
        return res.status(404).json({ error: "Sale not found" });
      }
      if (s.status !== "completed") {
        await conn.rollback();
        return res.status(400).json({
          error: `Only completed sales can be returned (status: ${s.status})`,
        });
      }
      const [items] = await conn.query(
        "SELECT * FROM sale_items WHERE sale_id=?",
        [s.id],
      );
      for (const it of items)
        await conn.execute(
          "UPDATE products SET stock = stock + ? WHERE id=? AND tenant_id=?",
          [it.qty, it.product_id, T],
        );
      await conn.execute(
        `UPDATE sales SET status='returned', notes=CONCAT(IFNULL(notes,''),' [RETURNED ${new Date().toISOString().slice(0, 10)}]') WHERE id=?`,
        [s.id],
      );
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);

// ---------------- Stock ----------------
app.get(
  "/api/stock",
  wrap(async (req, res) => {
    const [rows] = await getPool().query(
      `SELECT p.id, p.name, p.sku, p.barcode, p.size, p.color, p.stock, p.cost_price, p.sale_price, p.low_stock_alert,
      c.name category, p.stock*p.cost_price cost_value, p.stock*p.sale_price retail_value
     FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.tenant_id=? AND p.is_active=1 ORDER BY p.name, p.size`,
      [req.tenant.id],
    );
    res.json(rows);
  }),
);

app.get(
  "/api/stock/movements",
  wrap(async (req, res) => {
    let g = chk(req, "manager");
    if (deny(res, g)) return;
    const [adj] = await getPool().query(
      `SELECT product_name, adjustment, reason, created_at FROM stock_adjustments WHERE tenant_id=? ORDER BY id DESC LIMIT 100`,
      [req.tenant.id],
    );
    res.json(adj);
  }),
);

app.post(
  "/api/stock/adjust",
  wrap(async (req, res) => {
    let g = chk(req, "manager", { mutation: true });
    if (deny(res, g)) return;
    const { product_id, adjustment, reason } = req.body;
    const qty = parseInt(adjustment);
    if (!product_id || !qty)
      return res
        .status(400)
        .json({ error: "Product and a non-zero adjustment are required" });
    const T = req.tenant.id,
      pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[p]] = await conn.query(
        "SELECT * FROM products WHERE id=? AND tenant_id=? FOR UPDATE",
        [product_id, T],
      );
      if (!p) {
        await conn.rollback();
        return res.status(404).json({ error: "Product not found" });
      }
      if (p.stock + qty < 0) {
        await conn.rollback();
        return res.status(400).json({
          error: `Cannot reduce below zero (current stock ${p.stock})`,
        });
      }
      await conn.execute("UPDATE products SET stock = stock + ? WHERE id=?", [
        qty,
        p.id,
      ]);
      await conn.execute(
        "INSERT INTO stock_adjustments (tenant_id, product_id, product_name, adjustment, reason) VALUES (?,?,?,?,?)",
        [
          T,
          p.id,
          `${p.name} (${p.size || ""}/${p.color || ""})`,
          qty,
          reason || null,
        ],
      );
      await conn.commit();
      res.json({ ok: true, stock: p.stock + qty });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }),
);

// ---------------- Reports (Pro / Trial) ----------------
app.get(
  "/api/reports/summary",
  wrap(async (req, res) => {
    let g = chk(req, "manager");
    if (deny(res, g)) return;
    if (!getPlan(req.tenant.plan).reports) {
      return res.status(403).json({
        error:
          "Reports & analytics are available on the Pro plan — please upgrade from the Billing page.",
      });
    }
    const { from, to } = req.query;
    const range = `DATE(s.sale_date) BETWEEN ? AND ?`;
    const params = [from, to];
    const T = req.tenant.id,
      pool = getPool();
    const [[sum]] = await pool.query(
      `SELECT COUNT(*) invoices, IFNULL(SUM(total),0) sales, IFNULL(SUM(tax_amount),0) tax, IFNULL(SUM(discount),0) discounts
     FROM sales s WHERE s.tenant_id=? AND s.status='completed' AND ${range}`,
      [T, ...params],
    );
    const [[profit]] = await pool.query(
      `SELECT IFNULL(SUM(si.qty*si.price - si.discount - si.qty*si.cost_price),0) gross FROM sale_items si
     JOIN sales s ON s.id=si.sale_id WHERE s.tenant_id=? AND s.status='completed' AND ${range}`,
      [T, ...params],
    );
    const daily = (
      await pool.query(
        `SELECT DATE(s.sale_date) d, SUM(s.total) t, COUNT(*) c FROM sales s WHERE s.tenant_id=? AND s.status='completed' AND ${range} GROUP BY DATE(s.sale_date) ORDER BY d`,
        [T, ...params],
      )
    )[0];
    const topProducts = (
      await pool.query(
        `SELECT si.product_name name, SUM(si.qty) qty, SUM(si.amount) amount, SUM(si.qty*si.price - si.discount - si.qty*si.cost_price) profit
     FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.tenant_id=? AND s.status='completed' AND ${range} GROUP BY si.product_name ORDER BY amount DESC LIMIT 10`,
        [T, ...params],
      )
    )[0];
    const byCategory = (
      await pool.query(
        `SELECT IFNULL(c.name,'Uncategorised') name, SUM(si.amount) amount, SUM(si.qty) qty FROM sale_items si
     JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id LEFT JOIN categories c ON c.id=p.category_id
     WHERE s.tenant_id=? AND s.status='completed' AND ${range} GROUP BY c.name ORDER BY amount DESC`,
        [T, ...params],
      )
    )[0];
    const byPayment = (
      await pool.query(
        `SELECT payment_method m, COUNT(*) c, SUM(total) t FROM sales s WHERE s.tenant_id=? AND s.status='completed' AND ${range} GROUP BY payment_method`,
        [T, ...params],
      )
    )[0];
    const gst = (
      await pool.query(
        `SELECT si.tax_rate rate, SUM(si.qty*si.price - si.discount) taxable, SUM(si.tax_amount) tax FROM sale_items si
     JOIN sales s ON s.id=si.sale_id WHERE s.tenant_id=? AND s.status='completed' AND ${range} GROUP BY si.tax_rate ORDER BY si.tax_rate`,
        [T, ...params],
      )
    )[0];
    res.json({
      summary: {
        ...sum,
        gross_profit: round2(Number(profit.gross) - Number(sum.discounts)),
      },
      daily,
      topProducts,
      byCategory,
      byPayment,
      gst,
    });
  }),
);

// ---------------- Shop settings (tenant record) ----------------
app.get(
  "/api/settings",
  wrap(async (req, res) => {
    const t = req.tenant;
    res.json({
      shop_name: t.shop_name,
      tagline: t.tagline,
      address: t.address,
      phone: t.phone,
      email: t.owner_email,
      gstin: t.gstin,
      receipt_footer: t.receipt_footer,
      gst_enabled: t.gst_enabled ?? 1,
    });
  }),
);
app.put(
  "/api/settings",
  wrap(async (req, res) => {
    let g = chk(req, "admin", { mutation: true });
    if (deny(res, g)) return;
    const b = req.body || {};
    const gst =
      b.gst_enabled === undefined
        ? (req.tenant.gst_enabled ?? 1)
        : b.gst_enabled
          ? 1
          : 0;
    await getPool().execute(
      "UPDATE tenants SET shop_name=?, tagline=?, address=?, phone=?, gstin=?, receipt_footer=?, gst_enabled=? WHERE id=?",
      [
        b.shop_name || req.tenant.shop_name,
        b.tagline || null,
        b.address || null,
        b.phone || null,
        b.gstin || null,
        b.receipt_footer || null,
        gst,
        req.tenant.id,
      ],
    );
    res.json({ ok: true, gst_enabled: gst });
  }),
);

// ---------------- Platform console (SaaS operator) ----------------
async function opGate(req, res) {
  const u = await opUser(req);
  if (!u) {
    res.status(401).json({ error: "Operator login required" });
    return false;
  }
  req.op = u;
  return true;
}
const opOwnerOnly = (req, res) => {
  if (!req.op?.is_owner) {
    res.status(403).json({ error: "Only the platform owner can do this" });
    return false;
  }
  return true;
};

app.post(
  "/api/platform/login",
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const uname = String(username || "")
      .trim()
      .toLowerCase();
    const [[u]] = await getPool().query(
      "SELECT * FROM platform_users WHERE username = ?",
      [uname],
    );
    if (
      !u ||
      !bcrypt.compareSync(String(password || "").trim(), u.password_hash)
    ) {
      return res.status(401).json({
        error:
          "Invalid operator username or password. The default owner login is platform / platform@123",
      });
    }
    if (!u.is_active)
      return res
        .status(403)
        .json({ error: "This operator account is disabled" });
    await getPool().query(
      "UPDATE platform_users SET last_login = NOW() WHERE id = ?",
      [u.id],
    );
    opIssue(res, u.id);
    res.json({
      ok: true,
      user: u.username,
      name: u.name,
      is_owner: !!u.is_owner,
      razorpay_configured: rzp.configured(),
    });
  }),
);

app.get(
  "/api/platform/me",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    res.json({ ...req.op, is_owner: !!req.op.is_owner });
  }),
);

app.post("/api/platform/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${OP_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  res.json({ ok: true });
});

app.get(
  "/api/platform/overview",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const pool = getPool();
    const [[ten]] = await pool.query(
      `SELECT COUNT(*) total, SUM(status='active') active, SUM(status='suspended') suspended FROM tenants`,
    );
    const [[usr]] = await pool.query(`SELECT COUNT(*) n FROM users`);
    const [byPlan] = await pool.query(
      `SELECT plan, COUNT(*) n FROM tenants GROUP BY plan`,
    );
    const [[salesAgg]] = await pool.query(
      `SELECT COUNT(*) today, COALESCE(SUM(total),0) today_total FROM sales WHERE status='completed' AND DATE(sale_date)=CURDATE()`,
    );
    const [[sales30]] = await pool.query(
      `SELECT COUNT(*) n FROM sales WHERE status='completed' AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
    );
    const [[signups]] = await pool.query(
      `SELECT COUNT(*) n FROM tenants WHERE created_at >= DATE_SUB(NOW(), INTERVAL 29 DAY)`,
    );
    const [planRows] = await pool.query(
      `SELECT plan, status, plan_expires_at FROM tenants`,
    );
    // MRR: sum of plan prices over active, non-expired paid subscriptions
    let mrr = 0;
    for (const r of planRows) {
      if (r.status !== "active" || r.plan === "trial") continue;
      if (r.plan_expires_at && new Date(r.plan_expires_at) < new Date())
        continue;
      mrr += getPlan(r.plan).price || 0;
    }
    const [trend] = await pool.query(
      `SELECT DATE(created_at) d, COUNT(*) n FROM tenants WHERE created_at >= DATE_SUB(NOW(), INTERVAL 29 DAY) GROUP BY DATE(created_at) ORDER BY d`,
    );
    res.json({
      tenants: {
        total: ten.total,
        active: Number(ten.active || 0),
        suspended: Number(ten.suspended || 0),
      },
      users: usr.n,
      mrr,
      plans: Object.fromEntries(byPlan.map((r) => [r.plan, r.n])),
      sales_today: {
        count: salesAgg.today,
        total: Number(salesAgg.today_total),
      },
      sales_30: sales30.n,
      signups_30: signups.n,
      signup_trend: trend,
      gateway: rzp.configured() ? "razorpay" : "demo",
    });
  }),
);

app.get(
  "/api/platform/tenants",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [rows] = await getPool().query(
      `SELECT t.id, t.shop_name, t.owner_email, t.phone, t.plan, t.status, t.created_at, t.plan_expires_at,
       (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) users,
       (SELECT COUNT(*) FROM products p WHERE p.tenant_id = t.id AND p.is_active = 1) products,
       (SELECT COUNT(*) FROM sales s WHERE s.tenant_id = t.id AND s.status = 'completed') sales,
       (SELECT COALESCE(SUM(s2.total),0) FROM sales s2 WHERE s2.tenant_id = t.id AND s2.status = 'completed') revenue
     FROM tenants t ORDER BY t.id`,
    );
    res.json(rows);
  }),
);

app.post(
  "/api/platform/tenants/:id/suspend",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [r] = await getPool().execute(
      `UPDATE tenants SET status='suspended' WHERE id=?`,
      [req.params.id],
    );
    if (!r.affectedRows)
      return res.status(404).json({ error: "Tenant not found" });
    res.json({ ok: true, status: "suspended" });
  }),
);

app.post(
  "/api/platform/tenants/:id/activate",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [r] = await getPool().execute(
      `UPDATE tenants SET status='active' WHERE id=?`,
      [req.params.id],
    );
    if (!r.affectedRows)
      return res.status(404).json({ error: "Tenant not found" });
    res.json({ ok: true, status: "active" });
  }),
);

app.put(
  "/api/platform/tenants/:id/plan",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const { plan, days } = req.body || {};
    if (!getPlans()[plan])
      return res.status(400).json({ error: "Choose a valid plan" });
    const d = Math.min(Math.max(parseInt(days) || 30, 1), 3650);
    const expires =
      plan === "trial"
        ? `DATE_ADD(NOW(), INTERVAL ${d} DAY)`
        : days
          ? `DATE_ADD(NOW(), INTERVAL ${d} DAY)`
          : "NULL";
    const [r] = await getPool().query(
      `UPDATE tenants SET plan=?, plan_expires_at=${expires}, status='active' WHERE id=?`,
      [plan, req.params.id],
    );
    if (!r.affectedRows)
      return res.status(404).json({ error: "Tenant not found" });
    res.json({ ok: true, plan });
  }),
);

app.get(
  "/api/platform/orders",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [rows] = await getPool().query(
      `SELECT o.id, o.tenant_id, t.shop_name, o.plan, o.amount, o.currency, o.gateway, o.status, o.created_at, o.paid_at
     FROM billing_orders o JOIN tenants t ON t.id = o.tenant_id ORDER BY o.id DESC LIMIT 50`,
    );
    res.json(rows);
  }),
);

// ---------------- Operator account management (owner only) ----------------
app.get(
  "/api/platform/operators",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [rows] = await getPool().query(
      `SELECT id, username, name, is_owner, is_active, last_login, created_at FROM platform_users ORDER BY id`,
    );
    res.json(rows);
  }),
);

app.post(
  "/api/platform/operators",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const { username, password, name } = req.body || {};
    const uname = String(username || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9_.@-]{3,60}$/.test(uname))
      return res.status(400).json({
        error: "Username must be 3-60 chars (letters, numbers, . _ @ -)",
      });
    if (!password || String(password).length < 4)
      return res
        .status(400)
        .json({ error: "Password must be at least 4 characters" });
    if (!name?.trim())
      return res.status(400).json({ error: "Name is required" });
    try {
      const [r] = await getPool().execute(
        "INSERT INTO platform_users (username, password_hash, name) VALUES (?,?,?)",
        [uname, bcrypt.hashSync(String(password), 10), name.trim()],
      );
      res.json({ ok: true, id: r.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(400).json({ error: "Username already exists" });
      throw e;
    }
  }),
);

app.put(
  "/api/platform/operators/:id",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const id = Number(req.params.id);
    const pool = getPool();
    const [[target]] = await pool.query(
      "SELECT * FROM platform_users WHERE id = ?",
      [id],
    );
    if (!target) return res.status(404).json({ error: "Operator not found" });
    const { is_active, password, name } = req.body || {};
    if (target.is_owner && is_active === 0)
      return res
        .status(400)
        .json({ error: "The owner account cannot be disabled" });
    if (id === req.op.id && is_active === 0)
      return res
        .status(400)
        .json({ error: "You cannot disable your own account" });
    if (name?.trim())
      await pool.execute("UPDATE platform_users SET name = ? WHERE id = ?", [
        name.trim(),
        id,
      ]);
    if (is_active !== undefined)
      await pool.execute(
        "UPDATE platform_users SET is_active = ? WHERE id = ?",
        [is_active ? 1 : 0, id],
      );
    if (password) {
      if (String(password).length < 4)
        return res
          .status(400)
          .json({ error: "Password must be at least 4 characters" });
      await pool.execute(
        "UPDATE platform_users SET password_hash = ? WHERE id = ?",
        [bcrypt.hashSync(String(password), 10), id],
      );
    }
    res.json({ ok: true });
  }),
);

app.delete(
  "/api/platform/operators/:id",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const id = Number(req.params.id);
    const [[target]] = await getPool().query(
      "SELECT * FROM platform_users WHERE id = ?",
      [id],
    );
    if (!target) return res.status(404).json({ error: "Operator not found" });
    if (target.is_owner)
      return res
        .status(400)
        .json({ error: "The owner account cannot be deleted" });
    if (id === req.op.id)
      return res
        .status(400)
        .json({ error: "You cannot delete your own account" });
    await getPool().execute("DELETE FROM platform_users WHERE id = ?", [id]);
    res.json({ ok: true });
  }),
);

// ---------------- Subscription plan management ----------------
app.get(
  "/api/platform/plans",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const [rows] = await getPool().query(
      "SELECT * FROM subscription_plans ORDER BY sort_order, price, id",
    );
    const [usage] = await getPool().query(
      "SELECT plan, COUNT(*) n FROM tenants GROUP BY plan",
    );
    const u = Object.fromEntries(usage.map((r) => [r.plan, r.n]));
    res.json(rows.map((r) => ({ ...r, tenants_on_plan: u[r.plan_key] || 0 })));
  }),
);

app.post(
  "/api/platform/plans",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const b = req.body || {};
    const key = String(b.plan_key || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    if (!/^[a-z0-9_-]{2,30}$/.test(key))
      return res
        .status(400)
        .json({ error: "Plan key must be 2-30 chars (a-z, 0-9, - _)" });
    if (key === "trial")
      return res.status(400).json({
        error: '"trial" is reserved — edit the built-in trial plan instead',
      });
    if (!b.name?.trim())
      return res.status(400).json({ error: "Plan name is required" });
    const price = Math.max(0, parseInt(b.price) || 0);
    const users_limit =
      b.users_limit === null || b.users_limit === ""
        ? null
        : Math.max(1, parseInt(b.users_limit) || 1);
    const products_limit =
      b.products_limit === null || b.products_limit === ""
        ? null
        : Math.max(1, parseInt(b.products_limit) || 1);
    try {
      const [r] = await getPool().execute(
        `INSERT INTO subscription_plans (plan_key, name, price, users_limit, products_limit, reports, tagline, sort_order)
       VALUES (?,?,?,?,?,?,?,?)`,
        [
          key,
          b.name.trim(),
          price,
          users_limit,
          products_limit,
          b.reports ? 1 : 0,
          b.tagline || null,
          parseInt(b.sort_order) || 50,
        ],
      );
      await refreshPlans();
      res.json({ ok: true, id: r.insertId, plan_key: key });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res
          .status(400)
          .json({ error: "A plan with this key already exists" });
      throw e;
    }
  }),
);

app.put(
  "/api/platform/plans/:id",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const id = Number(req.params.id);
    const pool = getPool();
    const [[p]] = await pool.query(
      "SELECT * FROM subscription_plans WHERE id = ?",
      [id],
    );
    if (!p) return res.status(404).json({ error: "Plan not found" });
    const b = req.body || {};
    const name = b.name?.trim() || p.name;
    const price =
      b.price !== undefined ? Math.max(0, parseInt(b.price) || 0) : p.price;
    const users_limit =
      b.users_limit !== undefined
        ? b.users_limit === null || b.users_limit === ""
          ? null
          : Math.max(1, parseInt(b.users_limit) || 1)
        : p.users_limit;
    const products_limit =
      b.products_limit !== undefined
        ? b.products_limit === null || b.products_limit === ""
          ? null
          : Math.max(1, parseInt(b.products_limit) || 1)
        : p.products_limit;
    const reports = b.reports !== undefined ? (b.reports ? 1 : 0) : p.reports;
    const tagline = b.tagline !== undefined ? b.tagline || null : p.tagline;
    const sort_order =
      b.sort_order !== undefined ? parseInt(b.sort_order) || 0 : p.sort_order;
    // trial length is only meaningful on the trial plan
    const trial_days =
      p.plan_key === "trial" && b.trial_days !== undefined
        ? Math.max(1, parseInt(b.trial_days) || 14)
        : p.trial_days;
    await pool.execute(
      `UPDATE subscription_plans SET name=?, price=?, users_limit=?, products_limit=?, reports=?, tagline=?, sort_order=?, trial_days=? WHERE id=?`,
      [
        name,
        price,
        users_limit,
        products_limit,
        reports,
        tagline,
        sort_order,
        trial_days,
        id,
      ],
    );
    await refreshPlans();
    res.json({ ok: true });
  }),
);

app.post(
  "/api/platform/plans/:id/toggle",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const id = Number(req.params.id);
    const pool = getPool();
    const [[p]] = await pool.query(
      "SELECT * FROM subscription_plans WHERE id = ?",
      [id],
    );
    if (!p) return res.status(404).json({ error: "Plan not found" });
    if (p.plan_key === "trial")
      return res
        .status(400)
        .json({ error: "The trial plan must stay active (new shops need it)" });
    if (p.is_active) {
      const [[{ n }]] = await pool.query(
        "SELECT COUNT(*) n FROM tenants WHERE plan = ?",
        [p.plan_key],
      );
      if (n > 0)
        return res.status(400).json({
          error: `${n} shop(s) are on this plan — move them to another plan first`,
        });
    }
    await pool.execute(
      "UPDATE subscription_plans SET is_active = 1 - is_active WHERE id = ?",
      [id],
    );
    await refreshPlans();
    res.json({ ok: true, is_active: 1 - p.is_active });
  }),
);

// ---------------- Platform-wide settings ----------------
app.get(
  "/api/platform/settings",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    res.json(await getPlatformSettings());
  }),
);

app.put(
  "/api/platform/settings",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    if (!opOwnerOnly(req, res)) return;
    const b = req.body || {};
    const allowed = {
      default_gst_enabled: (v) =>
        v === "0" || v === 0 || v === false ? "0" : "1",
      default_receipt_footer: (v) => String(v || "").slice(0, 255),
    };
    for (const [k, v] of Object.entries(b)) {
      if (!allowed[k]) continue;
      await getPool().query(
        "INSERT INTO platform_settings (skey, svalue) VALUES (?,?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
        [k, allowed[k](v)],
      );
    }
    res.json({ ok: true, settings: await getPlatformSettings() });
  }),
);

// ---------------- Deep shop monitoring ----------------
app.get(
  "/api/platform/tenants/:id",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const pool = getPool();
    const id = Number(req.params.id);
    const [[t]] = await pool.query("SELECT * FROM tenants WHERE id = ?", [id]);
    if (!t) return res.status(404).json({ error: "Tenant not found" });
    const [[{ users }]] = await pool.query(
      "SELECT COUNT(*) users FROM users WHERE tenant_id = ?",
      [id],
    );
    const [[{ products }]] = await pool.query(
      "SELECT COUNT(*) products FROM products WHERE tenant_id = ? AND is_active = 1",
      [id],
    );
    const [[{ sales }]] = await pool.query(
      `SELECT COUNT(*) sales FROM sales WHERE tenant_id = ? AND status = 'completed'`,
      [id],
    );
    const [[{ revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(total),0) revenue FROM sales WHERE tenant_id = ? AND status = 'completed'`,
      [id],
    );
    const [[{ stock_value }]] = await pool.query(
      "SELECT COALESCE(SUM(stock * cost_price),0) stock_value FROM products WHERE tenant_id = ? AND is_active = 1",
      [id],
    );
    const [userRows] = await pool.query(
      "SELECT id, username, name, role, is_active, last_login, created_at FROM users WHERE tenant_id = ? ORDER BY id",
      [id],
    );
    const [salesRows] = await pool.query(
      `SELECT id, invoice_no, sale_date, total, payment_method, status FROM sales WHERE tenant_id = ? ORDER BY id DESC LIMIT 10`,
      [id],
    );
    const [orderRows] = await pool.query(
      "SELECT id, plan, amount, gateway, status, created_at, paid_at FROM billing_orders WHERE tenant_id = ? ORDER BY id DESC LIMIT 10",
      [id],
    );
    const [topRows] = await pool.query(
      `SELECT si.product_name name, SUM(si.qty) qty, SUM(si.amount) revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.tenant_id = ? AND s.status = 'completed' GROUP BY si.product_name ORDER BY revenue DESC LIMIT 5`,
      [id],
    );
    res.json({
      tenant: {
        id: t.id,
        shop_name: t.shop_name,
        owner_email: t.owner_email,
        phone: t.phone,
        tagline: t.tagline,
        address: t.address,
        gstin: t.gstin,
        plan: t.plan,
        status: t.status,
        plan_expires_at: t.plan_expires_at,
        created_at: t.created_at,
      },
      usage: {
        users,
        products,
        sales,
        revenue: Number(revenue),
        stock_value: Number(stock_value),
      },
      users: userRows,
      recent_sales: salesRows,
      orders: orderRows,
      top_products: topRows,
    });
  }),
);

// Extend (or start) a shop's subscription term by N days.
app.post(
  "/api/platform/tenants/:id/extend",
  wrap(async (req, res) => {
    if (!(await opGate(req, res))) return;
    const days = Math.min(Math.max(parseInt(req.body?.days) || 0, 1), 3650);
    const [r] = await getPool().execute(
      `UPDATE tenants SET plan_expires_at = DATE_ADD(COALESCE(plan_expires_at, NOW()), INTERVAL ${days} DAY) WHERE id = ?`,
      [req.params.id],
    );
    if (!r.affectedRows)
      return res.status(404).json({ error: "Tenant not found" });
    const [[t]] = await getPool().query(
      "SELECT plan_expires_at FROM tenants WHERE id = ?",
      [req.params.id],
    );
    res.json({ ok: true, plan_expires_at: t.plan_expires_at });
  }),
);

// ---------------- SPA fallback ----------------
if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api"))
      return res.sendFile(path.join(distDir, "index.html"));
    next();
  });
}

// ---------------- Boot ----------------
async function ensurePlatformOwner() {
  const pool = getPool();
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) n FROM platform_users WHERE username = ?",
    [PLATFORM_USER],
  );
  if (!n) {
    await pool.execute(
      "INSERT INTO platform_users (username, password_hash, name, is_owner) VALUES (?,?,?,1)",
      [PLATFORM_USER, bcrypt.hashSync(PLATFORM_PASS, 10), "Platform Owner"],
    );
    console.log(`Operator owner account created → ${PLATFORM_USER}`);
  }
}
initDb()
  .then(async () => {
    await ensurePlatformOwner();
    await refreshPlans();

    app.listen(cfg.serverPort, "0.0.0.0", () => {
      console.log(
        `✔ Garment Billing SaaS running → http://localhost:${cfg.serverPort}`,
      );

      console.log(
        `  Demo shops: admin/admin@123 (Style Hub, Pro) · trendy/trendy@123 (Trendy Threads, Starter)`,
      );

      console.log(
        `  Platform console: /platform → ${PLATFORM_USER} (operator accounts manageable in-app)`,
      );
    });
  })
  .catch((e) => {
    console.error("Failed to start:", e.message);
    process.exit(1);
  });
