import { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, AV_COLORS } from '../api';
import { useApp } from '../context/AppContext';
import { RoleBadge } from '../components/ui';

export default function Profile() {
  const { toast } = useApp();
  const [p, setP] = useState(null);
  const [form, setForm] = useState({ name: '', username: '', email: '', phone: '' });
  const [color, setColor] = useState(null);
  const [pw, setPw] = useState({ cur: '', next: '', conf: '' });

  useEffect(() => {
    api('/api/me').then(u => {
      setP(u); setColor(u.avatar_color);
      setForm({ name: u.name, username: u.username, email: u.email || '', phone: u.phone || '' });
    });
  }, []);

  const saveProfile = async () => {
    try {
      await api('/api/me/profile', { method: 'PUT', body: { ...form, avatar_color: color } });
      toast('Profile updated');
      setP(await api('/api/me'));
    } catch (e) { toast(e.message, 'error'); }
  };

  const savePw = async () => {
    if (pw.next !== pw.conf) return toast('New passwords do not match', 'error');
    try {
      await api('/api/me/password', { method: 'PUT', body: { current: pw.cur, next: pw.next } });
      toast('Password updated'); setPw({ cur: '', next: '', conf: '' });
    } catch (e) { toast(e.message, 'error'); }
  };

  if (!p) return <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>;
  const avatarBg = color || AV_COLORS[(p.name || 'U').charCodeAt(0) % AV_COLORS.length];
  const initials = p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="row g-3">
      <div className="col-lg-4">
        <div className="card">
          <div className="profile-hero"></div>
          <div className="card-body text-center pt-0">
            <div className="big-avatar mx-auto" style={{ background: avatarBg }}>{initials}</div>
            <h4 className="mt-3 mb-0">{p.name}</h4>
            <div className="text-muted small">@{p.username}</div>
            <div className="mt-2"><RoleBadge role={p.role} /></div>
            <div className="list-group list-group-flush text-start mt-3 small">
              <div className="list-group-item d-flex justify-content-between"><span className="text-muted"><i className="bi bi-envelope me-2"></i>Email</span><span className="fw-semibold">{p.email || '—'}</span></div>
              <div className="list-group-item d-flex justify-content-between"><span className="text-muted"><i className="bi bi-telephone me-2"></i>Phone</span><span className="fw-semibold">{p.phone || '—'}</span></div>
              <div className="list-group-item d-flex justify-content-between"><span className="text-muted"><i className="bi bi-clock-history me-2"></i>Last login</span><span className="fw-semibold">{p.last_login ? fmtDateTime(p.last_login) : '—'}</span></div>
              <div className="list-group-item d-flex justify-content-between"><span className="text-muted"><i className="bi bi-calendar-check me-2"></i>Member since</span><span className="fw-semibold">{fmtDate(p.created_at)}</span></div>
              <div className="list-group-item d-flex justify-content-between"><span className="text-muted"><i className="bi bi-pc-display me-2"></i>Active sessions</span><span className="fw-semibold">{p.active_sessions || 1}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="col-lg-8 d-flex flex-column gap-3">
        <div className="card">
          <div className="card-header"><i className="bi bi-person-lines-fill me-2 text-primary"></i> Profile Details</div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label required">Full Name</label>
                <input className="form-control form-control-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label required">Username</label>
                <div className="input-group input-group-sm"><span className="input-group-text">@</span>
                  <input className="form-control" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div></div>
              <div className="col-md-6"><label className="form-label">Email</label>
                <input type="email" className="form-control form-control-sm" placeholder="name@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Phone</label>
                <input className="form-control form-control-sm" placeholder="+91 …" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="col-12">
                <label className="form-label mb-2">Avatar Colour</label>
                <div className="d-flex gap-2 flex-wrap">
                  {AV_COLORS.map(c => (
                    <div key={c} className={`swatch ${color === c ? 'sel' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)}></div>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn btn-primary btn-sm mt-3" onClick={saveProfile}><i className="bi bi-check2 me-1"></i>Save Profile</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="bi bi-shield-lock me-2 text-primary"></i> Change Password</div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-4"><label className="form-label required">Current Password</label>
                <input type="password" className="form-control form-control-sm" value={pw.cur} onChange={e => setPw({ ...pw, cur: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label required">New Password</label>
                <input type="password" className="form-control form-control-sm" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></div>
              <div className="col-md-4"><label className="form-label required">Confirm New Password</label>
                <input type="password" className="form-control form-control-sm" value={pw.conf} onChange={e => setPw({ ...pw, conf: e.target.value })} /></div>
            </div>
            <button className="btn btn-outline-primary btn-sm mt-3" onClick={savePw}><i className="bi bi-key me-1"></i>Update Password</button>
            <div className="small text-muted mt-2"><i className="bi bi-info-circle me-1"></i>Minimum 4 characters. You'll stay logged in on this device.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
