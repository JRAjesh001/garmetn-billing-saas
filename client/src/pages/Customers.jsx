import { useEffect, useState } from 'react';
import { api, money, fmtDate, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, Avatar, Empty } from '../components/ui';

const blank = { name: '', phone: '', email: '', address: '', city: '' };

export default function Customers() {
  const { me, toast } = useApp();
  const isMgr = hasRole(me, 'manager');
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api('/api/customers').then(setRows);
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setModal(m => ({ ...m, [k]: v }));

  const save = async () => {
    if (!modal.name.trim()) return toast('Name is required', 'error');
    try {
      if (modal.id) await api(`/api/customers/${modal.id}`, { method: 'PUT', body: modal });
      else await api('/api/customers', { method: 'POST', body: modal });
      setModal(null); toast('Saved'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async c => {
    if (!window.confirm(`Delete customer "${c.name}"?`)) return;
    await api(`/api/customers/${c.id}`, { method: 'DELETE' });
    toast('Customer deleted'); load();
  };

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-people me-2 text-primary"></i> Customers
        {isMgr && <button className="btn btn-primary btn-sm ms-auto" onClick={() => setModal({ ...blank })}><i className="bi bi-person-plus me-1"></i>Add Customer</button>}
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th>Customer</th><th>Phone</th><th>City</th><th className="text-center">Orders</th><th className="text-end">Total Spent</th><th>Since</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty colSpan={7} icon="people" text="No customers yet" />}
            {rows.map(c => (
              <tr key={c.id}>
                <td><div className="d-flex align-items-center gap-2"><Avatar name={c.name} />
                  <div><div className="fw-semibold">{c.name}</div><small className="text-muted">{c.email || ''}</small></div></div></td>
                <td className="small">{c.phone || '—'}</td>
                <td className="small">{c.city || '—'}</td>
                <td className="text-center"><span className="badge bg-primary-subtle text-primary badge-soft">{c.orders}</span></td>
                <td className="text-end fw-semibold">{money(c.total_spent)}</td>
                <td className="small text-muted">{fmtDate(c.created_at)}</td>
                <td className="text-end">
                  {isMgr ? <>
                    <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setModal({ ...c, phone: c.phone || '', email: c.email || '', address: c.address || '', city: c.city || '' })}><i className="bi bi-pencil"></i></button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => del(c)}><i className="bi bi-trash"></i></button>
                  </> : <span className="text-muted small">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal show={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit Customer' : 'Add Customer'}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button></>}>
        {modal && (
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label required">Name</label><input className="form-control form-control-sm" value={modal.name} onChange={e => setF('name', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Phone</label><input className="form-control form-control-sm" value={modal.phone} onChange={e => setF('phone', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Email</label><input className="form-control form-control-sm" value={modal.email} onChange={e => setF('email', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">City</label><input className="form-control form-control-sm" value={modal.city} onChange={e => setF('city', e.target.value)} /></div>
            <div className="col-12"><label className="form-label">Address</label><input className="form-control form-control-sm" value={modal.address} onChange={e => setF('address', e.target.value)} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
