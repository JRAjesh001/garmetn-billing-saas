import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { hasRole, api } from "../api";
import { Modal, RoleBadge, UserTile } from "./ui";

const NAV = [
  {
    label: "MAIN MENU",
    items: [
      {
        to: "/dashboard",
        icon: "speedometer2",
        label: "Dashboard",
        role: "cashier",
        title: "Dashboard",
        sub: "Business overview at a glance",
      },
      {
        to: "/pos",
        icon: "cart3",
        label: "POS Billing",
        role: "cashier",
        title: "POS Billing",
        sub: "Scan barcode, search products and create invoices",
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        to: "/products",
        icon: "tags",
        label: "Products / Items",
        role: "cashier",
        title: "Products / Items",
        sub: "Size, color, SKU, barcode, pricing & stock",
      },
      {
        to: "/categories",
        icon: "collection",
        label: "Categories",
        role: "manager",
        title: "Categories",
        sub: "Product / item categories",
      },
      {
        to: "/stock",
        icon: "boxes",
        label: "Stock Management",
        role: "cashier",
        title: "Stock Management",
        sub: "Live inventory, valuation & adjustments",
      },
    ],
  },
  {
    label: "BUSINESS",
    items: [
      {
        to: "/purchases",
        icon: "truck",
        label: "Purchases",
        role: "manager",
        title: "Purchases",
        sub: "Stock-in entries from suppliers",
      },
      {
        to: "/sales",
        icon: "receipt",
        label: "Sales / Invoices",
        role: "cashier",
        title: "Sales / Invoices",
        sub: "All bills created at the POS",
      },
      {
        to: "/customers",
        icon: "people",
        label: "Customers",
        role: "cashier",
        title: "Customers",
        sub: "Customer directory with purchase history",
      },
      {
        to: "/suppliers",
        icon: "building",
        label: "Suppliers",
        role: "manager",
        title: "Suppliers",
        sub: "Vendors you buy stock from",
      },
      {
        to: "/reports",
        icon: "graph-up",
        label: "Reports",
        role: "manager",
        title: "Reports",
        sub: "Sales, profit, GST and category analytics",
      },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      {
        to: "/users",
        icon: "person-lock",
        label: "Users & Login",
        role: "admin",
        title: "Users & Login",
        sub: "Staff accounts — one admin (owner) per shop",
      },
      // { to: '/billing', icon: 'credit-card-2-front', label: 'Plan & Billing', role: 'admin', title: 'Plan & Billing', sub: 'Subscription, usage and upgrades' },
      {
        to: "/settings",
        icon: "gear",
        label: "Shop Settings",
        role: "manager",
        title: "Shop Settings",
        sub: "Receipt header & shop information",
      },
    ],
  },
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-end d-none d-sm-block">
      <div className="sub">
        {now.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
      </div>
      <div className="fw-semibold" style={{ fontSize: ".9rem" }}>
        {now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </div>
  );
}

export default function Layout() {
  const { me, shop, logout, toast } = useApp();
  const [sbOpen, setSbOpen] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ cur: "", next: "", conf: "" });
  const loc = useLocation();

  useEffect(() => {
    setSbOpen(false);
    setDdOpen(false);
  }, [loc.pathname]);

  const current =
    NAV.flatMap((s) => s.items).find((i) => loc.pathname.startsWith(i.to)) ||
    NAV[0].items[0];
  const planBadge =
    { trial: "warning text-dark", starter: "info", pro: "success" }[me.plan] ||
    "secondary";

  const savePw = async () => {
    if (pw.next !== pw.conf)
      return toast("New passwords do not match", "error");
    try {
      await api("/api/me/password", {
        method: "PUT",
        body: { current: pw.cur, next: pw.next },
      });
      toast("Password updated");
      setPwOpen(false);
      setPw({ cur: "", next: "", conf: "" });
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <>
      <aside className={`sidebar ${sbOpen ? "show" : ""}`}>
        {" "}
        <div className="brand">
          <div className="logo">
            <i className="bi bi-shop"></i>
          </div>
          <div>
            <b>{shop.shop_name || "GarmentPOS"}</b>
            <small>Billing &amp; Inventory</small>
          </div>
        </div>
        <nav>
          {NAV.map((sec) => {
            const items = sec.items.filter((i) => hasRole(me, i.role));
            if (!items.length) return null;
            return (
              <div key={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {items.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.to === "/"}
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    <i className={`bi bi-${i.icon}`}></i>
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <UserTile u={me} size={22} /> {me.name} ·{" "}
          <span className="text-capitalize">{me.role}</span>
        </div>
        <div className="sidebar-footer pt-0" style={{ borderTop: "none" }}>
          <span className={`badge bg-${planBadge} badge-soft text-capitalize`}>
            {me.plan_name || me.plan}
          </span>
          {me.days_left != null && (
            <span className="text-muted">
              {me.days_left > 0 ? `${me.days_left} days left` : "expired"}
            </span>
          )}
        </div>
      </aside>
      {sbOpen && (
        <div
          className="backdrop d-block"
          onClick={() => setSbOpen(false)}
        ></div>
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="btn btn-link text-dark d-lg-none p-0 me-1"
            onClick={() => setSbOpen(true)}
          >
            <i className="bi bi-list fs-3"></i>
          </button>
          <div>
            <h1>
              {loc.pathname === "/profile" ? "My Profile" : current.title}
            </h1>
            <div className="sub">
              {loc.pathname === "/profile"
                ? "Your account details, avatar and password"
                : current.sub}
            </div>
          </div>
          <div className="ms-auto d-flex align-items-center gap-3">
            <Clock />
            <div className="dropdown">
              <button
                className="btn btn-light btn-sm dropdown-toggle border d-flex align-items-center gap-2"
                onClick={() => setDdOpen((o) => !o)}
              >
                <UserTile u={me} size={26} /> {me.name}{" "}
                <RoleBadge role={me.role} />
              </button>
              <div
                className={`dropdown-menu dropdown-menu-end shadow-sm ${ddOpen ? "show" : ""}`}
                style={{ position: "absolute" }}
              >
                <h6 className="dropdown-header">@{me.username}</h6>
                <Link className="dropdown-item" to="/profile">
                  <i className="bi bi-person-lines-fill me-2"></i>My Profile
                </Link>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setDdOpen(false);
                    setPwOpen(true);
                  }}
                >
                  <i className="bi bi-key me-2"></i>Change Password
                </button>
                <hr className="dropdown-divider" />
                <button className="dropdown-item text-danger" onClick={logout}>
                  <i className="bi bi-box-arrow-right me-2"></i>Logout
                </button>
              </div>
            </div>
          </div>
        </header>
        {me.plan_expired ? (
          <div className="alert alert-danger mb-0 rounded-0 py-2 small text-center">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {me.plan === "trial"
              ? "Your free trial has ended"
              : "Your subscription has ended"}{" "}
            — billing is locked.{" "}
            {me.role === "admin" && (
              <Link to="/billing">
                {me.plan === "trial" ? "Choose a plan →" : "Renew now →"}
              </Link>
            )}
          </div>
        ) : me.plan === "trial" ? (
          <div className="alert alert-warning mb-0 rounded-0 py-2 small text-center">
            <i className="bi bi-hourglass-split me-1"></i>Free trial:{" "}
            <b>{me.trial_days_left} day(s)</b> remaining.{" "}
            {me.role === "admin" && <Link to="/billing">Upgrade now →</Link>}
          </div>
        ) : me.days_left != null && me.days_left <= 7 ? (
          <div className="alert alert-warning mb-0 rounded-0 py-2 small text-center">
            <i className="bi bi-arrow-repeat me-1"></i>Your{" "}
            <b>{me.plan_name}</b> subscription expires in{" "}
            <b>{me.days_left} day(s)</b>.{" "}
            {me.role === "admin" && <Link to="/billing">Renew now →</Link>}
          </div>
        ) : null}
        <div className="page-wrap">
          <Outlet />
        </div>
      </main>

      <Modal
        show={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change Password"
        size="modal-sm"
        footer={
          <button className="btn btn-primary btn-sm" onClick={savePw}>
            Update
          </button>
        }
      >
        <label className="form-label">Current password</label>
        <input
          type="password"
          className="form-control form-control-sm mb-2"
          value={pw.cur}
          onChange={(e) => setPw({ ...pw, cur: e.target.value })}
        />
        <label className="form-label">New password</label>
        <input
          type="password"
          className="form-control form-control-sm mb-2"
          value={pw.next}
          onChange={(e) => setPw({ ...pw, next: e.target.value })}
        />
        <label className="form-label">Confirm new password</label>
        <input
          type="password"
          className="form-control form-control-sm"
          value={pw.conf}
          onChange={(e) => setPw({ ...pw, conf: e.target.value })}
        />
      </Modal>
    </>
  );
}
