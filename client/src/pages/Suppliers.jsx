import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, Avatar, Empty } from '../components/ui';

const blank = { name: '', contact_person: '', phone: '', email: '', gstin: '', address: '' };

export default function Suppliers() {
  const { me, toast } = useApp();
  const isAdmin = me.role === 'admin';
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api('/api/suppliers').then(setRows);
  useEffect(() => { load(); }, []);

  const setF = (k, v) => setModal(m => ({ ...m, [k]: v }));

  const save = async () => {
    if (!modal.name.trim()) return toast('Name is required', 'error');
    try {
      if (modal.id) await api(`/api/suppliers/${modal.id}`, { method: 'PUT', body: modal });
      else await api('/api/suppliers', { method: 'POST', body: modal });
      setModal(null); toast('Saved'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async s => {
    if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
    try { await api(`/api/suppliers/${s.id}`, { method: 'DELETE' }); toast('Supplier deleted'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-building me-2 text-primary"></i> Suppliers
        <button className="btn btn-primary btn-sm ms-auto" onClick={() => setModal({ ...blank })}><i className="bi bi-plus-lg me-1"></i>Add Supplier</button>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th>Supplier</th><th>Contact</th><th>GSTIN</th><th className="text-center">Purchases</th><th className="text-end">Balance Due</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty colSpan={6} icon="building" text="No suppliers yet" />}
            {rows.map(s => (
              <tr key={s.id}>
                <td><div className="d-flex align-items-center gap-2"><Avatar name={s.name} />
                  <div><div className="fw-semibold">{s.name}</div><small className="text-muted">{s.address || ''}</small></div></div></td>
                <td className="small">{s.contact_person || '—'}<br />{s.phone || ''}</td>
                <td className="small font-monospace">{s.gstin || '—'}</td>
                <td className="text-center"><span className="badge bg-primary-subtle text-primary badge-soft">{s.purchases}</span></td>
                <td className={`text-end ${s.balance_due > 0 ? 'text-danger fw-semibold' : 'text-muted'}`}>{money(s.balance_due)}</td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setModal({ ...s, contact_person: s.contact_person || '', phone: s.phone || '', email: s.email || '', gstin: s.gstin || '', address: s.address || '' })}><i className="bi bi-pencil"></i></button>
                  {isAdmin && <button className="btn btn-sm btn-outline-danger" onClick={() => del(s)}><i className="bi bi-trash"></i></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal show={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit Supplier' : 'Add Supplier'}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button></>}>
        {modal && (
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label required">Business Name</label><input className="form-control form-control-sm" value={modal.name} onChange={e => setF('name', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Contact Person</label><input className="form-control form-control-sm" value={modal.contact_person} onChange={e => setF('contact_person', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Phone</label><input className="form-control form-control-sm" value={modal.phone} onChange={e => setF('phone', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Email</label><input className="form-control form-control-sm" value={modal.email} onChange={e => setF('email', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">GSTIN</label><input className="form-control form-control-sm" value={modal.gstin} onChange={e => setF('gstin', e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label">Address</label><input className="form-control form-control-sm" value={modal.address} onChange={e => setF('address', e.target.value)} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
