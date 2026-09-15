# 🧵 GarmentBill SaaS — Multi-tenant Billing for Garment Shops

A **complete, ready-to-sell, multi-tenant SaaS** built on React + Express.js + MySQL.
Any number of shops sign up on one shared deployment; each shop's data is fully
isolated, and **every shop has exactly one admin login (the owner)** — staff can
only be added as Manager or Cashier. Ships with a self-serve landing page, free
trial, subscription plans, **real Razorpay payments** (with a built-in demo mode),
renewals, and an **operator Platform Console** to run the business. One login form
serves everyone — shop staff and platform operators alike.

**Stack:** React 18 (Vite) · React Router 6 · Bootstrap 5 · Chart.js · Express.js · MySQL/MariaDB (mysql2) · bcrypt sessions · Razorpay

---

## 🏬 Multi-tenant design

- **Tenants** table holds each shop (name, GSTIN, receipt footer, **plan**, expiry, status).
- Every business table (`products`, `sales`, `purchases`, `customers`, `suppliers`,
  `categories`, `users`, `stock_adjustments`, `billing_orders`) carries a `tenant_id`,
  and **every** API query filters by the logged-in user's tenant — one shop can never
  read or touch another's data.
- **One admin per shop.** Signup creates the owner as the sole `admin`. The API refuses
  to create another admin, demote the admin, or delete the admin record. Staff are
  `manager` or `cashier`.
- **Self-serve onboarding:** landing + pricing → `/signup` creates the tenant, the owner
  login and 7 starter categories, then drops straight into the app on a 14‑day Pro trial.

## 💰 Subscriptions, payments & lifecycle

| Plan | Price | Users | Products | Reports |
|---|---|---|---|---|
| **Trial** | ₹0 for 14 days | 5 | Unlimited | ✅ |
| **Starter** | ₹499/mo | 2 | 200 | ❌ |
| **Pro** | ₹999/mo | 5 | Unlimited | ✅ |

These three are just the **seeded defaults** — plans live in the `subscription_plans`
table and are fully managed from the Platform Console (create, edit, price, deactivate).
The landing page pricing and each shop's Billing/upgrade options render whatever plans
are currently active, instantly.

- **Real payments via Razorpay** — `POST /api/billing/checkout` creates a gateway order,
  the client opens Razorpay Checkout, and `POST /api/billing/verify` validates the
  `HMAC_SHA256(secret, order_id|payment_id)` signature before activating the plan.
  No SDK dependency (plain REST + crypto).
- **Demo mode** — without Razorpay keys the same flow runs simulated so everything is
  testable; the Billing page shows which mode is active.
- **30-day billing cycles & renewals** — paid plans activate for 30 days; a **Renew**
  button appears in the last 7 days and after expiry.
- **Downgrade protection** — you can't switch to a plan below your current usage
  (users/products) until you trim down.
- **Enforcement** — extra users/products return `403`; Reports is hidden + blocked on
  Starter; after trial/subscription ends, all **mutations** return `402 Payment
  Required` (reads still work) with a banner pushing the owner to Billing.
- **Payment history** — every order is recorded in `billing_orders` (created / paid /
  failed) and shown to the shop and to the operator.

### Going live with Razorpay
```bash
RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx npm start
```

## 🛠 Platform Console (operator) — sidebar layout

Run the SaaS itself from `/platform`. There is **one login form for everyone** —
operators sign in on the regular `/login` page with their DB-backed operator account
(bcrypt-hashed, separate signed cookie) and are routed straight into the console, which
uses a **dark sidebar layout** with two groups — **Monitor**: *Overview, Shops, Payments*
and **Manage**: *Subscription Plans, Operators, Platform Settings*:

- **Overview** — MRR, tenant/user counts, plan mix, sales today & 30‑day, 30‑day signup trend
- **Shops** — search + filter by plan/status, **Export CSV**, and a **deep per-shop monitor**:
  usage (users/products/sales/revenue/stock value), all logins, recent sales, top products,
  subscription orders, plus **Edit plan** (plan + term), **Extend +30 days**, and **Suspend/Activate**
