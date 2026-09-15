import { useEffect, useState } from 'react';
import { api, money, fmtDate } from '../api';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/ui';

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment gateway. Check your connection.'));
    document.body.appendChild(s);
  });
}

export default function Billing() {
  const { toast, me } = useApp();
  const [b, setB] = useState(null);
  const [pending, setPending] = useState(null);   // order awaiting payment
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/billing').then(setB);
  useEffect(() => { load(); }, []);

  // Start a purchase for `plan` — server decides demo vs Razorpay mode.
  const startPurchase = async (plan, label) => {
    setBusy(true);
    try {
      const co = await api('/api/billing/checkout', { method: 'POST', body: { plan } });
      if (co.mode === 'razorpay') {
        await payWithRazorpay(co);
      } else {
        setPending(co); // demo order → confirm modal
      }
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  // Live Razorpay checkout → verify signature on the server.
  const payWithRazorpay = async (co) => {
    await loadRazorpay();
    const rz = new window.Razorpay({
      key: co.key_id,
      order_id: co.gateway_order_id,
      amount: co.amount,
      currency: co.currency,
      name: 'GarmentBill',
      description: `${b.plans[co.plan].name} plan — ${b.plans[co.plan].price}/month`,
      prefill: { name: me?.name, email: me?.email, contact: me?.phone || '' },
      theme: { color: '#4f46e5' },
      handler: async (resp) => {
        try {
          const r = await api('/api/billing/verify', {
            method: 'POST',
            body: { order_id: co.id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature }
          });
          toast(r.message || 'Payment successful 🎉');
          load();
        } catch (e) { toast(e.message, 'error'); }
      },
      modal: { ondismiss: () => toast('Payment cancelled — your plan is unchanged', 'info') }
    });
    rz.on('payment.failed', (r) => toast('Payment failed: ' + (r.error?.description || 'try again'), 'error'));
    rz.open();
  };

  // Demo-mode confirmation → activate.
  const confirmDemo = async () => {
    setBusy(true);
    try {
      const r = await api('/api/billing/verify', { method: 'POST', body: { order_id: pending.id } });
      toast(r.message || 'Plan activated 🎉');
      setPending(null); load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  if (!b) return <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>;
  const usagePct = (u) => u.limit ? Math.min(100, Math.round(u.used / u.limit * 100)) : 5;
  const live = b.gateway?.provider === 'razorpay';
  const expiringSoon = b.days_left != null && b.days_left <= 7;

  const statusBadge = b.plan_expired
    ? <span className="badge bg-danger badge-soft ms-2">{b.plan === 'trial' ? 'Trial ended' : 'Subscription ended'}</span>
    : b.plan === 'trial'
      ? <span className="badge bg-warning text-dark badge-soft ms-2">{b.days_left} days left</span>
      : expiringSoon
        ? <span className="badge bg-warning text-dark badge-soft ms-2">Renews in {b.days_left} day(s)</span>
        : <span className="badge bg-success badge-soft ms-2">Active{b.days_left != null ? ` · ${b.days_left} days` : ''}</span>;

  // Per-plan button logic
  const planButton = (key) => {
    const p = b.plans[key];
    const current = b.plan === key;
    if (current && !expiringSoon && !b.plan_expired) {
      return <button className="btn btn-outline-secondary btn-sm" disabled><i className="bi bi-check2-circle me-1"></i>Current plan</button>;
    }
    const label = current ? `Renew ${p.name}` : (b.plan === 'trial' ? 'Subscribe' : 'Switch') + ` to ${p.name}`;
    return (
      <button className={`btn btn-sm ${current ? 'btn-warning' : 'btn-primary'}`} disabled={busy} onClick={() => startPurchase(key, label)}>
        {busy ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className={`bi ${current ? 'bi-arrow-clockwise' : 'bi-arrow-up-circle'} me-1`}></i>}
        {label} · {money(p.price)}
      </button>
    );
  };

  return (
    <>
      {/* status strip */}
      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap align-items-center gap-3">
          <div>
            <div className="small text-muted">Current plan</div>
            <div className="fs-4 fw-bold">{b.plan_name}{statusBadge}</div>
          </div>
          <div className="ms-auto text-end small text-muted">
            Shop created {fmtDate(b.shop_created)} · {b.sales_last_30} sales in last 30 days
            {b.expires_at && <> · {b.plan === 'trial' ? 'Trial ends' : 'Valid till'} {fmtDate(b.expires_at)}</>}
            <div>
              <i className={`bi me-1 ${live ? 'bi-credit-card-2-front text-success' : 'bi-plug text-secondary'}`}></i>
              {live ? 'Razorpay connected' : 'Demo payments (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to go live)'}
            </div>
          </div>
        </div>
      </div>

      {/* usage */}
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <div className="card"><div className="card-body">
            <div className="d-flex justify-content-between small fw-semibold mb-2">
              <span><i className="bi bi-tags me-1 text-primary"></i>Products</span>
              <span>{b.usage.products.used} / {b.usage.products.limit ?? '∞'}</span>
            </div>
            <div className="progress" style={{ height: 8 }}>
              <div className="progress-bar bg-primary" style={{ width: `${usagePct(b.usage.products)}%` }}></div>
            </div>
          </div></div>
        </div>
        <div className="col-md-6">
          <div className="card"><div className="card-body">
            <div className="d-flex justify-content-between small fw-semibold mb-2">
              <span><i className="bi bi-people me-1 text-primary"></i>User logins</span>
              <span>{b.usage.users.used} / {b.usage.users.limit ?? '∞'} <span className="text-muted">(1 admin per shop)</span></span>
            </div>
            <div className="progress" style={{ height: 8 }}>
              <div className="progress-bar bg-info" style={{ width: `${usagePct(b.usage.users)}%` }}></div>
            </div>
          </div></div>
        </div>
      </div>

      {/* plans — rendered live from whatever plans the platform owner has active */}
      <div className="row g-3">
        {Object.values(b.plans).filter(p => p.key !== 'trial').map((p, i, arr) => {
          const key = p.key, current = b.plan === key;
          return (
            <div className="col-md-6 col-xl-4" key={key}>
              <div className="card h-100" style={current ? { border: '2px solid #4f46e5' } : {}}>
                <div className="card-body p-4">
                  <div className="d-flex align-items-center">
                    <h5 className="mb-0">{p.name}</h5>
                    {current && <span className="badge bg-primary badge-soft ms-2">Current plan</span>}
                    {i === arr.length - 1 && !current && <span className="badge bg-warning text-dark badge-soft ms-2">Recommended</span>}
                  </div>
                  <div className="small text-muted mb-2">{p.tagline}</div>
                  <div className="fs-2 fw-bold">₹{p.price}<span className="fs-6 fw-normal text-muted">/month</span></div>
                  <ul className="list-unstyled small my-3">
                    <li className="mb-1"><i className="bi bi-check-circle-fill text-success me-2"></i>{p.products ? `${p.products} products` : 'Unlimited products'}</li>
                    <li className="mb-1"><i className="bi bi-check-circle-fill text-success me-2"></i>{p.users ? `${p.users} user logins` : 'Unlimited user logins'}</li>
                    <li className="mb-1"><i className={`${p.reports ? 'bi bi-check-circle-fill text-success' : 'bi bi-x-circle text-danger'} me-2`}></i>Reports &amp; GST analytics</li>
                  </ul>
                  {planButton(key)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* order history */}
      {b.orders?.length > 0 && (
        <div className="card mt-3">
          <div className="card-header fw-semibold small"><i className="bi bi-clock-history me-1"></i>Payment history</div>
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0 small">
              <thead><tr className="text-muted">
                <th>When</th><th>Plan</th><th>Amount</th><th>Gateway</th><th>Status</th>
              </tr></thead>
              <tbody>
                {b.orders.map(o => (
                  <tr key={o.id}>
                    <td>{fmtDate(o.created_at)}</td>
                    <td className="text-capitalize">{o.plan}</td>
                    <td>{money(o.amount / 100)}</td>
                    <td className="text-capitalize">{o.gateway}</td>
                    <td>
                      <span className={`badge badge-soft ${o.status === 'paid' ? 'bg-success' : o.status === 'failed' ? 'bg-danger' : 'bg-secondary'}`}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="alert alert-light border small mt-3 mb-0">
        <i className="bi bi-shield-lock me-1"></i>
        {live
          ? <>Payments are processed securely by <b>Razorpay</b>. The plan activates automatically after payment is verified.</>
          : <>Running in <b>demo payment mode</b> — no real money moves. Add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> environment variables to accept real UPI/card payments via Razorpay.</>}
      </div>

      {/* demo payment confirmation */}
      <Modal show={!!pending} onClose={() => setPending(null)} size="modal-sm" title="Confirm payment"
        footer={<>
          <button className="btn btn-light btn-sm" onClick={() => setPending(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={confirmDemo}>
            {busy ? <span className="spinner-border spinner-border-sm"></span> : <>Pay {pending && money(pending.amount / 100)} &amp; Activate</>}
          </button>
        </>}>
        {pending && (
          <div className="small">
            <p className="mb-2">You're subscribing to <b>{b.plans[pending.plan]?.name}</b> for <b>{money(pending.amount / 100)}/month</b> (30-day cycle, renews on payment).</p>
            <div className="alert alert-info py-2 mb-0"><i className="bi bi-info-circle me-1"></i>Demo mode: no real payment is taken — the plan activates immediately.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
