import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, RoleBadge, UserTile } from '../components/ui';

const blank = { username: '', name: '', role: 'cashier', password: '', email: '', phone: '', is_active: 1 };

export default function Users() {
  const { me, toast } = useApp();
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api('/api/users').then(setRows);
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setModal(m => ({ ...m, [k]: v }));

  const save = async () => {
    try {
      if (modal.id) {
        const body = { name: modal.name.trim(), role: modal.role, is_active: modal.is_active ? 1 : 0, email: modal.email, phone: modal.phone };
        if (modal.password) body.password = modal.password;
        await api(`/api/users/${modal.id}`, { method: 'PUT', body });
      } else {
        await api('/api/users', { method: 'POST', body: { ...modal, username: modal.username.trim(), name: modal.name.trim() } });
      }
      setModal(null); toast('User saved'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async u => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); toast('User deleted'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-person-lock me-2 text-primary"></i> User Accounts
        <button className="btn btn-primary btn-sm ms-auto" onClick={() => setModal({ ...blank })}><i className="bi bi-person-plus me-1"></i>Add User</button>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th style={{ width: 44 }}></th><th>User</th><th>Username</th><th className="text-center">Role</th>
            <th className="text-center">Status</th><th>Last Login</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td><UserTile u={u} size={38} /></td>
                <td><div className="fw-semibold">{u.name} {u.id === me.id && <span className="badge bg-primary badge-soft">You</span>}</div>
                  <small className="text-muted">{[u.email, u.phone].filter(Boolean).join(' · ')}</small></td>
                <td className="small text-muted">@{u.username}</td>
                <td className="text-center"><RoleBadge role={u.role} /></td>
                <td className="text-center">{u.is_active
                  ? <span className="badge bg-success-subtle text-success badge-soft">Active</span>
                  : <span className="badge bg-secondary-subtle text-secondary badge-soft">Disabled</span>}</td>
                <td className="small text-muted">{u.last_login ? fmtDateTime(u.last_login) : 'Never'}</td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary me-1" title="Edit / reset password"
                    onClick={() => setModal({ ...u, password: '', email: u.email || '', phone: u.phone || '' })}><i className="bi bi-pencil"></i></button>
                  <button className="btn btn-sm btn-outline-danger" title="Delete" disabled={u.id === me.id} onClick={() => del(u)}><i className="bi bi-trash"></i></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-footer bg-white small text-muted">
        <i className="bi bi-info-circle me-1"></i>
        <b>Single admin per shop:</b> you (the owner) are the only admin. Staff can be added as Manager (stock &amp; purchases) or Cashier (POS billing only).
      </div>

      <Modal show={!!modal} onClose={() => setModal(null)} title={modal?.id ? `Edit — @${modal.username}` : 'Add User'}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save User</button></>}>
        {modal && (
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label required">Username</label>
              <input className="form-control form-control-sm" disabled={!!modal.id} value={modal.username} onChange={e => setF('username', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label required">Full Name</label>
              <input className="form-control form-control-sm" value={modal.name} onChange={e => setF('name', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Role</label>
              <select className="form-select form-select-sm" disabled={modal.id === me.id} value={modal.role} onChange={e => setF('role', e.target.value)}>
                {modal.role !== 'admin' && <>
                  <option value="cashier">Cashier — POS billing</option>
                  <option value="manager">Manager — stock &amp; purchases</option>
                </>}
                {modal.role === 'admin' && <option value="admin">Admin — shop owner (fixed)</option>}
              </select></div>
            <div className="col-md-6"><label className={`form-label ${modal.id ? '' : 'required'}`}>{modal.id ? 'Reset Password' : 'Password'}</label>
              <input type="text" className="form-control form-control-sm" placeholder={modal.id ? 'Leave blank to keep current' : 'Set a password'} value={modal.password} onChange={e => setF('password', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Email</label>
              <input type="email" className="form-control form-control-sm" placeholder="optional" value={modal.email} onChange={e => setF('email', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Phone</label>
              <input className="form-control form-control-sm" placeholder="optional" value={modal.phone} onChange={e => setF('phone', e.target.value)} /></div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" id="uActive" disabled={modal.id === me.id} checked={!!modal.is_active} onChange={e => setF('is_active', e.target.checked ? 1 : 0)} />
                <label className="form-check-label small" htmlFor="uActive">Active (can log in)</label>
              </div></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