- **Payments** — the global subscription payments ledger across all shops
- **Subscription Plans** *(owner)* — create/edit/deactivate plans (name, ₹/month, user &
  product limits, reports access, trial length, tagline); changes apply live to landing,
  billing and checkout. Plans with active shops can't be deactivated; `trial` is reserved
- **Operators** *(owner only)* — **create additional operator accounts**, enable/disable them,
  reset passwords, or delete them
- **Platform Settings** *(owner)* — defaults for **newly created shops**: whether GST billing
  starts ON or OFF, and the default receipt footer message

The **owner** account is auto-provisioned at boot from the environment and can't be
disabled/deleted; any extra accounts are created in the Operators tab.

Default owner login: `platform / platform@123` (override with `PLATFORM_USER` /
`PLATFORM_PASS`; session secret via `OPERATOR_SECRET`).

## 📄 CSV export in Reports

Every Reports section exports to CSV — **Daily Sales**, **Top Products**, **GST Summary**,
**Payment Split**, **Category Share/Breakdown** — plus an **Export All CSV** that bundles
the whole report (summary included) into one Excel-friendly file. Exports carry a UTF‑8
BOM so ₹ values and text open cleanly in Excel.

## 🔒 Security hardening

- HttpOnly session cookies; bcrypt password hashes; server-side role gates on every route
- **Per-IP rate limiting** on `/api/login`, `/api/signup`, `/api/platform/login` (`429`)
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`
- Razorpay signature verification with `timingSafeEqual`; failed payments marked `failed`
- Transactional money paths (POS, purchases, returns, adjustments) with explicit rollback

## ✨ App features (per shop)

| Module | Highlights |
|---|---|
| 🔐 **Login & Users** | Session login, single-admin + Manager/Cashier staff, My Profile |
| 📊 **Dashboard** | Today/month sales, stock value, low-stock alerts, 14-day & category charts |
| 🛒 **POS Billing** | Barcode scan, SKU lookup, cart w/ qty/rate/discount, Cash/UPI/Card + change, hold/resume, printable 80 mm receipt, `F9` to pay |
| 🏷 **Products** | Category, Brand, Size, Color, SKU + Barcode (auto), Cost/MRP/Sale, GST, low-stock alert, CSV export, soft delete |
| 🚚 **Purchases** | GRN adds stock & updates cost; paid/partial/pending; delete reverses stock (admin) |
| 🧾 **Sales** | Filters, reprint receipt, **return with auto-restock** (manager+) |
| 📦 **Stock** | Valuation @ cost/retail, ± adjustments with reasons, history |
| 👥 **Customers / Suppliers** | CRUD, lifetime spend, balance due |
| 📈 **Reports** *(Pro/Trial)* | Sales & profit, top products, category share, payment split, **CGST/SGST summary** |
| 💳 **Plan & Billing** *(admin)* | Usage meters, trial/renewal countdown, Razorpay checkout, payment history |
| ⚙️ **Settings** | Shop details printed on receipts, **GST ON/OFF switch** (when off, new invoices carry zero tax) |

---

## 🚀 Quick start

### Prerequisites
* Node.js 18+
* MySQL 5.7+ / MariaDB (or XAMPP)

### Run (production style — one port)
```bash
cd garment-react
cd server && npm install && cd ..        # backend deps
cd client && npm install && npm run build && cd ..   # build React app
cd server && npm start                   # serves API + built app on :3000
```
Open **http://localhost:3000** → landing page. On first start it creates the
`garment_billing` database, schema (incl. `billing_orders`), and **two isolated demo
shops** with sample data.

### 🔐 Demo logins

| Where | Username | Password |
|---|---|---|
| Style Hub Garments (Pro) — admin | `admin` | `admin@123` |
| Style Hub Garments — staff | `manager` / `cashier` | `manager@123` / `cashier@123` |
| Trendy Threads (Starter) — admin | `trendy` | `trendy@123` |
| **Platform Console** (`/platform`) | `platform` | `platform@123` |

Or hit **Start free trial** and create your own shop via `/signup`.

### Environment variables
```bash
DB_HOST=127.0.0.1 DB_USER=garment DB_PASS=garment123 DB_NAME=garment_billing PORT=3000
# Payments (omit for demo mode)
RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx
# Operator console
PLATFORM_USER=platform PLATFORM_PASS=platform@123 OPERATOR_SECRET=long-random-string
```

### Dev mode (hot reload)
```bash
cd server && npm start          # API on :3000
cd client && npm run dev        # Vite on :5173, proxies /api → :3000
```

---

## 🗂 Project structure

```
garment-react/
├── server/                     # Express.js + MySQL backend
│   ├── server.js               # REST API · tenant gate · plans/payments · platform · SPA
│   ├── db.js                   # pool init, schema apply, auto-seed
│   ├── seed.js                 # 2 demo tenants + sample data
│   ├── plans.js                # seed-only defaults; runtime plans come from subscription_plans
│   ├── razorpay.js             # Razorpay order creation + HMAC signature verification
│   ├── config.js               # DB / port configuration
│   └── database/schema.sql     # multi-tenant schema + billing_orders + platform_users
├── e2e-saas.sh                 # 109-check multi-tenant E2E suite
└── client/                     # React frontend (Vite)
    └── src/
        ├── App.jsx             # router + role-guarded + public routes
        ├── api.js              # fetch wrapper, formatters, receipt printing
        ├── context/AppContext.jsx
        ├── components/         # Layout (plan badge + trial/renewal banner), UI kit, InvoiceModal
        └── pages/              # Landing, Signup, Login, Platform, Billing, Dashboard, POS,
                                # Products, Categories, Stock, Purchases, Sales, Customers,
                                # Suppliers, Reports, Settings, Users, Profile
