import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context/AppContext';

export default function Signup() {
  const { setMe, toast } = useApp();
  const [f, setF] = useState({ shop_name: '', owner_name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const submit = async e => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api('/api/signup', { method: 'POST', body: f });
      setMe(r.user);
      toast(`Welcome to GarmentBill, ${r.user.name.split(' ')[0]}! Your 14-day Pro trial has started.`, 'info');
      window.location.href = '/dashboard';
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0f1b31 0%,#1d2d4a 60%,#4f46e5 140%)', padding: '1.5rem 1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 520, border: 'none', borderRadius: '1rem', boxShadow: '0 24px 60px rgba(2,6,23,.45)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', padding: '1.5rem 2rem', textAlign: 'center' }}>
          <div style={{ width: 50, height: 50, margin: '0 auto .6rem', background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
            <i className="bi bi-shop"></i>
          </div>
          <h4 className="mb-0 fw-bold">Create your shop</h4>
          <div className="small opacity-75 mt-1">14-day free Pro trial · no card required</div>
        </div>
        <div className="card-body p-4">
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <form onSubmit={submit}>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label small fw-semibold required">Shop Name</label>
                <input className="form-control" placeholder="e.g. Style Hub Garments" required value={f.shop_name} onChange={e => set('shop_name', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold required">Your Name (Owner)</label>
                <input className="form-control" placeholder="Full name" required value={f.owner_name} onChange={e => set('owner_name', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold required">Email — this is your login</label>
                <input type="email" className="form-control" placeholder="you@shop.com" required value={f.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Phone</label>
                <input className="form-control" placeholder="+91 …" value={f.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold required">Password</label>
                <input type="password" className="form-control" placeholder="Min 4 characters" required minLength={4} value={f.password} onChange={e => set('password', e.target.value)} />
              </div>
            </div>
            <button className="btn btn-lg w-100 text-white mt-4" style={{ background: '#4f46e5', fontWeight: 600 }} disabled={busy}>
              {busy ? <><span className="spinner-border spinner-border-sm me-2"></span>Creating your shop…</> : <><i className="bi bi-rocket-takeoff me-2"></i>Create Shop &amp; Start Trial</>}
            </button>
          </form>
          <div className="text-center small mt-3">
            Already registered? <Link to="/login">Log in</Link>
          </div>
          <div className="alert alert-light border small mt-3 mb-0 py-2">
            <i className="bi bi-info-circle me-1"></i>You become the <b>single admin</b> of your shop. Staff logins (manager / cashier) can be added from the Users page.
          </div>
        </div>
      </div>
    </div>
  );
}
