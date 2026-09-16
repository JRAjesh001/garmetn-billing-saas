import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

// ================================================================
// API CONFIG
// ================================================================

const API_URL = import.meta.env.VITE_API_URL || "https://api.fillwithbill.com";

// ================================================================
// PLATFORM API HELPER
// IMPORTANT: Do NOT use fetch("/api/...") here.
// It must call api.fillwithbill.com.
// ================================================================

async function pf(path, opts = {}) {
  const url = `${API_URL}${path}`;

  console.log("PLATFORM API:", url);

  const fetchOptions = {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  };

  if (opts.body && typeof opts.body !== "string") {
    fetchOptions.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, fetchOptions);

  const data = await res.json().catch(() => ({}));

  console.log("PLATFORM RESPONSE:", path, data);

  if (!res.ok) {
    throw new Error(
      data?.error || data?.message || `Request failed (${res.status})`,
    );
  }

  return data;
}

// ================================================================
// SAFE HELPERS
// ================================================================

const asArray = (value) => (Array.isArray(value) ? value : []);

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const money = (value) => {
  return `₹${num(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtDate = (value) => {
  if (!value) return "-";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toLocaleString("en-IN");
};

// ================================================================
// NORMALIZE OVERVIEW
// ================================================================

function normalizeOverview(raw) {
  const data = asObject(raw);

  return {
    gateway: asObject(data.gateway),

    tenants: {
      total: num(data?.tenants?.total),
      active: num(data?.tenants?.active),
      suspended: num(data?.tenants?.suspended),
    },

    mrr: num(data.mrr),

    users: num(data.users),

    signups_30: num(data.signups_30),

    sales_30: num(data.sales_30),

    sales_today: {
      count: num(data?.sales_today?.count),
      total: num(data?.sales_today?.total),
    },

    plans: asObject(data.plans),

    signup_trend: asArray(data.signup_trend),
  };
}

// ================================================================
// MAIN COMPONENT
// ================================================================

export default function Platform() {
  const [operator, setOperator] = useState(null);

  const [overview, setOverview] = useState(normalizeOverview({}));

  const [tenants, setTenants] = useState([]);
  const [orders, setOrders] = useState([]);
  const [plans, setPlans] = useState([]);

  const [operators, setOperators] = useState([]);
  const [settings, setSettings] = useState({});

  const [activeTab, setActiveTab] = useState("overview");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [selectedTenant, setSelectedTenant] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  // ==============================================================
  // LOAD PLATFORM DATA
  // ==============================================================

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      // ------------------------------------------------------------
      // FIRST: PLATFORM AUTH
      // ------------------------------------------------------------

      const me = await pf("/api/platform/me");

      console.log("PLATFORM ME:", me);

      const currentOperator = me?.operator || me?.user || me;

      if (!currentOperator) {
        throw new Error("Platform operator session not found.");
      }

      setOperator(currentOperator);

      // ------------------------------------------------------------
      // LOAD MAIN DATA
      // ------------------------------------------------------------

      const [overviewResponse, tenantsResponse, ordersResponse, plansResponse] =
        await Promise.all([
          pf("/api/platform/overview"),
          pf("/api/platform/tenants"),
          pf("/api/platform/orders"),
          pf("/api/platform/plans"),
        ]);

      // ------------------------------------------------------------
      // OVERVIEW
      // ------------------------------------------------------------

      setOverview(
        normalizeOverview(
          overviewResponse?.overview ||
            overviewResponse?.data ||
            overviewResponse,
        ),
      );

      // ------------------------------------------------------------
      // TENANTS
      // ------------------------------------------------------------

      const tenantRows =
        tenantsResponse?.tenants ||
        tenantsResponse?.data ||
        tenantsResponse?.rows ||
        tenantsResponse;

      setTenants(asArray(tenantRows));

      // ------------------------------------------------------------
      // ORDERS
      // ------------------------------------------------------------

      const orderRows =
        ordersResponse?.orders ||
        ordersResponse?.data ||
        ordersResponse?.rows ||
        ordersResponse;

      setOrders(asArray(orderRows));

      // ------------------------------------------------------------
      // PLANS
      // ------------------------------------------------------------

      const planRows =
        plansResponse?.plans ||
        plansResponse?.data ||
        plansResponse?.rows ||
        plansResponse;

      setPlans(asArray(planRows));

      // ------------------------------------------------------------
      // OWNER-ONLY DATA
      // ------------------------------------------------------------

      if (
        currentOperator?.role === "owner" ||
        currentOperator?.role === "admin"
      ) {
        try {
          const operatorsResponse = await pf("/api/platform/operators");

          const operatorRows =
            operatorsResponse?.operators ||
            operatorsResponse?.data ||
            operatorsResponse?.rows ||
            operatorsResponse;

          setOperators(asArray(operatorRows));
        } catch (err) {
          console.warn("Could not load platform operators:", err);
          setOperators([]);
        }

        try {
          const settingsResponse = await pf("/api/platform/settings");

          setSettings(
            asObject(
              settingsResponse?.settings ||
                settingsResponse?.data ||
                settingsResponse,
            ),
          );
        } catch (err) {
          console.warn("Could not load platform settings:", err);
          setSettings({});
        }
      }
    } catch (err) {
      console.error("PLATFORM LOAD ERROR:", err);

      setError(err?.message || "Unable to load platform console.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ==============================================================
  // INITIAL LOAD
  // ==============================================================

  useEffect(() => {
    load();
  }, [load]);

  // ==============================================================
  // FILTER TENANTS
  // ==============================================================

  const filteredTenants = useMemo(() => {
    const rows = asArray(tenants);

    const q = search.trim().toLowerCase();

    if (!q) {
      return rows;
    }

    return rows.filter((tenant) => {
      const text = [
        tenant?.name,
        tenant?.business_name,
        tenant?.shop_name,
        tenant?.slug,
        tenant?.username,
        tenant?.email,
        tenant?.phone,
        tenant?.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });
  }, [tenants, search]);

  // ==============================================================
  // LOGOUT
  // ==============================================================

  async function logout() {
    try {
      await pf("/api/platform/logout", {
        method: "POST",
      });
    } catch (err) {
      console.warn("Logout error:", err);
    }

    window.location.href = "/platform/login";
  }

  // ==============================================================
  // TAB
  // ==============================================================

  function changeTab(tab) {
    setActiveTab(tab);
    setSidebarOpen(false);
  }

  // ==============================================================
  // LOADING
  // ==============================================================

  if (loading) {
    return (
      <div style={styles.loadingPage}>
        <div style={styles.spinner}></div>

        <h3 style={{ marginTop: 20 }}>Loading Platform Console</h3>

        <p style={{ color: "#64748b" }}>Connecting to {API_URL}</p>
      </div>
    );
  }

  // ==============================================================
  // ERROR
  // ==============================================================

  if (error) {
    return (
      <div style={styles.errorPage}>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>!</div>

          <h2>Platform Console Error</h2>

          <p style={{ color: "#64748b" }}>{error}</p>

          <div style={styles.errorUrl}>
            API:
            <br />
            {API_URL}
          </div>

          <div style={styles.errorActions}>
            <button className="btn btn-primary" onClick={load}>
              Retry
            </button>

            <button
              className="btn btn-outline-secondary"
              onClick={() => (window.location.href = "/platform/login")}
            >
              Platform Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==============================================================
  // DASHBOARD
  // ==============================================================

  return (
    <div className="platform-layout">
      {/* ==========================================================
          MOBILE BACKDROP
      ========================================================== */}

      {sidebarOpen && (
        <div
          className="platform-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ==========================================================
          SIDEBAR
      ========================================================== */}

      <aside className={`platform-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="platform-brand">
          <div className="brand-logo">FB</div>

          <div>
            <div className="brand-title">FillWithBill</div>

            <div className="brand-subtitle">Platform Console</div>
          </div>
        </div>

        <div className="platform-nav">
          <NavButton
            active={activeTab === "overview"}
            onClick={() => changeTab("overview")}
            icon="▦"
          >
            Overview
          </NavButton>

          <NavButton
            active={activeTab === "shops"}
            onClick={() => changeTab("shops")}
            icon="▣"
          >
            Shops
          </NavButton>

          <NavButton
            active={activeTab === "payments"}
            onClick={() => changeTab("payments")}
            icon="₹"
          >
            Payments
          </NavButton>

          <NavButton
            active={activeTab === "plans"}
            onClick={() => changeTab("plans")}
            icon="◇"
          >
            Plans
          </NavButton>

          {(operator?.role === "owner" || operator?.role === "admin") && (
            <>
              <NavButton
                active={activeTab === "operators"}
                onClick={() => changeTab("operators")}
                icon="♙"
              >
                Operators
              </NavButton>

              <NavButton
                active={activeTab === "settings"}
                onClick={() => changeTab("settings")}
                icon="⚙"
              >
                Settings
              </NavButton>
            </>
          )}
        </div>

        <div className="platform-sidebar-bottom">
          <div className="operator-box">
            <div className="operator-avatar">
              {String(operator?.name || operator?.username || "O")
                .charAt(0)
                .toUpperCase()}
            </div>

            <div className="operator-info">
              <strong>
                {operator?.name || operator?.username || "Operator"}
              </strong>

              <small>{operator?.role || "operator"}</small>
            </div>
          </div>

          <button className="logout-button" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      {/* ==========================================================
          MAIN
      ========================================================== */}

      <main className="platform-main">
        {/* TOPBAR */}

        <header className="platform-topbar">
          <button
            className="mobile-menu-button"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <div>
            <h1>
              {activeTab === "overview" && "Platform Overview"}

              {activeTab === "shops" && "Shop Management"}

              {activeTab === "payments" && "Payments"}

              {activeTab === "plans" && "Subscription Plans"}

              {activeTab === "operators" && "Platform Operators"}

              {activeTab === "settings" && "Platform Settings"}
            </h1>

            <div className="breadcrumb">FillWithBill / Platform</div>
          </div>

          <div className="topbar-actions">
            <button className="btn btn-outline-primary" onClick={load}>
              ↻ Refresh
            </button>

            <Link to="/" className="btn btn-primary">
              Main App
            </Link>
          </div>
        </header>

        {/* CONTENT */}

        <div className="platform-content">
          {activeTab === "overview" && (
            <OverviewTab
              overview={overview}
              tenants={tenants}
              orders={orders}
              plans={plans}
              onRefresh={load}
            />
          )}

          {activeTab === "shops" && (
            <ShopsTab
              tenants={filteredTenants}
              search={search}
              setSearch={setSearch}
              onOpen={(tenant) => setSelectedTenant(tenant)}
            />
          )}

          {activeTab === "payments" && <PaymentsTab orders={orders} />}

          {activeTab === "plans" && (
            <PlansTab plans={plans} onOpen={(plan) => setSelectedPlan(plan)} />
          )}

          {activeTab === "operators" && <OperatorsTab operators={operators} />}

          {activeTab === "settings" && <SettingsTab settings={settings} />}
        </div>
      </main>

      {/* ==========================================================
          TENANT MODAL
      ========================================================== */}

      {selectedTenant && (
        <Modal title="Shop Details" onClose={() => setSelectedTenant(null)}>
          <TenantDetails tenant={selectedTenant} />
        </Modal>
      )}

      {/* ==========================================================
          PLAN MODAL
      ========================================================== */}

      {selectedPlan && (
        <Modal title="Plan Details" onClose={() => setSelectedPlan(null)}>
          <PlanDetails plan={selectedPlan} />
        </Modal>
      )}

      {/* ==========================================================
          CSS
      ========================================================== */}

      <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f8fafc;
          font-family:
            Inter,
            Segoe UI,
            system-ui,
            -apple-system,
            sans-serif;
        }

        .platform-layout {
          min-height: 100vh;
          background: #f8fafc;
          color: #0f172a;
        }

        .platform-sidebar {
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          width: 260px;
          background: #0f172a;
          color: white;
          display: flex;
          flex-direction: column;
          z-index: 1050;
        }

        .platform-brand {
          height: 76px;
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }

        .brand-logo {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
        }

        .brand-title {
          font-weight: 800;
          font-size: 16px;
        }

        .brand-subtitle {
          color: #94a3b8;
          font-size: 11px;
          margin-top: 2px;
        }

        .platform-nav {
          padding: 18px 12px;
          flex: 1;
        }

        .platform-nav-button {
          width: 100%;
          border: 0;
          background: transparent;
          color: #cbd5e1;
          padding: 11px 13px;
          margin-bottom: 5px;
          border-radius: 9px;
          text-align: left;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 14px;
        }

        .platform-nav-button:hover {
          background: rgba(255,255,255,.07);
          color: white;
        }

        .platform-nav-button.active {
          background: #2563eb;
          color: white;
        }

        .nav-icon {
          width: 20px;
          text-align: center;
        }

        .platform-sidebar-bottom {
          padding: 15px;
          border-top: 1px solid rgba(255,255,255,.08);
        }

        .operator-box {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .operator-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #334155;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
        }

        .operator-info {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .operator-info strong {
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .operator-info small {
          color: #94a3b8;
          text-transform: capitalize;
        }

        .logout-button {
          width: 100%;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.04);
          color: #e2e8f0;
          border-radius: 8px;
          padding: 9px;
          cursor: pointer;
        }

        .platform-main {
          margin-left: 260px;
          min-height: 100vh;
        }

        .platform-topbar {
          min-height: 76px;
          background: white;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 25px;
          gap: 15px;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .platform-topbar h1 {
          font-size: 21px;
          margin: 0;
          font-weight: 750;
        }

        .breadcrumb {
          color: #64748b;
          font-size: 12px;
          margin-top: 3px;
        }

        .topbar-actions {
          display: flex;
          gap: 8px;
        }

        .mobile-menu-button {
          display: none;
          border: 0;
          background: #f1f5f9;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 20px;
        }

        .platform-content {
          padding: 25px;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }

        .stat-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 18px;
        }

        .stat-label {
          color: #64748b;
          font-size: 12px;
          margin-bottom: 7px;
        }

        .stat-value {
          font-size: 25px;
          font-weight: 800;
          color: #0f172a;
        }

        .stat-sub {
          color: #64748b;
          font-size: 12px;
          margin-top: 5px;
        }

        .content-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 20px;
        }

        .card-header {
          padding: 15px 18px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .card-header h3 {
          margin: 0;
          font-size: 16px;
        }

        .card-body {
          padding: 18px;
        }

        .table-wrap {
          overflow-x: auto;
        }

        .platform-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 700px;
        }

        .platform-table th {
          background: #f8fafc;
          color: #64748b;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .04em;
          text-align: left;
          padding: 11px 14px;
          border-bottom: 1px solid #e2e8f0;
        }

        .platform-table td {
          padding: 13px 14px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 13px;
        }

        .platform-table tr:last-child td {
          border-bottom: 0;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 700;
        }

        .badge-success {
          background: #dcfce7;
          color: #166534;
        }

        .badge-warning {
          background: #fef3c7;
          color: #92400e;
        }

        .badge-danger {
          background: #fee2e2;
          color: #991b1b;
        }

        .badge-secondary {
          background: #e2e8f0;
          color: #475569;
        }

        .search-box {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 9px 11px;
          min-width: 240px;
          outline: none;
        }

        .search-box:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,.1);
        }

        .empty-state {
          padding: 45px 20px;
          text-align: center;
          color: #64748b;
        }

        .plan-grid {
          display: grid;
          grid-template-columns:
            repeat(3, minmax(0, 1fr));
          gap: 15px;
        }

        .plan-card {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 18px;
          background: white;
        }

        .plan-card h3 {
          margin: 0 0 5px;
        }

        .plan-price {
          font-size: 27px;
          font-weight: 800;
          margin: 12px 0;
        }

        .settings-grid {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 15px;
        }

        .setting-row {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          padding: 12px 0;
          border-bottom: 1px solid #f1f5f9;
        }

        .setting-key {
          color: #64748b;
          font-size: 13px;
        }

        .setting-value {
          font-weight: 600;
          font-size: 13px;
          text-align: right;
          word-break: break-word;
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15,23,42,.55);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .modal-box {
          width: min(700px, 100%);
          max-height: 90vh;
          overflow: auto;
          background: white;
          border-radius: 14px;
          box-shadow: 0 20px 50px rgba(0,0,0,.25);
        }

        .modal-header {
          padding: 17px 20px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h3 {
          margin: 0;
        }

        .modal-close {
          border: 0;
          background: #f1f5f9;
          border-radius: 7px;
          width: 34px;
          height: 34px;
          cursor: pointer;
        }

        .modal-body {
          padding: 20px;
        }

        .detail-grid {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 15px;
        }

        .detail-item {
          border: 1px solid #e2e8f0;
          border-radius: 9px;
          padding: 12px;
        }

        .detail-label {
          color: #64748b;
          font-size: 11px;
          margin-bottom: 4px;
        }

        .detail-value {
          font-weight: 650;
          word-break: break-word;
        }

        .loadingPage,
        .loading-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #f8fafc;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #e2e8f0;
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .errorPage,
        .error-page {
          min-height: 100vh;
          background: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .errorCard {
          width: min(550px, 100%);
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 30px;
          text-align: center;
          box-shadow: 0 10px 30px rgba(15,23,42,.08);
        }

        .errorIcon {
          width: 50px;
          height: 50px;
          margin: auto;
          border-radius: 50%;
          background: #fee2e2;
          color: #b91c1c;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 25px;
          font-weight: 800;
        }

        .errorUrl {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 12px;
          border-radius: 8px;
          text-align: left;
          font-size: 12px;
          word-break: break-all;
          margin: 15px 0;
        }

        .errorActions {
          display: flex;
          justify-content: center;
          gap: 8px;
        }

        .platform-backdrop {
          display: none;
        }

        @media (max-width: 1100px) {
          .dashboard-grid {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }

          .plan-grid {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 991.98px) {
          .platform-sidebar {
            transform: translateX(-100%);
            transition: transform .25s ease;
          }

          .platform-sidebar.open {
            transform: translateX(0);
          }

          .platform-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.4);
            z-index: 1040;
          }

          .platform-main {
            margin-left: 0;
          }

          .mobile-menu-button {
            display: block;
          }

          .platform-topbar {
            padding: 12px 15px;
          }

          .platform-content {
            padding: 15px;
          }
        }

        @media (max-width: 700px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }

          .plan-grid {
            grid-template-columns: 1fr;
          }

          .settings-grid {
            grid-template-columns: 1fr;
          }

          .detail-grid {
            grid-template-columns: 1fr;
          }

          .topbar-actions .btn:first-child {
            display: none;
          }

          .platform-topbar h1 {
            font-size: 17px;
          }

          .search-box {
            width: 100%;
            min-width: 0;
          }

          .card-header {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

// ================================================================
// NAV BUTTON
// ================================================================

function NavButton({ active, onClick, icon, children }) {
  return (
    <button
      className={`platform-nav-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="nav-icon">{icon}</span>

      <span>{children}</span>
    </button>
  );
}

// ================================================================
// OVERVIEW
// ================================================================

function OverviewTab({ overview, tenants, orders, plans }) {
  const recentTenants = asArray(tenants).slice(0, 8);
  const recentOrders = asArray(orders).slice(0, 8);

  const activePlans = asArray(plans).filter(
    (plan) => plan?.is_active !== 0 && plan?.is_active !== false,
  );

  return (
    <>
      <div className="dashboard-grid">
        <StatCard
          label="Total Shops"
          value={overview?.tenants?.total ?? 0}
          sub={`${overview?.tenants?.active ?? 0} active · ${
            overview?.tenants?.suspended ?? 0
          } suspended`}
        />

        <StatCard
          label="Monthly Recurring Revenue"
          value={money(overview?.mrr ?? 0)}
          sub="Current platform MRR"
        />

        <StatCard
          label="Total Users"
          value={overview?.users ?? 0}
          sub="Across all shops"
        />

        <StatCard
          label="New Signups"
          value={overview?.signups_30 ?? 0}
          sub="Last 30 days"
        />

        <StatCard
          label="Sales - 30 Days"
          value={money(overview?.sales_30 ?? 0)}
          sub="Platform sales"
        />

        <StatCard
          label="Today's Bills"
          value={overview?.sales_today?.count ?? 0}
          sub={money(overview?.sales_today?.total ?? 0)}
        />

        <StatCard
          label="Active Plans"
          value={activePlans.length}
          sub="Available subscription plans"
        />

        <StatCard
          label="Payment Gateway"
          value={overview?.gateway?.status || "Unknown"}
          sub={overview?.gateway?.provider || "Payment gateway"}
        />
      </div>

      <div className="content-card">
        <div className="card-header">
          <h3>Recent Shops</h3>
        </div>

        <div className="table-wrap">
          {recentTenants.length === 0 ? (
            <div className="empty-state">No shops found.</div>
          ) : (
            <table className="platform-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Created</th>
                </tr>
              </thead>

              <tbody>
                {recentTenants.map((tenant, index) => (
                  <tr key={tenant?.id ?? tenant?.tenant_id ?? index}>
                    <td>
                      <strong>
                        {tenant?.name ||
                          tenant?.business_name ||
                          tenant?.shop_name ||
                          "-"}
                      </strong>
                    </td>

                    <td>
                      {tenant?.owner_name ||
                        tenant?.username ||
                        tenant?.email ||
                        "-"}
                    </td>

                    <td>
                      <StatusBadge
                        status={
                          tenant?.status ||
                          (tenant?.is_active ? "active" : "inactive")
                        }
                      />
                    </td>

                    <td>{tenant?.plan_name || tenant?.plan || "-"}</td>

                    <td>{fmtDate(tenant?.created_at || tenant?.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="content-card">
        <div className="card-header">
          <h3>Recent Payments</h3>
        </div>

        <div className="table-wrap">
          {recentOrders.length === 0 ? (
            <div className="empty-state">No payment records found.</div>
          ) : (
            <table className="platform-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Shop</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>

              <tbody>
                {recentOrders.map((order, index) => (
                  <tr key={order?.id ?? order?.order_id ?? index}>
                    <td>
                      {order?.order_number ||
                        order?.invoice_no ||
                        order?.id ||
                        "-"}
                    </td>

                    <td>{order?.tenant_name || order?.shop_name || "-"}</td>

                    <td>
                      <strong>
                        {money(order?.amount ?? order?.total ?? 0)}
                      </strong>
                    </td>

                    <td>
                      <StatusBadge
                        status={order?.status || order?.payment_status}
                      />
                    </td>

                    <td>{fmtDate(order?.created_at || order?.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

// ================================================================
// SHOPS
// ================================================================

function ShopsTab({ tenants, search, setSearch, onOpen }) {
  return (
    <div className="content-card">
      <div className="card-header">
        <h3>Shops ({asArray(tenants).length})</h3>

        <input
          className="search-box"
          placeholder="Search shop..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        {asArray(tenants).length === 0 ? (
          <div className="empty-state">No shops found.</div>
        ) : (
          <table className="platform-table">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Slug</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {tenants.map((tenant, index) => (
                <tr key={tenant?.id ?? tenant?.tenant_id ?? index}>
                  <td>
                    <strong>
                      {tenant?.name ||
                        tenant?.business_name ||
                        tenant?.shop_name ||
                        "-"}
                    </strong>
                  </td>

                  <td>{tenant?.slug || "-"}</td>

                  <td>
                    {tenant?.owner_name ||
                      tenant?.username ||
                      tenant?.email ||
                      "-"}
                  </td>

                  <td>{tenant?.phone || "-"}</td>

                  <td>{tenant?.plan_name || tenant?.plan || "-"}</td>

                  <td>
                    <StatusBadge
                      status={
                        tenant?.status ||
                        (tenant?.is_active ? "active" : "inactive")
                      }
                    />
                  </td>

                  <td>{fmtDate(tenant?.created_at || tenant?.createdAt)}</td>

                  <td>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => onOpen(tenant)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ================================================================
// PAYMENTS
// ================================================================

function PaymentsTab({ orders }) {
  return (
    <div className="content-card">
      <div className="card-header">
        <h3>Payments ({asArray(orders).length})</h3>
      </div>

      <div className="table-wrap">
        {asArray(orders).length === 0 ? (
          <div className="empty-state">No payments found.</div>
        ) : (
          <table className="platform-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Shop</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>

            <tbody>
              {orders.map((order, index) => (
                <tr key={order?.id ?? order?.order_id ?? index}>
                  <td>
                    {order?.order_number ||
                      order?.invoice_no ||
                      order?.id ||
                      "-"}
                  </td>

                  <td>{order?.tenant_name || order?.shop_name || "-"}</td>

                  <td>{order?.customer_name || order?.customer || "-"}</td>

                  <td>
                    <strong>{money(order?.amount ?? order?.total ?? 0)}</strong>
                  </td>

                  <td>{order?.payment_method || order?.method || "-"}</td>

                  <td>
                    <StatusBadge
                      status={order?.payment_status || order?.status}
                    />
                  </td>

                  <td>{fmtDate(order?.created_at || order?.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ================================================================
// PLANS
// ================================================================

function PlansTab({ plans, onOpen }) {
  const rows = asArray(plans);

  return (
    <>
      {rows.length === 0 ? (
        <div className="content-card">
          <div className="empty-state">No subscription plans found.</div>
        </div>
      ) : (
        <div className="plan-grid">
          {rows.map((plan, index) => (
            <div className="plan-card" key={plan?.id ?? index}>
              <h3>{plan?.name || plan?.plan_name || "Plan"}</h3>

              <div className="plan-price">
                {money(plan?.price ?? plan?.monthly_price ?? 0)}
                <small
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  /month
                </small>
              </div>

              <p
                style={{
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                {plan?.description || "Subscription plan"}
              </p>

              <div
                style={{
                  marginBottom: 15,
                }}
              >
                <StatusBadge
                  status={
                    plan?.is_active === false || plan?.is_active === 0
                      ? "inactive"
                      : "active"
                  }
                />
              </div>

              <button
                className="btn btn-outline-primary w-100"
                onClick={() => onOpen(plan)}
              >
                View Plan
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ================================================================
// OPERATORS
// ================================================================

function OperatorsTab({ operators }) {
  return (
    <div className="content-card">
      <div className="card-header">
        <h3>Platform Operators ({asArray(operators).length})</h3>
      </div>

      <div className="table-wrap">
        {asArray(operators).length === 0 ? (
          <div className="empty-state">No platform operators found.</div>
        ) : (
          <table className="platform-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>
              {operators.map((item, index) => (
                <tr key={item?.id ?? item?.operator_id ?? index}>
                  <td>{item?.name || "-"}</td>

                  <td>{item?.username || "-"}</td>

                  <td>{item?.email || "-"}</td>

                  <td>{item?.role || "-"}</td>

                  <td>
                    <StatusBadge
                      status={
                        item?.status ||
                        (item?.is_active ? "active" : "inactive")
                      }
                    />
                  </td>

                  <td>{fmtDate(item?.created_at || item?.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ================================================================
// SETTINGS
// ================================================================

function SettingsTab({ settings }) {
  const entries = Object.entries(asObject(settings));

  return (
    <div className="content-card">
      <div className="card-header">
        <h3>Platform Settings</h3>
      </div>

      <div className="card-body">
        {entries.length === 0 ? (
          <div className="empty-state">No settings found.</div>
        ) : (
          entries.map(([key, value]) => (
            <div className="setting-row" key={key}>
              <div className="setting-key">{key}</div>

              <div className="setting-value">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value ?? "-")}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ================================================================
// STAT CARD
// ================================================================

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>

      <div className="stat-value">{value}</div>

      <div className="stat-sub">{sub}</div>
    </div>
  );
}

// ================================================================
// STATUS BADGE
// ================================================================

function StatusBadge({ status }) {
  const value = String(status || "unknown").toLowerCase();

  let cls = "badge-secondary";

  if (
    ["active", "paid", "success", "completed", "complete", "enabled"].includes(
      value,
    )
  ) {
    cls = "badge-success";
  }

  if (["pending", "trial", "processing", "warning"].includes(value)) {
    cls = "badge-warning";
  }

  if (
    [
      "suspended",
      "inactive",
      "cancelled",
      "canceled",
      "failed",
      "expired",
      "disabled",
    ].includes(value)
  ) {
    cls = "badge-danger";
  }

  return <span className={`badge ${cls}`}>{value}</span>;
}

// ================================================================
// TENANT DETAILS
// ================================================================

function TenantDetails({ tenant }) {
  const data = asObject(tenant);

  const fields = [
    ["ID", data.id],
    ["Shop Name", data.name || data.business_name || data.shop_name],
    ["Slug", data.slug],
    ["Owner", data.owner_name || data.username || data.email],
    ["Email", data.email],
    ["Phone", data.phone],
    ["Plan", data.plan_name || data.plan],
    ["Status", data.status],
    ["Created", fmtDate(data.created_at || data.createdAt)],
  ];

  return (
    <div className="detail-grid">
      {fields.map(([label, value]) => (
        <div className="detail-item" key={label}>
          <div className="detail-label">{label}</div>

          <div className="detail-value">{value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}

// ================================================================
// PLAN DETAILS
// ================================================================

function PlanDetails({ plan }) {
  const data = asObject(plan);

  const fields = [
    ["ID", data.id],
    ["Name", data.name || data.plan_name],
    ["Price", money(data.price ?? data.monthly_price ?? 0)],
    ["Description", data.description],
    ["Billing Period", data.billing_period || data.interval || "monthly"],
    [
      "Status",
      data.is_active === false || data.is_active === 0 ? "Inactive" : "Active",
    ],
  ];

  return (
    <div className="detail-grid">
      {fields.map(([label, value]) => (
        <div className="detail-item" key={label}>
          <div className="detail-label">{label}</div>

          <div className="detail-value">{value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}

// ================================================================
// MODAL
// ================================================================

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-box">
        <div className="modal-header">
          <h3>{title}</h3>

          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
