import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { money, fmtDate, downloadCSV } from '../api';
import { Modal } from '../components/ui';

// Local fetch helper — the platform console uses its own operator cookie.
async function pf(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const PLAN_BADGE = { trial: 'warning text-dark', starter: 'info', pro: 'success' };
const planBadge = p => PLAN_BADGE[p] || 'primary';

function Stat({ icon, label, value, sub }) {
  return (
    <div className="card h-100">
      <div className="card-body py-3">
        <div className="small text-muted"><i className={`bi bi-${icon} me-1`}></i>{label}</div>
        <div className="fs-4 fw-bold">{value}</div>
        {sub && <div className="small text-muted">{sub}</div>}
      </div>
    </div>
  );
}

// number input that allows "unlimited" (empty)
function LimitInput({ value, onChange, placeholder }) {
  return (
    <input type="number" min="1" className="form-control form-control-sm" placeholder={placeholder || 'Unlimited (blank)'}
      value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value) || 1)} />
  );
}

export default function Platform() {
  const [authed, setAuthed] = useState(null);       // null = checking
  const [op, setOp] = useState(null);
  const [tab, setTab] = useState('overview');
  const [sideOpen, setSideOpen] = useState(false);
  const [ov, setOv] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [orders, setOrders] = useState([]);
  const [plans, setPlans] = useState([]);
  const [operators, setOperators] = useState([]);
  const [psettings, setPsettings] = useState({});
  const [q, setQ] = useState('');
  const [fPlan, setFPlan] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [toastMsg, setToastMsg] = useState(null);

  // modals
  const [detail, setDetail] = useState(null);
  const [planModal, setPlanModal] = useState(null);     // set tenant plan
  const [planEdit, setPlanEdit] = useState(null);       // create/edit subscription plan
  const [opModal, setOpModal] = useState(null);         // operator create/edit

  const flash = (m, tone = 'success') => { setToastMsg({ m, tone }); setTimeout(() => setToastMsg(null), 3500); };

  const load = useCallback(async () => {
    try {
      const me = await pf('/api/platform/me');
      setOp(me);
      const [o, t, ords, pl] = await Promise.all([
        pf('/api/platform/overview'), pf('/api/platform/tenants'),
        pf('/api/platform/orders'), pf('/api/platform/plans')
      ]);
      setOv(o); setTenants(t); setOrders(ords); setPlans(pl);
      if (me.is_owner) {
        setOperators(await pf('/api/platform/operators'));
        setPsettings(await pf('/api/platform/settings'));
      }
      setAuthed(true);
    } catch { setAuthed(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // single sign-on: no operator session → use the main login page
  useEffect(() => {
    if (authed === false) window.location.href = '/login';
  }, [authed]);

  const act = async (fn, key, msg) => {
    setBusy(key);
    try { await fn(); await load(); if (detail) openDetail(detail.tenant.id); if (msg) flash(msg); }
    catch (ex) { flash(ex.message, 'danger'); }
    setBusy('');
  };

  const openDetail = async (id) => {
    setBusy('detail-' + id);
    try { setDetail(await pf(`/api/platform/tenants/${id}`)); }
    catch (ex) { flash(ex.message, 'danger'); }
    setBusy('');
  };

  const exportShops = () => downloadCSV('shops.csv', [
    ['ID', 'Shop', 'Owner Email', 'Phone', 'Plan', 'Status', 'GST', 'Users', 'Products', 'Sales', 'Revenue', 'Expiry', 'Created'],
    ...tenants.map(t => [t.id, t.shop_name, t.owner_email, t.phone || '', t.plan, t.status, '', t.users, t.products, t.sales, t.revenue,
      t.plan_expires_at ? t.plan_expires_at.slice(0, 10) : '', t.created_at ? String(t.created_at).slice(0, 10) : ''])
  ]);

  if (authed === null) return <div className="text-center py-5"><div className="spinner-border text-primary"></div><div className="small text-muted mt-2">Loading console…</div></div>;
  if (authed === false) return <div className="text-center py-5"><div className="spinner-border text-primary"></div><div className="small text-muted mt-2">Redirecting to login…</div></div>;

  const filtered = tenants.filter(t =>
    (!q || (t.shop_name + ' ' + t.owner_email).toLowerCase().includes(q.toLowerCase())) &&
    (!fPlan || t.plan === fPlan) && (!fStatus || t.status === fStatus));

  const NAV = [
    { label: 'MONITOR', items: [
      ['overview', 'speedometer2', 'Overview'],
      ['shops', 'shop', `Shops (${tenants.length})`],
      ['payments', 'credit-card-2-front', 'Payments']
    ]},
    { label: 'MANAGE', items: [
      ['plans', 'tags', 'Subscription Plans'],
      ...(op?.is_owner ? [['operators', 'person-badge', 'Operators'], ['settings', 'gear', 'Platform Settings']] : [])
    ]}
  ];

  const activePlans = plans.filter(p => p.is_active);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#eef1f6' }}>
      {/* toast */}
      {toastMsg && (
        <div className={`alert alert-${toastMsg.tone} position-fixed shadow-sm`} style={{ top: 14, right: 14, zIndex: 2000, minWidth: 260 }}>
          {toastMsg.m}
        </div>
      )}

      {/* ============ SIDEBAR ============ */}
      <aside style={{ width: 248, background: '#0f1b31', color: '#cbd5e1', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', flexShrink: 0 }}
        className="console-side">
        <div className="d-flex align-items-center gap-2 px-3 py-3" style={{ borderBottom: '1px solid #24334f' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="bi bi-hdd-rack"></i></span>
          <div>
            <div className="fw-bold text-white" style={{ lineHeight: 1.1 }}>GarmentBill</div>
            <div className="small" style={{ color: '#64748b', fontSize: '.72rem' }}>Platform Console</div>
          </div>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '.75rem .6rem' }}>
          {NAV.map(sec => (
            <div key={sec.label} className="mb-2">
              <div className="px-2 mb-1" style={{ fontSize: '.64rem', letterSpacing: 1, color: '#475569' }}>{sec.label}</div>
              {sec.items.map(([key, icon, label]) => (
                <button key={key} onClick={() => { setTab(key); setSideOpen(false); }}
                  className="btn w-100 text-start mb-1 d-flex align-items-center gap-2"
                  style={tab === key
                    ? { background: 'linear-gradient(90deg,#4f46e5,#6366f1)', color: '#fff', fontSize: '.86rem', borderRadius: 8 }
                    : { color: '#94a3b8', fontSize: '.86rem', borderRadius: 8 }}>
                  <i className={`bi bi-${icon}`} style={{ width: 18 }}></i>{label}
                </button>
              ))}
            </div>
          ))}
          <div className="px-2 mt-3" style={{ borderTop: '1px solid #24334f', paddingTop: '.6rem' }}>
            <Link to="/" className="btn w-100 text-start d-flex align-items-center gap-2" style={{ color: '#94a3b8', fontSize: '.86rem' }}>
              <i className="bi bi-box-arrow-in-left" style={{ width: 18 }}></i>Back to app
            </Link>
          </div>
        </nav>
        <div className="px-3 py-3" style={{ borderTop: '1px solid #24334f' }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#6366f1', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.8rem' }}>
              <i className="bi bi-person-fill"></i></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="text-white small fw-semibold text-truncate">{op?.name}</div>
              <div style={{ fontSize: '.68rem', color: '#64748b' }}>{op?.is_owner ? 'Owner' : 'Operator'} · @{op?.username}</div>
            </div>
            <button className="btn btn-sm btn-outline-light py-0 px-1" title="Log out"
              onClick={async () => { await pf('/api/platform/logout', { method: 'POST' }); window.location.href = '/login'; }}>
              <i className="bi bi-box-arrow-right"></i>
            </button>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <main style={{ flex: 1, minWidth: 0 }}>
        {/* topbar */}
        <header className="d-flex align-items-center gap-2 px-3 py-2 bg-white border-bottom">
          <button className="btn btn-sm btn-outline-secondary d-lg-none" onClick={() => setSideOpen(!sideOpen)}><i className="bi bi-list"></i></button>
          <h6 className="mb-0 fw-bold">
            {tab === 'overview' && <><i className="bi bi-speedometer2 me-2 text-primary"></i>Overview</>}
            {tab === 'shops' && <><i className="bi bi-shop me-2 text-primary"></i>Shops</>}
            {tab === 'payments' && <><i className="bi bi-credit-card-2-front me-2 text-primary"></i>Payments</>}
            {tab === 'plans' && <><i className="bi bi-tags me-2 text-primary"></i>Subscription Plans</>}
            {tab === 'operators' && <><i className="bi bi-person-badge me-2 text-primary"></i>Operator Accounts</>}
            {tab === 'settings' && <><i className="bi bi-gear me-2 text-primary"></i>Platform Settings</>}
          </h6>
          <span className="ms-auto small text-muted d-flex align-items-center gap-2">
            Gateway: <span className={`badge badge-soft ${ov?.gateway === 'razorpay' ? 'bg-success' : 'bg-secondary'}`}>{ov?.gateway || '…'}</span>
          </span>
        </header>

        <div style={{ padding: '1.1rem 1.25rem', maxWidth: 1200 }}>

          {/* ============ OVERVIEW ============ */}
          {tab === 'overview' && ov && (
            <>
              <div className="row g-3 mb-3">
                <div className="col-6 col-xl-3"><Stat icon="shop" label="Shops (tenants)" value={ov.tenants.total} sub={`${ov.tenants.active} active · ${ov.tenants.suspended} suspended`} /></div>
                <div className="col-6 col-xl-3"><Stat icon="currency-rupee" label="MRR" value={money(ov.mrr)} sub={Object.entries(ov.plans).map(([p, n]) => `${n} ${p}`).join(' · ')} /></div>
                <div className="col-6 col-xl-3"><Stat icon="people" label="Total users" value={ov.users} sub={`${ov.signups_30} new shops in 30d`} /></div>
                <div className="col-6 col-xl-3"><Stat icon="receipt" label="Sales (30d)" value={ov.sales_30} sub={`Today: ${ov.sales_today.count} bills · ${money(ov.sales_today.total)}`} /></div>
              </div>
              <div className="card">
                <div className="card-header fw-semibold small"><i className="bi bi-graph-up me-2 text-primary"></i>New shop signups — last 30 days</div>
                <div className="card-body">
                  {ov.signup_trend.length === 0
                    ? <div className="small text-muted">No signups recorded yet.</div>
                    : <div className="d-flex align-items-end gap-1" style={{ height: 120 }}>
                        {ov.signup_trend.map(d => (
                          <div key={d.d} className="text-center flex-fill" title={`${d.d}: ${d.n} shop(s)`}>
                            <div style={{ background: '#6366f1', borderRadius: 4, height: Math.max(6, d.n * 34) }}></div>
                            <div className="small text-muted" style={{ fontSize: '.62rem' }}>{String(d.d).slice(8)}</div>
                          </div>
                        ))}
                      </div>}
                </div>
              </div>
            </>
          )}

          {/* ============ SHOPS ============ */}
          {tab === 'shops' && (
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 flex-wrap py-2">
                <input className="form-control form-control-sm" style={{ maxWidth: 230 }} placeholder="Search shop / owner…" value={q} onChange={e => setQ(e.target.value)} />
                <select className="form-select form-select-sm" style={{ maxWidth: 140 }} value={fPlan} onChange={e => setFPlan(e.target.value)}>
                  <option value="">All plans</option>
                  {activePlans.map(p => <option key={p.plan_key} value={p.plan_key}>{p.name}</option>)}
                </select>
                <select className="form-select form-select-sm" style={{ maxWidth: 130 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                  <option value="">All status</option><option value="active">Active</option><option value="suspended">Suspended</option>
                </select>
                <span className="ms-auto d-flex gap-2">
                  <button className="btn btn-sm btn-outline-success" onClick={exportShops}><i className="bi bi-filetype-csv me-1"></i>CSV</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={load}><i className="bi bi-arrow-clockwise"></i></button>
                </span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0 small">
                  <thead><tr className="text-muted">
                    <th>#</th><th>Shop</th><th>Owner</th><th>Plan</th><th>Status</th>
                    <th className="text-center">Users</th><th className="text-center">Products</th>
                    <th className="text-end">Sales</th><th className="text-end">Revenue</th><th>Expiry</th><th></th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(t => (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(t.id)}>
                        <td className="text-muted">{t.id}</td>
                        <td><b>{t.shop_name}</b></td>
                        <td>{t.owner_email}<div className="text-muted">{t.phone}</div></td>
                        <td><span className={`badge bg-${planBadge(t.plan)} badge-soft text-capitalize`}>{t.plan}</span></td>
                        <td><span className={`badge badge-soft ${t.status === 'active' ? 'bg-success' : 'bg-danger'}`}>{t.status}</span></td>
                        <td className="text-center">{t.users}</td>
                        <td className="text-center">{t.products}</td>
                        <td className="text-end">{t.sales}</td>
                        <td className="text-end">{money(t.revenue)}</td>
                        <td className="small text-muted">{t.plan_expires_at ? t.plan_expires_at.slice(0, 10) : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          {t.status === 'active'
                            ? <button className="btn btn-sm btn-outline-danger me-1 py-0" disabled={busy === t.id}
                                onClick={() => act(() => pf(`/api/platform/tenants/${t.id}/suspend`, { method: 'POST' }), t.id, 'Shop suspended')}>Suspend</button>
                            : <button className="btn btn-sm btn-outline-success me-1 py-0" disabled={busy === t.id}
                                onClick={() => act(() => pf(`/api/platform/tenants/${t.id}/activate`, { method: 'POST' }), t.id, 'Shop activated')}>Activate</button>}
                          <button className="btn btn-sm btn-outline-primary py-0" onClick={() => setPlanModal({ tenant: t, plan: t.plan, days: 30 })}>Plan</button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && <tr><td colSpan={11} className="text-center text-muted py-4">No shops match the filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============ PAYMENTS ============ */}
          {tab === 'payments' && (
            <div className="card">
              <div className="card-header fw-semibold small"><i className="bi bi-credit-card-2-front me-2"></i>Subscription payments (all shops)</div>
              {orders.length === 0
                ? <div className="card-body small text-muted">No orders yet — payments appear here when shops subscribe.</div>
                : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0 small">
                      <thead><tr className="text-muted"><th>#</th><th>Shop</th><th>Plan</th><th>Amount</th><th>Gateway</th><th>Status</th><th>Created</th><th>Paid</th></tr></thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id}>
                            <td className="text-muted">{o.id}</td>
                            <td>{o.shop_name}</td>
                            <td className="text-capitalize">{o.plan}</td>
                            <td>{money(o.amount / 100)}</td>
                            <td className="text-capitalize">{o.gateway}</td>
                            <td><span className={`badge badge-soft ${o.status === 'paid' ? 'bg-success' : o.status === 'failed' ? 'bg-danger' : 'bg-secondary'}`}>{o.status}</span></td>
                            <td className="text-muted">{o.created_at?.slice(0, 16)}</td>
                            <td className="text-muted">{o.paid_at ? o.paid_at.slice(0, 16) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )}

          {/* ============ SUBSCRIPTION PLANS ============ */}
          {tab === 'plans' && (
            <>
              <div className="d-flex align-items-center mb-3">
                <div className="small text-muted">Create and edit the plans shops can subscribe to. Changes apply immediately.</div>
                {op?.is_owner && (
                  <button className="btn btn-primary btn-sm ms-auto"
                    onClick={() => setPlanEdit({ plan_key: '', name: '', price: 499, users_limit: 2, products_limit: 200, reports: false, tagline: '', sort_order: 50 })}>
                    <i className="bi bi-plus-circle me-1"></i>New plan
                  </button>
                )}
              </div>
              <div className="row g-3">
                {plans.map(p => (
                  <div className="col-md-6 col-xl-4" key={p.id}>
                    <div className="card h-100" style={!p.is_active ? { opacity: .6 } : {}}>
                      <div className="card-body">
                        <div className="d-flex align-items-center mb-1">
                          <h6 className="mb-0">{p.name}</h6>
                          <span className={`badge bg-${planBadge(p.plan_key)} badge-soft ms-2 text-capitalize`}>{p.plan_key}</span>
                          {!p.is_active && <span className="badge bg-danger badge-soft ms-1">inactive</span>}
                          <span className="ms-auto fw-bold">₹{p.price}<span className="small text-muted fw-normal">/mo</span></span>
                        </div>
                        <div className="small text-muted mb-2" style={{ minHeight: 32 }}>{p.tagline || '—'}</div>
                        <ul className="list-unstyled small mb-2">
                          <li><i className="bi bi-people me-2 text-primary"></i>{p.users_limit ? `${p.users_limit} user logins` : 'Unlimited users'}</li>
                          <li><i className="bi bi-tags me-2 text-primary"></i>{p.products_limit ? `${p.products_limit} products` : 'Unlimited products'}</li>
                          <li><i className={`bi ${p.reports ? 'bi-check-circle-fill text-success' : 'bi-x-circle text-danger'} me-2`}></i>Reports &amp; GST analytics</li>
                          {p.plan_key === 'trial' && <li><i className="bi bi-hourglass me-2 text-warning"></i>{p.trial_days}-day trial for new shops</li>}
                        </ul>
                        <div className="d-flex align-items-center gap-2 border-top pt-2">
                          <span className="small text-muted">{p.tenants_on_plan} shop(s) on this plan</span>
                          {op?.is_owner && (
                            <span className="ms-auto d-flex gap-1">
                              <button className="btn btn-sm btn-outline-primary py-0" onClick={() => setPlanEdit({ ...p })}><i className="bi bi-pencil me-1"></i>Edit</button>
                              {p.plan_key !== 'trial' && (p.is_active
                                ? <button className="btn btn-sm btn-outline-danger py-0" disabled={busy === 'plan' + p.id}
                                    onClick={() => act(() => pf(`/api/platform/plans/${p.id}/toggle`, { method: 'POST' }), 'plan' + p.id, 'Plan deactivated')}>Deactivate</button>
                                : <button className="btn btn-sm btn-outline-success py-0" disabled={busy === 'plan' + p.id}
                                    onClick={() => act(() => pf(`/api/platform/plans/${p.id}/toggle`, { method: 'POST' }), 'plan' + p.id, 'Plan activated')}>Activate</button>)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ============ OPERATORS ============ */}
          {tab === 'operators' && op?.is_owner && (
            <div className="card">
              <div className="card-header d-flex align-items-center">
                <b className="small">Operator accounts</b>
                <span className="small text-muted ms-2">— logins for the people who run this platform</span>
                <button className="btn btn-sm btn-primary ms-auto" onClick={() => setOpModal({ username: '', name: '', password: '' })}>
                  <i className="bi bi-person-plus me-1"></i>Create operator
                </button>
              </div>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0 small">
                  <thead><tr className="text-muted"><th>#</th><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th className="text-end">Actions</th></tr></thead>
                  <tbody>
                    {operators.map(u => (
                      <tr key={u.id}>
                        <td className="text-muted">{u.id}</td>
                        <td><b>{u.username}</b></td>
                        <td>{u.name}</td>
                        <td>{u.is_owner ? <span className="badge bg-primary badge-soft">owner</span> : <span className="badge bg-secondary badge-soft">operator</span>}</td>
                        <td>{u.is_active ? <span className="badge bg-success badge-soft">active</span> : <span className="badge bg-danger badge-soft">disabled</span>}</td>
                        <td className="text-muted">{u.last_login ? String(u.last_login).slice(0, 16) : 'never'}</td>
                        <td className="text-end" style={{ whiteSpace: 'nowrap' }}>
                          {!u.is_owner && u.id !== op.id && <>
                            <button className="btn btn-sm btn-outline-secondary me-1 py-0" onClick={() => setOpModal({ id: u.id, username: u.username, name: u.name, password: '' })}>
                              <i className="bi bi-key me-1"></i>Edit
                            </button>
                            {u.is_active
                              ? <button className="btn btn-sm btn-outline-danger me-1 py-0" onClick={() => act(() => pf(`/api/platform/operators/${u.id}`, { method: 'PUT', body: { is_active: 0 } }), u.id, 'Operator disabled')}>Disable</button>
                              : <button className="btn btn-sm btn-outline-success me-1 py-0" onClick={() => act(() => pf(`/api/platform/operators/${u.id}`, { method: 'PUT', body: { is_active: 1 } }), u.id, 'Operator enabled')}>Enable</button>}
                            <button className="btn btn-sm btn-outline-danger py-0" onClick={async () => {
                              if (!window.confirm(`Delete operator "${u.username}"?`)) return;
                              await act(() => pf(`/api/platform/operators/${u.id}`, { method: 'DELETE' }), u.id, 'Operator deleted');
                            }}><i className="bi bi-trash"></i></button>
                          </>}
                          {(u.is_owner || u.id === op.id) && <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-footer small text-muted bg-white">
                <i className="bi bi-shield-lock me-1"></i>The owner account is provisioned from the server environment and cannot be disabled or deleted.
              </div>
            </div>
          )}

          {/* ============ PLATFORM SETTINGS ============ */}
          {tab === 'settings' && op?.is_owner && (
            <div className="card" style={{ maxWidth: 640 }}>
              <div className="card-header fw-semibold small"><i className="bi bi-gear me-2"></i>Defaults for newly created shops</div>
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between py-2 border-bottom">
                  <div>
                    <div className="fw-semibold small">GST billing enabled by default</div>
                    <div className="small text-muted">New shops start charging GST on invoices (owners can switch it off in their Shop Settings).</div>
                  </div>
                  <div className="form-check form-switch m-0">
                    <input className="form-check-input" type="checkbox" style={{ width: '2.4em', height: '1.2em' }}
                      checked={psettings.default_gst_enabled !== '0'}
                      onChange={e => setPsettings({ ...psettings, default_gst_enabled: e.target.checked ? '1' : '0' })} />
                  </div>
                </div>
                <div className="py-3">
                  <label className="form-label fw-semibold small mb-1">Default receipt footer message</label>
                  <input className="form-control form-control-sm" value={psettings.default_receipt_footer || ''}
                    onChange={e => setPsettings({ ...psettings, default_receipt_footer: e.target.value })} />
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === 'psettings'} onClick={() => act(
                  () => pf('/api/platform/settings', { method: 'PUT', body: psettings }), 'psettings', 'Platform settings saved')}>
                  {busy === 'psettings' ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-check-lg me-1"></i>Save settings</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ============ SHOP DETAIL MODAL ============ */}
      <Modal show={!!detail} onClose={() => setDetail(null)} size="modal-xl"
        title={detail ? <><i className="bi bi-shop me-2"></i>{detail.tenant.shop_name}</> : ''}
        footer={<button className="btn btn-light btn-sm" onClick={() => setDetail(null)}>Close</button>}>
        {detail && (
          <div className="small">
            <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
              <span className={`badge bg-${planBadge(detail.tenant.plan)} badge-soft text-capitalize fs-6`}>{detail.tenant.plan}</span>
              <span className={`badge badge-soft fs-6 ${detail.tenant.status === 'active' ? 'bg-success' : 'bg-danger'}`}>{detail.tenant.status}</span>
              <span className="text-muted">
                {detail.tenant.plan_expires_at ? <>Valid till <b>{fmtDate(detail.tenant.plan_expires_at)}</b></> : 'No expiry set'}
                {' · '}created {fmtDate(detail.tenant.created_at)}
              </span>
              <span className="ms-auto d-flex gap-2">
                <button className="btn btn-sm btn-outline-primary" onClick={() => setPlanModal({ tenant: detail.tenant, plan: detail.tenant.plan, days: 30 })}>
                  <i className="bi bi-pencil me-1"></i>Edit plan
                </button>
                <button className="btn btn-sm btn-outline-success" onClick={() => act(() => pf(`/api/platform/tenants/${detail.tenant.id}/extend`, { method: 'POST', body: { days: 30 } }), 'extend', 'Subscription extended +30 days')}>
                  <i className="bi bi-calendar-plus me-1"></i>Extend +30d
                </button>
                {detail.tenant.status === 'active'
                  ? <button className="btn btn-sm btn-outline-danger" onClick={() => act(() => pf(`/api/platform/tenants/${detail.tenant.id}/suspend`, { method: 'POST' }), 'sus', 'Shop suspended')}>Suspend</button>
                  : <button className="btn btn-sm btn-outline-success" onClick={() => act(() => pf(`/api/platform/tenants/${detail.tenant.id}/activate`, { method: 'POST' }), 'act', 'Shop activated')}>Activate</button>}
              </span>
            </div>

            <div className="row g-2 mb-3 text-center">
              {[['people', 'Logins', detail.usage.users], ['tags', 'Products', detail.usage.products],
                ['receipt', 'Sales', detail.usage.sales], ['currency-rupee', 'Revenue', money(detail.usage.revenue)],
                ['boxes', 'Stock value', money(detail.usage.stock_value)]].map(([ic, lb, v]) => (
                <div className="col" key={lb}>
                  <div className="border rounded p-2">
                    <div className="text-muted" style={{ fontSize: '.7rem' }}><i className={`bi bi-${ic} me-1`}></i>{lb}</div>
                    <div className="fw-bold">{v}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="row g-3">
              <div className="col-lg-6">
                <h6 className="text-muted"><i className="bi bi-people me-1"></i>User logins ({detail.users.length})</h6>
                <table className="table table-sm">
                  <tbody>
                    {detail.users.map(u => (
                      <tr key={u.id}>
                        <td><b>{u.name}</b><div className="text-muted">@{u.username}</div></td>
                        <td><span className="badge bg-secondary badge-soft text-capitalize">{u.role}</span></td>
                        <td className="text-muted">{u.is_active ? 'active' : 'disabled'}{u.last_login ? ` · login ${String(u.last_login).slice(0, 10)}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h6 className="text-muted mt-3"><i className="bi bi-trophy me-1"></i>Top products</h6>
                {detail.top_products.length === 0 ? <div className="text-muted">No sales yet.</div> : (
                  <table className="table table-sm">
                    <tbody>{detail.top_products.map((p, i) => (
                      <tr key={i}><td>{p.name}</td><td className="text-end">{p.qty} pcs</td><td className="text-end">{money(p.revenue)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div className="col-lg-6">
                <h6 className="text-muted"><i className="bi bi-receipt me-1"></i>Recent sales</h6>
                {detail.recent_sales.length === 0 ? <div className="text-muted">No sales yet.</div> : (
                  <table className="table table-sm">
                    <tbody>{detail.recent_sales.map(s => (
                      <tr key={s.id}>
                        <td>{s.invoice_no}<div className="text-muted">{String(s.sale_date).slice(0, 16)}</div></td>
                        <td className="text-capitalize text-muted">{s.payment_method}</td>
                        <td className="text-end fw-semibold">{money(s.total)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <h6 className="text-muted mt-3"><i className="bi bi-credit-card-2-front me-1"></i>Subscription orders</h6>
                {detail.orders.length === 0 ? <div className="text-muted">No payments yet.</div> : (
                  <table className="table table-sm">
                    <tbody>{detail.orders.map(o => (
                      <tr key={o.id}>
                        <td className="text-capitalize">{o.plan} · {money(o.amount / 100)}</td>
                        <td><span className={`badge badge-soft ${o.status === 'paid' ? 'bg-success' : o.status === 'failed' ? 'bg-danger' : 'bg-secondary'}`}>{o.status}</span></td>
                        <td className="text-muted text-end">{String(o.created_at).slice(0, 10)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="border-top pt-2 mt-2 text-muted">
              <i className="bi bi-geo-alt me-1"></i>{detail.tenant.address || 'No address'} · GSTIN: {detail.tenant.gstin || '—'} · Owner email: {detail.tenant.owner_email}
            </div>
          </div>
        )}
      </Modal>

      {/* ============ SET TENANT PLAN MODAL ============ */}
      <Modal show={!!planModal} onClose={() => setPlanModal(null)} size="modal-sm" title="Set shop plan"
        footer={<>
          <button className="btn btn-light btn-sm" onClick={() => setPlanModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy === 'save-plan'} onClick={() => act(async () => {
            await pf(`/api/platform/tenants/${planModal.tenant.id}/plan`, { method: 'PUT', body: { plan: planModal.plan, days: planModal.days } });
            setPlanModal(null);
          }, 'save-plan', 'Plan updated')}>
            {busy === 'save-plan' ? <span className="spinner-border spinner-border-sm"></span> : 'Apply'}
          </button>
        </>}>
        {planModal && (
          <div className="small">
            <p className="mb-2">Shop: <b>{planModal.tenant.shop_name}</b></p>
            <label className="form-label fw-semibold">Plan</label>
            <select className="form-select form-select-sm mb-2" value={planModal.plan} onChange={e => setPlanModal({ ...planModal, plan: e.target.value })}>
              {activePlans.map(p => <option key={p.plan_key} value={p.plan_key}>{p.name} — ₹{p.price}/mo</option>)}
            </select>
            <label className="form-label fw-semibold">Term (days)</label>
            <div className="d-flex gap-1 mb-1">
              {[30, 90, 365].map(d => (
                <button key={d} className={`btn btn-sm flex-fill ${planModal.days === d ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => setPlanModal({ ...planModal, days: d })}>{d}d</button>
              ))}
            </div>
            <input type="number" className="form-control form-control-sm" min="1" max="3650" value={planModal.days}
              onChange={e => setPlanModal({ ...planModal, days: parseInt(e.target.value) || 30 })} />
            <div className="form-text">Expiry = now + term. For trials this is the trial end date.</div>
          </div>
        )}
      </Modal>

      {/* ============ PLAN CREATE/EDIT MODAL ============ */}
      <Modal show={!!planEdit} onClose={() => setPlanEdit(null)} size="modal-md"
        title={planEdit?.id ? `Edit plan — ${planEdit.name}` : 'Create subscription plan'}
        footer={<>
          <button className="btn btn-light btn-sm" onClick={() => setPlanEdit(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy === 'plan-edit'} onClick={() => act(async () => {
            if (planEdit.id) await pf(`/api/platform/plans/${planEdit.id}`, { method: 'PUT', body: planEdit });
            else await pf('/api/platform/plans', { method: 'POST', body: planEdit });
            setPlanEdit(null);
          }, 'plan-edit', planEdit?.id ? 'Plan updated' : 'Plan created')}>
            {busy === 'plan-edit' ? <span className="spinner-border spinner-border-sm"></span> : (planEdit?.id ? 'Save changes' : 'Create plan')}
          </button>
        </>}>
        {planEdit && (
          <div className="small row g-2">
            {!planEdit.id && (
              <div className="col-md-5">
                <label className="form-label fw-semibold">Plan key <span className="text-muted fw-normal">(permanent)</span></label>
                <input className="form-control form-control-sm" placeholder="e.g. business" value={planEdit.plan_key}
                  onChange={e => setPlanEdit({ ...planEdit, plan_key: e.target.value })} />
              </div>
            )}
            <div className={planEdit.id ? 'col-12' : 'col-md-7'}>
              <label className="form-label fw-semibold">Plan name</label>
              <input className="form-control form-control-sm" placeholder="e.g. Business" value={planEdit.name}
                onChange={e => setPlanEdit({ ...planEdit, name: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">Price ₹/month</label>
              <input type="number" min="0" className="form-control form-control-sm" value={planEdit.price}
                onChange={e => setPlanEdit({ ...planEdit, price: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">User logins</label>
              <LimitInput value={planEdit.users_limit} onChange={v => setPlanEdit({ ...planEdit, users_limit: v })} />
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">Products</label>
              <LimitInput value={planEdit.products_limit} onChange={v => setPlanEdit({ ...planEdit, products_limit: v })} />
            </div>
            {planEdit.plan_key === 'trial' && (
              <div className="col-md-4">
                <label className="form-label fw-semibold">Trial days</label>
                <input type="number" min="1" className="form-control form-control-sm" value={planEdit.trial_days || 14}
                  onChange={e => setPlanEdit({ ...planEdit, trial_days: parseInt(e.target.value) || 14 })} />
              </div>
            )}
            <div className="col-12">
              <label className="form-label fw-semibold">Tagline</label>
              <input className="form-control form-control-sm" placeholder="One-line description shown on pricing pages" value={planEdit.tagline || ''}
                onChange={e => setPlanEdit({ ...planEdit, tagline: e.target.value })} />
            </div>
            <div className="col-md-6 d-flex align-items-center">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" checked={!!planEdit.reports}
                  onChange={e => setPlanEdit({ ...planEdit, reports: e.target.checked })} />
                <label className="form-check-label">Reports &amp; GST analytics included</label>
              </div>
            </div>
            <div className="col-md-6">
              <label className="form-label fw-semibold">Sort order</label>
              <input type="number" className="form-control form-control-sm" value={planEdit.sort_order ?? 50}
                onChange={e => setPlanEdit({ ...planEdit, sort_order: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
        )}
      </Modal>

      {/* ============ OPERATOR CREATE/EDIT MODAL ============ */}
      <Modal show={!!opModal} onClose={() => setOpModal(null)} size="modal-sm"
        title={opModal?.id ? `Edit operator — ${opModal.username}` : 'Create operator account'}
        footer={<>
          <button className="btn btn-light btn-sm" onClick={() => setOpModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy === 'op-save'} onClick={() => act(async () => {
            if (opModal.id) {
              const body = {};
              if (opModal.name) body.name = opModal.name;
              if (opModal.password) body.password = opModal.password;
              await pf(`/api/platform/operators/${opModal.id}`, { method: 'PUT', body });
            } else {
              await pf('/api/platform/operators', { method: 'POST', body: opModal });
            }
            setOpModal(null);
          }, 'op-save', opModal?.id ? 'Operator updated' : 'Operator created')}>
            {busy === 'op-save' ? <span className="spinner-border spinner-border-sm"></span> : (opModal?.id ? 'Save' : 'Create')}
          </button>
        </>}>
        {opModal && (
          <div className="small">
            {!opModal.id && <>
              <label className="form-label fw-semibold">Username</label>
              <input className="form-control form-control-sm mb-2" value={opModal.username} onChange={e => setOpModal({ ...opModal, username: e.target.value })} placeholder="e.g. support1" />
            </>}
            <label className="form-label fw-semibold">Name</label>
            <input className="form-control form-control-sm mb-2" value={opModal.name} onChange={e => setOpModal({ ...opModal, name: e.target.value })} placeholder="Full name" />
            <label className="form-label fw-semibold">{opModal.id ? 'New password (leave blank to keep)' : 'Password'}</label>
            <input type="password" className="form-control form-control-sm" value={opModal.password} onChange={e => setOpModal({ ...opModal, password: e.target.value })} placeholder="Min 4 characters" />
          </div>
        )}
      </Modal>
    </div>
  );
}
