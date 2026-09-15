import { useEffect, useState } from 'react';
import { api, fmtDate, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, Avatar, Empty } from '../components/ui';

export default function Categories() {
  const { me, toast } = useApp();
  const isAdmin = me.role === 'admin';
  const [cats, setCats] = useState([]);
  const [modal, setModal] = useState(null);

  const load = () => api('/api/categories').then(setCats);
  useEffect(() => { load(); }, []);

  const save = async () => {
    const body = { name: modal.name.trim(), description: modal.description.trim() };
    if (!body.name) return toast('Name is required', 'error');
    try {
      if (modal.id) await api(`/api/categories/${modal.id}`, { method: 'PUT', body });
      else await api('/api/categories', { method: 'POST', body });
      setModal(null); toast('Saved'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async c => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try { await api(`/api/categories/${c.id}`, { method: 'DELETE' }); toast('Category deleted'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-collection me-2 text-primary"></i> Item Categories
        <button className="btn btn-primary btn-sm ms-auto" onClick={() => setModal({ name: '', description: '' })}><i className="bi bi-plus-lg me-1"></i>Add Category</button>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th style={{ width: 44 }}></th><th>Category Name</th><th>Description</th><th className="text-center">Products</th><th>Created</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {cats.length === 0 && <Empty colSpan={6} icon="collection" text="No categories yet" />}
            {cats.map(c => (
              <tr key={c.id}>
                <td><Avatar name={c.name} /></td>
                <td className="fw-semibold">{c.name}</td>
                <td className="small text-muted">{c.description || '—'}</td>
                <td className="text-center"><span className="badge bg-primary-subtle text-primary badge-soft">{c.products}</span></td>
                <td className="small text-muted">{fmtDate(c.created_at)}</td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setModal({ id: c.id, name: c.name, description: c.description || '' })}><i className="bi bi-pencil"></i></button>
                  {isAdmin && <button className="btn btn-sm btn-outline-danger" onClick={() => del(c)}><i className="bi bi-trash"></i></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal show={!!modal} onClose={() => setModal(null)} size="modal-sm" title={modal?.id ? 'Edit Category' : 'Add Category'}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button></>}>
        {modal && <>
          <label className="form-label required">Name</label>
          <input className="form-control form-control-sm mb-2" value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })} />
          <label className="form-label">Description</label>
          <input className="form-control form-control-sm" value={modal.description} onChange={e => setModal({ ...modal, description: e.target.value })} />
        </>}
      </Modal>
    </div>
  );
}
