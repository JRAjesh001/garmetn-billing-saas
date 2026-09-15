import { useEffect, useMemo, useState } from 'react';
import { api, money, num, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, StockBadge, Avatar, Empty } from '../components/ui';

const blank = { name: '', category_id: '', brand: '', sku: '', barcode: '', size: '', color: '', gender: 'Unisex', cost_price: 0, mrp: 0, sale_price: 0, tax_rate: '5', stock: 0, low_stock_alert: 5, is_active: 1 };

export default function Products() {
  const { me, toast } = useApp();
  const canEdit = hasRole(me, 'manager');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [modal, setModal] = useState(null); // null | {mode:'add'|'edit', form}

  const load = () => Promise.all([api('/api/products'), api('/api/categories')]).then(([p, c]) => { setProducts(p); setCategories(c); });
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(p =>
      (!s || [p.name, p.sku, p.barcode, p.brand, p.color, p.size, p.category].join(' ').toLowerCase().includes(s)) &&
      (!cat || p.category_id === Number(cat)) && (!lowOnly || p.stock <= p.low_stock_alert));
  }, [products, q, cat, lowOnly]);

  const openEdit = p => setModal({ mode: 'edit', form: { ...p, category_id: p.category_id || '', tax_rate: String(Number(p.tax_rate)) } });
  const setF = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }));

  const save = async () => {
    const f = modal.form;
    if (!f.name?.trim()) return toast('Product name is required', 'error');
    if (!Number(f.sale_price)) return toast('Sale price is required', 'error');
    const body = { ...f, category_id: f.category_id || null, tax_rate: Number(f.tax_rate) };
    try {
      if (modal.mode === 'edit') { await api(`/api/products/${f.id}`, { method: 'PUT', body }); toast('Product updated'); }
      else { await api('/api/products', { method: 'POST', body }); toast('Product added'); }
      setModal(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async p => {
    if (!window.confirm(`Delete "${p.name}"? It will be deactivated (sales history is preserved).`)) return;
    await api(`/api/products/${p.id}`, { method: 'DELETE' });
    toast('Product deleted'); load();
  };

  const genSku = () => {
    const c = categories.find(x => x.id === Number(modal.form.category_id));
    const prefix = (c?.name || 'ITM').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    setF('sku', `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
  };
  const genBarcode = () => setF('barcode', String(8900000000000 + Math.floor(Math.random() * 9999999999)));

  const exportCsv = () => {
    const rows = [['Name', 'Category', 'Brand', 'SKU', 'Barcode', 'Size', 'Color', 'Gender', 'Cost', 'MRP', 'Sale Price', 'GST %', 'Stock']];
    for (const p of filtered) rows.push([p.name, p.category || '', p.brand || '', p.sku || '', p.barcode || '', p.size || '', p.color || '', p.gender, p.cost_price, p.mrp, p.sale_price, p.tax_rate, p.stock]);
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'products.csv'; a.click();
  };

  const margin = modal && Number(modal.form.cost_price) > 0
    ? `${money(Number(modal.form.sale_price) - Number(modal.form.cost_price))} (${((Number(modal.form.sale_price) - Number(modal.form.cost_price)) / Number(modal.form.cost_price) * 100).toFixed(1)}% on cost)` : '—';

  return (
    <div className="card">
      <div className="card-body py-3">
        <div className="row g-2 align-items-center">
          <div className="col-md-4"><div className="search-box"><i className="bi bi-search"></i>
            <input className="form-control form-control-sm" placeholder="Search name / SKU / barcode / brand / color…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
          <div className="col-md-3 col-6">
            <select className="form-select form-select-sm" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="col-md-2 col-6">
            <div className="form-check mt-1">
              <input className="form-check-input" type="checkbox" id="lowOnly" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />
              <label className="form-check-label small" htmlFor="lowOnly">Low stock only</label>
            </div></div>
          <div className="col-md-3 d-flex gap-2 justify-content-md-end">
            <button className="btn btn-outline-secondary btn-sm" onClick={exportCsv}><i className="bi bi-filetype-csv me-1"></i>Export CSV</button>
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add', form: { ...blank } })}><i className="bi bi-plus-lg me-1"></i>Add Product</button>}
          </div>
        </div>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr>
            <th>Product</th><th>Category</th><th>SKU</th><th>Barcode</th><th>Size</th><th>Color</th>
            <th className="text-end">Cost</th><th className="text-end">MRP</th><th className="text-end">Sale Price</th>
            <th className="text-center">GST</th><th className="text-center">Stock</th><th className="text-end">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <Empty colSpan={12} icon="tags" text="No products found" />}
            {filtered.map(p => (
              <tr key={p.id}>
                <td><div className="d-flex align-items-center gap-2"><Avatar name={p.name} />
                  <div><div className="fw-semibold">{p.name}</div><small className="text-muted">{p.brand || ''} · {p.gender || ''}</small></div></div></td>
                <td className="small">{p.category || '—'}</td>
                <td className="small">{p.sku || '—'}</td>
                <td className="small font-monospace">{p.barcode || '—'}</td>
                <td>{p.size || '—'}</td>
                <td>{p.color || '—'}</td>
                <td className="text-end small">{money(p.cost_price)}</td>
                <td className="text-end small">{money(p.mrp)}</td>
                <td className="text-end fw-semibold">{money(p.sale_price)}</td>
                <td className="text-center small">{Number(p.tax_rate)}%</td>
                <td className="text-center"><StockBadge stock={p.stock} low={p.low_stock_alert} /></td>
                <td className="text-end">
                  {canEdit ? <>
                    <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(p)}><i className="bi bi-pencil"></i></button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => del(p)}><i className="bi bi-trash"></i></button>
                  </> : <span className="text-muted small">view only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-footer bg-white small text-muted">
        {filtered.length} of {products.length} products · Stock units: {num(filtered.reduce((a, p) => a + p.stock, 0))} · Retail value: {money(filtered.reduce((a, p) => a + p.stock * p.sale_price, 0))}
      </div>

      {/* ---------- add/edit modal ---------- */}
      <Modal show={!!modal} onClose={() => setModal(null)} size="modal-lg"
        title={modal?.mode === 'edit' ? `Edit — ${modal.form.name}` : 'Add Product'}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>Save Product</button></>}>
        {modal && (
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label required">Product Name</label>
              <input className="form-control form-control-sm" value={modal.form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Slim Fit Jeans" /></div>
            <div className="col-md-3"><label className="form-label">Category</label>
              <select className="form-select form-select-sm" value={modal.form.category_id} onChange={e => setF('category_id', e.target.value)}>
                <option value="">— none —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="col-md-3"><label className="form-label">Brand</label>
              <input className="form-control form-control-sm" value={modal.form.brand || ''} onChange={e => setF('brand', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label">SKU</label>
              <div className="input-group input-group-sm">
                <input className="form-control" value={modal.form.sku || ''} onChange={e => setF('sku', e.target.value)} placeholder="AUTO" />
                <button className="btn btn-outline-secondary" onClick={genSku} title="Generate"><i className="bi bi-magic"></i></button>
              </div></div>
            <div className="col-md-4"><label className="form-label">Barcode</label>
              <div className="input-group input-group-sm">
                <input className="form-control" value={modal.form.barcode || ''} onChange={e => setF('barcode', e.target.value)} placeholder="Scan or generate" />
                <button className="btn btn-outline-secondary" onClick={genBarcode} title="Generate"><i className="bi bi-upc"></i></button>
              </div></div>
            <div className="col-md-2"><label className="form-label">Size</label>
              <input className="form-control form-control-sm" value={modal.form.size || ''} onChange={e => setF('size', e.target.value)} placeholder="M / 32 / Free" /></div>
            <div className="col-md-3"><label className="form-label">Color</label>
              <input className="form-control form-control-sm" value={modal.form.color || ''} onChange={e => setF('color', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label">Gender</label>
              <select className="form-select form-select-sm" value={modal.form.gender || 'Unisex'} onChange={e => setF('gender', e.target.value)}>
                <option>Unisex</option><option>Men</option><option>Women</option><option>Kids</option>
              </select></div>
            <div className="col-md-3"><label className="form-label">Cost Price ₹</label>
              <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={modal.form.cost_price} onChange={e => setF('cost_price', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label">MRP ₹</label>
              <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={modal.form.mrp} onChange={e => setF('mrp', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label required">Sale Price ₹</label>
              <input type="number" className="form-control form-control-sm" min="0" step="0.01" value={modal.form.sale_price} onChange={e => setF('sale_price', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label">GST %</label>
              <select className="form-select form-select-sm" value={modal.form.tax_rate} onChange={e => setF('tax_rate', e.target.value)}>
                <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
              </select></div>
            <div className="col-md-3"><label className="form-label">Opening Stock</label>
              <input type="number" className="form-control form-control-sm" min="0" value={modal.form.stock || 0} disabled={modal.mode === 'edit'} onChange={e => setF('stock', e.target.value)} /></div>
            <div className="col-md-3"><label className="form-label">Low Stock Alert</label>
              <input type="number" className="form-control form-control-sm" min="0" value={modal.form.low_stock_alert} onChange={e => setF('low_stock_alert', e.target.value)} /></div>
            <div className="col-md-3 d-flex align-items-end">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" id="pActive" checked={!!modal.form.is_active} onChange={e => setF('is_active', e.target.checked ? 1 : 0)} />
                <label className="form-check-label small" htmlFor="pActive">Active</label>
              </div></div>
            <div className="col-12">
              <div className="alert alert-light border small mb-0 py-2">
                <i className="bi bi-info-circle me-1"></i>To change stock quantity use <b>Purchases</b> (stock in) or <b>Stock Management</b> (adjustments). Margin: <span className="fw-semibold">{margin}</span>
              </div></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