```

## 🔑 Key API endpoints
```
Public:   GET /api/plans · POST /api/signup
Auth:     POST /api/login   (unified — detects operator vs shop user) · POST /api/logout · GET /api/me
          PUT /api/me/profile · PUT /api/me/password
Billing:  GET /api/billing · POST /api/billing/checkout · POST /api/billing/verify
          POST /api/billing/upgrade                    (admin; demo/manual activation)
Platform: POST /api/platform/login · /logout · GET /api/platform/me
          GET /api/platform/overview · /tenants · /orders · /operators
          GET /api/platform/tenants/:id                  (deep shop monitor)
          POST /api/platform/tenants/:id/suspend · /activate · /extend
          PUT  /api/platform/tenants/:id/plan
          POST/PUT/DELETE /api/platform/operators        (owner only)
          GET/POST /api/platform/plans · PUT /api/platform/plans/:id
          POST /api/platform/plans/:id/toggle            (owner only)
          GET/PUT /api/platform/settings                 (owner only)
Data (all tenant-scoped):
  GET /api/dashboard · GET /api/reports/summary?from&to   (reports: Pro/Trial)
  GET/POST /api/products · GET /api/products/lookup?code=<barcode|sku>
  GET/POST /api/purchases · GET /api/sales · POST /api/sales · PUT /api/sales/:id/return
  GET /api/stock · POST /api/stock/adjust
  GET/POST /api/customers · /api/suppliers · /api/categories
  GET/POST/PUT/DELETE /api/users                          (admin; staff only)
  GET/PUT /api/settings
```

## ✅ Verification

`bash e2e-saas.sh` runs **109 checks** across 26 sections covering: public endpoints,
signup, tenant isolation, plan limits, single-admin enforcement, billing & upgrade,
**demo payment checkout/verify**, **renewals**, **downgrade protection**,
trial/subscription expiry `402`, suspended-tenant `403`, a full POS sale, role gates,
**platform console** (overview, suspend/activate, plan override, orders), **operator
accounts** (create, login, permission gates, disable/re-enable, password reset, delete
protection), **deep shop monitoring** (detail view, subscription extend), **rate
limiting** (`429`), **security headers**, logout, plus the newer surface: **unified
login** (operator + shop through one endpoint), **subscription plan CRUD** (create →
instantly live, edit, duplicate-key & trial guards, activate/deactivate), **platform
settings** (new-shop defaults inherited at signup), **per-shop GST on/off** (zero-tax
invoices when off, tax back on when re-enabled), live plan rendering on landing/billing,
and custom-plan assignment. **All 109 pass.**

Razorpay HMAC verification is additionally validated with a known secret (valid
signature accepted; tampered/wrong-order signatures rejected).

To reset everything: `DROP DATABASE garment_billing;` and restart the server.
