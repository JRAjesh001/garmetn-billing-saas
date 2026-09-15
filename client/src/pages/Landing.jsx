import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const FEATURES = [
  ['upc-scan', 'Barcode POS', 'Scan barcodes or search — billing takes seconds, receipts print on 80mm thermal printers.'],
  ['boxes', 'Live Stock', 'Every sale and purchase updates stock instantly. Low-stock alerts and valuation reports.'],
  ['truck', 'Purchases & Suppliers', 'GRN entries that add stock automatically, track paid vs balance per supplier.'],
  ['graph-up', 'Reports & GST', 'Sales, profit, category performance and a ready CGST/SGST summary for filing.'],
  ['people', 'Staff Logins', 'One admin per shop. Add manager and cashier logins with limited permissions.'],
  ['shield-lock', 'Your Data, Isolated', 'Multi-tenant architecture — every shop\'s data is fully private and secure.']
];

export default function Landing() {
  const [plans, setPlans] = useState(null);
  useEffect(() => { api('/api/plans').then(setPlans).catch(() => {}); }, []);

  // Render whatever plans the platform owner currently has active (trial shown separately).
  const pricing = plans ? Object.values(plans).filter(p => p.key !== 'trial').map((p, i, arr) => ({
    ...p,
    popular: i === arr.length - 1,
    feats: [
      p.products ? `Up to ${p.products} products` : 'Unlimited products',
      p.users ? `${p.users} user logins` : 'Unlimited user logins',
      p.reports ? 'Reports & GST analytics' : 'POS, stock & purchases',
      'Receipt printing'
    ],
    cta: 'Start free trial'
  })) : [];

  return (
    <div style={{ background: '#0f1b31', color: '#e2e8f0', minHeight: '100vh' }}>
      {/* nav */}
      <nav className="d-flex align-items-center justify-content-between px-4 py-3" style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className="d-flex align-items-center gap-2 fw-bold fs-5">
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="bi bi-shop"></i></span>
          GarmentBill <span className="badge bg-primary-subtle text-primary badge-soft small">SaaS</span>
        </div>
        <div className="d-flex gap-2">
          <Link to="/login" className="btn btn-outline-light btn-sm">Log in</Link>
          <Link to="/signup" className="btn btn-primary btn-sm">Start free trial</Link>
        </div>
      </nav>

      {/* hero */}
      <header className="text-center px-3" style={{ maxWidth: 860, margin: '0 auto', padding: '70px 16px 50px' }}>
        <div className="badge bg-primary-subtle text-primary badge-soft mb-3"><i className="bi bi-stars me-1"></i>Multi-tenant billing platform for garment shops</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 800, lineHeight: 1.15 }}>
          Run your clothing store<br />on <span style={{ background: 'linear-gradient(90deg,#818cf8,#c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>autopilot</span>
        </h1>
        <p className="mt-3 fs-5" style={{ color: '#94a3b8' }}>
          Barcode POS · inventory · purchases · GST-ready reports — everything your shop needs,
          in one login. Set up in 2 minutes, no installation.
        </p>
        <div className="d-flex gap-3 justify-content-center mt-4 flex-wrap">
          <Link to="/signup" className="btn btn-primary btn-lg px-4"><i className="bi bi-rocket-takeoff me-2"></i>Start 14-day free trial</Link>
          <Link to="/login" className="btn btn-outline-light btn-lg px-4">Try the live demo</Link>
        </div>
        <div className="small mt-3" style={{ color: '#64748b' }}>No credit card required · Demo shop: <code style={{ color: '#a5b4fc' }}>admin / admin@123</code></div>
      </header>

      {/* features */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '30px 16px 60px' }}>
        <div className="row g-3">
          {FEATURES.map(([icon, title, desc]) => (
            <div className="col-md-6 col-lg-4" key={title}>
              <div className="card h-100" style={{ background: '#16233b', border: '1px solid #24334f' }}>
                <div className="card-body">
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(99,102,241,.15)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                    <i className={`bi bi-${icon}`}></i></div>
                  <h6 className="mt-3 mb-1 text-white">{title}</h6>
                  <div className="small" style={{ color: '#94a3b8' }}>{desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* pricing */}
      <section style={{ background: '#0c1627', padding: '60px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }} className="text-center">
          <h2 className="fw-bold text-white">Simple pricing</h2>
          <p style={{ color: '#94a3b8' }}>Every shop starts with a 14-day free trial of Pro. One admin login per shop; add staff as you grow.</p>
          <div className="row g-4 mt-2 justify-content-center">
            {pricing.map(p => (
              <div className="col-md-5" key={p.key}>
                <div className="card h-100 text-start" style={{ background: '#16233b', border: p.popular ? '2px solid #6366f1' : '1px solid #24334f', position: 'relative' }}>
                  {p.popular && <span className="badge bg-primary position-absolute top-0 start-50 translate-middle badge-soft">Most popular</span>}
                  <div className="card-body p-4">
                    <h5 className="text-white">{p.name}</h5>
                    <div className="small mb-2" style={{ color: '#94a3b8' }}>{p.tagline}</div>
                    <div className="fs-2 fw-bold text-white">₹{p.price}<span className="fs-6 fw-normal" style={{ color: '#64748b' }}>/month</span></div>
                    <ul className="list-unstyled small my-3" style={{ color: '#cbd5e1' }}>
                      {p.feats.map(f => <li key={f} className="mb-1"><i className="bi bi-check-circle-fill text-success me-2"></i>{f}</li>)}
                    </ul>
                    <Link to="/signup" className={`btn w-100 ${p.popular ? 'btn-primary' : 'btn-outline-light'}`}>{p.cta}</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="small mt-4" style={{ color: '#64748b' }}>Prices in INR. Payments via UPI/cards once the gateway is connected — the trial is fully functional today.</div>
        </div>
      </section>

      <footer className="text-center small py-4" style={{ color: '#64748b' }}>
        GarmentBill SaaS · React + Express.js + MySQL · Multi-tenant with per-shop isolation
        <div className="mt-1"><Link to="/platform" style={{ color: '#818cf8' }}>Platform console (operator)</Link></div>
      </footer>
    </div>
  );
}
