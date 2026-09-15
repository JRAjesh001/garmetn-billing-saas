import { useEffect, useState } from 'react';
import { api, money, fmtDate, todayStr } from '../api';
import { useApp } from '../context/AppContext';
import { Modal, StatusBadge, Empty } from '../components/ui';

const emptyRow = { product_id: '', qty: 1, cost_price: '' };

export default function Purchases() {
  const { me, toast } = useApp();
  const isAdmin = me.role === 'admin';
  const [rows, setRows] = useState([]);
  const [view, setView] = useState(null);
  const [form, setForm] = useState(null); // new purchase form

  const load = () => api('/api/purchases').then(setRows);
  useEffect(() => { load(); }, []);

  const openNew = async () => {
    const [suppliers, products] = await Promise.all([api('/api/suppliers'), api('/api/products')]);
    setForm({ suppliers, products, supplier_id: '', purchase_date: todayStr(), supplier_invoice: '', gst: '5', items: [{ ...emptyRow }], discount: 0, paid: '', notes: '' });
  };

  const subtotal = form ? form.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.cost_price) || 0), 0) : 0;
  const tax = subtotal * (Number(form?.gst) || 0) / 100;
  const total = subtotal + tax - (Number(form?.discount) || 0);

  const setItem = (i, k, v) => setForm(f => {
    const items = f.items.map((it, j) => j === i ? { ...it, [k]: v } : it);
    return { ...f, items };
  });

  const pickProduct = (i, pid) => {
    const p = form.products.find(x => x.id === Number(pid));
    setForm(f => ({
      ...f,
      items: f.items.map((it, j) => j === i ? { ...it, product_id: pid, cost_price: it.cost_price || (p ? p.cost_price : '') } : it)
    }));
  };

  const save = async () => {
    if (!form.supplier_id) return toast('Select a supplier', 'error');
    const items = form.items.filter(i => i.product_id).map(i => ({ product_id: Number(i.product_id), qty: Number(i.qty) || 1, cost_price: Number(i.cost_price) || 0 }));
    if (!items.length) return toast('Add at least one item', 'error');
    const body = {
      supplier_id: Number(form.supplier_id), supplier_invoice: form.supplier_invoice.trim(), purchase_date: form.purchase_date,
      items, tax_amount: tax, discount: Number(form.discount) || 0,
      paid_amount: form.paid === '' ? total : Number(form.paid), notes: form.notes.trim()
    };
    try {
      await api('/api/purchases', { method: 'POST', body });
      setForm(null); toast('Purchase saved — stock updated'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async p => {
    if (!window.confirm(`Delete purchase ${p.purchase_no}? Quantities will be subtracted back from stock.`)) return;
    try { await api(`/api/purchases/${p.id}`, { method: 'DELETE' }); toast('Purchase deleted, stock reversed'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center">
        <i className="bi bi-truck me-2 text-primary"></i> Purchase Entries (GRN)
        <button className="btn btn-primary btn-sm ms-auto" onClick={openNew}><i className="bi bi-plus-lg me-1"></i>New Purchase</button>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th>Purchase #</th><th>Date</th><th>Supplier</th><th>Supplier Inv</th><th className="text-center">Items</th>
            <th className="text-end">Total</th><th className="text-end">Paid</th><th className="text-end">Balance</th><th className="text-center">Status</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty colSpan={10} icon="truck" text="No purchases yet" />}
            {rows.map(p => (
              <tr key={p.id}>
                <td className="fw-semibold">{p.purchase_no}</td>
                <td className="small">{fmtDate(p.purchase_date)}</td>
                <td>{p.supplier}</td>
                <td className="small">{p.supplier_invoice || '—'}</td>
                <td className="text-center">{p.items}</td>
                <td className="text-end fw-semibold">{money(p.total)}</td>
                <td className="text-end small">{money(p.paid_amount)}</td>
                <td className={`text-end small ${p.total > p.paid_amount ? 'text-danger fw-semibold' : ''}`}>{money(p.total - p.paid_amount)}</td>
                <td className="text-center"><StatusBadge s={p.payment_status} /></td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary me-1" onClick={() => api(`/api/purchases/${p.id}`).then(setView)}><i className="bi bi-eye"></i></button>
                  {isAdmin && <button className="btn btn-sm btn-outline-danger" onClick={() => del(p)}><i className="bi bi-trash"></i></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- view modal ---------- */}
      <Modal show={!!view} onClose={() => setView(null)} size="modal-lg" title={view ? `${view.purchase_no} — ${view.supplier}` : ''}>
        {view && <>
          <div className="row small mb-3">
            <div className="col-sm-3"><span className="text-muted">Date:</span> <b>{fmtDate(view.purchase_date)}</b></div>
            <div className="col-sm-4"><span className="text-muted">Supplier Invoice:</span> <b>{view.supplier_invoice || '—'}</b></div>
            <div className="col-sm-3"><span className="text-muted">Payment:</span> <StatusBadge s={view.payment_status} /></div>
            <div className="col-sm-2"><span className="text-muted">Paid:</span> <b>{money(view.paid_amount)}</b></div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Product</th><th className="text-end">Qty</th><th className="text-end">Unit Cost</th><th className="text-end">Amount</th></tr></thead>
              <tbody>
                {view.items.map(i => (
                  <tr key={i.id}><td>{i.product_name}</td><td className="text-end">{i.qty}</td><td className="text-end">{money(i.cost_price)}</td><td className="text-end">{money(i.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-end small">
            Subtotal: <b>{money(view.subtotal)}</b> &nbsp; GST: <b>{money(view.tax_amount)}</b> &nbsp; Discount: <b>{money(view.discount)}</b>
            &nbsp; Total: <b className="fs-6 text-primary">{money(view.total)}</b>
          </div>
        </>}
      </Modal>

      {/* ---------- new purchase modal ---------- */}
      <Modal show={!!form} onClose={() => setForm(null)} size="modal-xl" title={<><i className="bi bi-truck me-2"></i>New Purchase Entry</>}
        footer={<><button className="btn btn-light btn-sm" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}><i className="bi bi-check2 me-1"></i>Save Purchase &amp; Update Stock</button></>}>
        {form && <>
          <div className="row g-3 mb-3">
            <div className="col-md-4"><label className="form-label required">Supplier</label>
              <select className="form-select form-select-sm" value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">— Select supplier —</option>
                {form.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="col-md-3"><label className="form-label">Purchase Date</label>
              <input type="date" className="form-control form-control-sm" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></div>
            <div className="col-md-3"><label className="form-label">Supplier Invoice #</label>
              <input className="form-control form-control-sm" placeholder="Their bill number" value={form.supplier_invoice} onChange={e => setForm({ ...form, supplier_invoice: e.target.value })} /></div>
            <div className="col-md-2"><label className="form-label">GST %</label>
              <select className="form-select form-select-sm" value={form.gst} onChange={e => setForm({ ...form, gst: e.target.value })}>
                <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option>
              </select></div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th style={{ minWidth: 260 }}>Product</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 130 }}>Unit Cost ₹</th><th style={{ width: 120 }} className="text-end">Amount</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <select className="form-select form-select-sm" value={it.product_id} onChange={e => pickProduct(i, e.target.value)}>
                        <option value="">— select product —</option>
                        {form.products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.size || ''}/{p.color || ''}) — {p.sku || ''}</option>)}
                      </select></td>
                    <td><input type="number" className="form-control form-control-sm text-end" min="1" value={it.qty} onChange={e => setItem(i, 'qty', e.target.value)} /></td>
                    <td><input type="number" className="form-control form-control-sm text-end" min="0" step="0.01" placeholder="0.00" value={it.cost_price} onChange={e => setItem(i, 'cost_price', e.target.value)} /></td>
                    <td className="text-end align-middle small fw-semibold">{money((Number(it.qty) || 0) * (Number(it.cost_price) || 0))}</td>
                    <td><button className="btn btn-sm btn-outline-danger px-1" onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}><i className="bi bi-x"></i></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-outline-primary btn-sm" onClick={() => setForm(f => ({ ...f, items: [...f.items, { ...emptyRow }] }))}><i className="bi bi-plus-lg me-1"></i>Add Item Row</button>
          <div className="row g-3 mt-1 justify-content-end text-end">
            <div className="col-md-3 col-6 small">Subtotal<div className="fs-6 fw-bold">{money(subtotal)}</div></div>
            <div className="col-md-3 col-6 small">GST Amount<div className="fs-6 fw-bold">{money(tax)}</div></div>
            <div className="col-md-2 col-4 small">Discount ₹<input type="number" className="form-control form-control-sm text-end" min="0" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} /></div>
            <div className="col-md-2 col-4 small">Total<div className="fs-5 fw-bold text-primary">{money(total)}</div></div>
            <div className="col-md-2 col-4 small">Paid ₹<input type="number" className="form-control form-control-sm text-end" placeholder="Full amount" value={form.paid} onChange={e => setForm({ ...form, paid: e.target.value })} /></div>
          </div>
          <div className="mt-2"><label className="form-label">Notes</label>
            <input className="form-control form-control-sm" placeholder="Optional notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="alert alert-info small mt-3 mb-0 py-2"><i className="bi bi-info-circle me-1"></i>Saving a purchase automatically <b>adds the quantities to product stock</b> and updates each product's cost price.</div>
        </>}
      </Modal>
    </div>
  );
}
