import { useEffect, useMemo, useRef, useState } from 'react';
import { api, money, fmtDateTime, printInvoice } from '../api';
import { useApp } from '../context/AppContext';
import { Avatar, Modal, Empty } from '../components/ui';

export default function POS() {
  const { toast, shop } = useApp();
  const gstOn = shop.gst_enabled === undefined ? true : !!shop.gst_enabled;
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]);
  const [activeCat, setActiveCat] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [invDisc, setInvDisc] = useState(0);
  const [payMethod, setPayMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [held, setHeld] = useState([]);
  const [showHeld, setShowHeld] = useState(false);
  const [showCust, setShowCust] = useState(false);
  const [qc, setQc] = useState({ name: '', phone: '' });
  const [success, setSuccess] = useState(null); // {id, invoice_no, total, change}
  const barcodeRef = useRef(null);

  useEffect(() => {
    Promise.all([api('/api/products'), api('/api/categories'), api('/api/customers')])
      .then(([p, c, cu]) => { setProducts(p); setCategories(c); setCustomers(cu); });
    refreshHeld();
    barcodeRef.current?.focus();
  }, []);

  const refreshHeld = () => api('/api/sales?status=held').then(setHeld).catch(() => {});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (!activeCat || p.category_id === activeCat) &&
      (!q || [p.name, p.sku, p.barcode, p.brand, p.color, p.size, p.category].join(' ').toLowerCase().includes(q)));
  }, [products, activeCat, search]);

  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of cart) {
      const line = Math.max(0, l.qty * l.price - l.discount);
      sub += line;
      tax += gstOn ? line * l.tax_rate / 100 : 0;
    }
    const disc = Math.min(Number(invDisc) || 0, sub);
    return { sub, tax, disc, grand: sub + tax - disc };
  }, [cart, invDisc, gstOn]);

  // ---------- cart ops ----------
  const addProduct = p => {
    if (p.stock <= 0) return toast('Product is out of stock', 'warning');
    setCart(prev => {
      const i = prev.findIndex(l => l.product_id === p.id);
      if (i >= 0) {
        if (prev[i].qty >= p.stock) { toast(`Only ${p.stock} in stock`, 'warning'); return prev; }
        return prev.map((l, j) => j === i ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, { product_id: p.id, name: p.name, size: p.size, color: p.color, stock: p.stock, tax_rate: Number(p.tax_rate), price: Number(p.sale_price), qty: 1, discount: 0 }];
    });
  };

  const setQty = (i, delta) => setCart(prev => {
    const l = prev[i]; const nq = l.qty + delta;
    if (nq <= 0) return prev.filter((_, j) => j !== i);
    if (nq > l.stock) { toast(`Only ${l.stock} in stock`, 'warning'); return prev; }
    return prev.map((x, j) => j === i ? { ...x, qty: nq } : x);
  });
  const setLine = (i, key, v) => setCart(prev => prev.map((x, j) => j === i ? { ...x, [key]: Math.max(0, Number(v) || 0) } : x));
  const removeLine = i => setCart(prev => prev.filter((_, j) => j !== i));
  const clearCart = () => { setCart([]); setInvDisc(0); setTendered(''); };

  // ---------- barcode ----------
  const onBarcode = async e => {
    if (e.key !== 'Enter') return;
    const code = e.target.value.trim();
    if (!code) return;
    try {
      const p = await api('/api/products/lookup?code=' + encodeURIComponent(code));
      addProduct(p);
      toast(`${p.name} (${p.size}/${p.color}) added`, 'info');
    } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
    barcodeRef.current?.focus();
  };

  // ---------- checkout / hold ----------
  const postSale = async isHold => {
    const body = {
      items: cart.map(l => ({ product_id: l.product_id, qty: l.qty, price: l.price, discount: l.discount })),
      customer_id: customerId || null, discount: Number(invDisc) || 0,
      payment_method: payMethod, status: isHold ? 'held' : 'completed'
    };
    if (!isHold) {
      const tender = payMethod === 'cash' ? (Number(tendered) || totals.grand) : totals.grand;
      if (tender < totals.grand) throw new Error('Tendered amount is less than the bill total');
      body.paid_amount = tender;
    }
    return api('/api/sales', { method: 'POST', body });
  };

  const checkout = async () => {
    if (!cart.length) return toast('Cart is empty — scan or pick products first', 'warning');
    try {
      const r = await postSale(false);
      setProducts(prev => prev.map(p => {
        const l = cart.find(x => x.product_id === p.id);
        return l ? { ...p, stock: p.stock - l.qty } : p;
      }));
      setSuccess(r);
      clearCart(); refreshHeld();
    } catch (e) { toast(e.message, 'error'); }
  };

  useEffect(() => {
    const h = e => { if (e.key === 'F9') { e.preventDefault(); checkout(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, invDisc, payMethod, tendered, customerId]);

  const hold = async () => {
    if (!cart.length) return toast('Cart is empty', 'warning');
    try { await postSale(true); toast('Invoice kept on hold'); clearCart(); refreshHeld(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const resumeHeld = async id => {
    try {
      const s = await api(`/api/sales/${id}`);
      setCart(s.items.map(it => {
        const p = products.find(x => x.id === it.product_id);
        return { product_id: it.product_id, name: it.product_name, size: '', color: '', stock: (p?.stock || 0) + it.qty, tax_rate: Number(it.tax_rate), price: Number(it.price), qty: it.qty, discount: Number(it.discount) };
      }));
      setInvDisc(s.discount || 0);
      if (s.customer_id) setCustomerId(String(s.customer_id));
      await api(`/api/sales/${id}`, { method: 'DELETE' });
      setShowHeld(false); refreshHeld();
      toast('Held invoice resumed');
    } catch (e) { toast(e.message, 'error'); }
  };

  const quickAddCustomer = async () => {
    if (!qc.name.trim()) return toast('Name is required', 'error');
    try {
      const { id } = await api('/api/customers', { method: 'POST', body: qc });
      setCustomers(await api('/api/customers'));
      setCustomerId(String(id));
      setShowCust(false); setQc({ name: '', phone: '' });
      toast('Customer added');
    } catch (e) { toast(e.message, 'error'); }
  };

  const change = Math.max(0, (Number(tendered) || 0) - totals.grand);

  return (
    <div className="row g-3">
      {/* ---------- LEFT: product picker ---------- */}
      <div className="col-lg-8">
        <div className="card">
          <div className="card-body pb-2">
            <div className="row g-2">
              <div className="col-md-5">
                <div className="input-group">
                  <span className="input-group-text bg-primary text-white"><i className="bi bi-upc-scan"></i></span>
                  <input ref={barcodeRef} className="form-control" placeholder="Scan barcode / SKU + Enter" autoComplete="off" onKeyDown={onBarcode} />
                </div>
              </div>
              <div className="col-md-7">
                <div className="search-box">
                  <i className="bi bi-search"></i>
                  <input className="form-control" placeholder="Search products by name, brand, color, size…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="d-flex gap-2 mt-3 flex-wrap">
              <button className={`chip ${!activeCat ? 'active' : ''}`} onClick={() => setActiveCat('')}>All Items</button>
              {categories.map(c => (
                <button key={c.id} className={`chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>{c.name}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="row g-2 mt-1">
          {filtered.length === 0 && <div className="col-12"><div className="card"><Empty icon="search" text="No products match your search" /></div></div>}
          {filtered.map(p => (
            <div className="col-6 col-md-4 col-xl-3" key={p.id}>
              <div className={`card prod-card p-2 ${p.stock <= 0 ? 'oos' : ''}`} onClick={() => addProduct(p)}>
                <div className="d-flex justify-content-between align-items-start">
                  <Avatar name={p.name} />
                  {p.stock <= 0 ? <span className="badge bg-danger badge-soft">Out</span>
                    : p.stock <= p.low_stock_alert ? <span className="badge bg-warning text-dark badge-soft">{p.stock}</span>
                    : <span className="badge bg-light text-muted border badge-soft">{p.stock}</span>}
                </div>
                <div className="p-name mt-2" title={p.name}>{p.name}</div>
                <div className="small text-muted">{p.size || ''} · {p.color || ''} · {p.sku || ''}</div>
                <div className="d-flex align-items-baseline gap-2 mt-1">
                  <span className="p-price">{money(p.sale_price)}</span><span className="p-mrp">{money(p.mrp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- RIGHT: cart ---------- */}
      <div className="col-lg-4">
        <div className="card" style={{ position: 'sticky', top: 76 }}>
          <div className="card-header d-flex align-items-center">
            <i className="bi bi-cart3 me-2 text-primary"></i> Current Sale
            <span className="badge bg-primary ms-2">{cart.reduce((a, l) => a + l.qty, 0)}</span>
            <button className="btn btn-sm btn-outline-warning ms-auto" onClick={() => setShowHeld(true)}>
              <i className="bi bi-pause-circle me-1"></i>Held <span className="badge bg-warning text-dark">{held.length}</span>
            </button>
          </div>
          <div className="card-body">
            <div className="d-flex gap-2 mb-2">
              <select className="form-select form-select-sm" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">Walk-in Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
              </select>
              <button className="btn btn-sm btn-outline-primary flex-none" onClick={() => setShowCust(true)}><i className="bi bi-person-plus"></i></button>
            </div>

            <div className="table-responsive" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="table table-sm mb-0">
                <thead><tr><th>Item</th><th style={{ width: 96 }}>Qty</th><th style={{ width: 80 }} className="text-end">Rate</th><th style={{ width: 62 }} className="text-end">Disc</th><th style={{ width: 72 }} className="text-end">Amount</th><th style={{ width: 26 }}></th></tr></thead>
                <tbody>
                  {cart.length === 0 && <tr><td colSpan={6}><Empty icon="cart-x" text={<>Cart is empty.<br />Scan a barcode or click a product.</>} /></td></tr>}
                  {cart.map((l, i) => (
                    <tr key={l.product_id} className="cart-line">
                      <td><div className="fw-semibold">{l.name}</div><small className="text-muted">{l.size}/{l.color} · GST {l.tax_rate}%{!gstOn && ' (off)'}</small></td>
                      <td>
                        <div className="btn-group">
                          <button className="btn btn-outline-secondary qty-btn" onClick={() => setQty(i, -1)}>−</button>
                          <span className="px-1 align-self-center small">{l.qty}</span>
                          <button className="btn btn-outline-secondary qty-btn" onClick={() => setQty(i, 1)}>+</button>
                        </div>
                      </td>
                      <td><input type="number" className="form-control form-control-sm text-end" value={l.price} min="0" onChange={e => setLine(i, 'price', e.target.value)} /></td>
                      <td><input type="number" className="form-control form-control-sm text-end" value={l.discount} min="0" onChange={e => setLine(i, 'discount', e.target.value)} /></td>
                      <td className="text-end fw-semibold">{money(Math.max(0, l.qty * l.price - l.discount))}</td>
                      <td><button className="btn btn-sm btn-link text-danger p-0" onClick={() => removeLine(i)}><i className="bi bi-x-lg"></i></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <hr className="my-2" />
            <div className="small">
              <div className="d-flex justify-content-between py-1"><span className="text-muted">Subtotal</span><span>{money(totals.sub)}</span></div>
              <div className="d-flex justify-content-between py-1 align-items-center"><span className="text-muted">Invoice discount</span>
                <input type="number" className="form-control form-control-sm text-end" style={{ width: 100 }} value={invDisc} min="0" onChange={e => setInvDisc(e.target.value)} /></div>
              <div className="d-flex justify-content-between py-1"><span className="text-muted">GST {gstOn ? '' : '(off — zero tax)'}</span><span>{money(totals.tax)}</span></div>
              {!gstOn && <div className="alert alert-warning small py-1 px-2 mb-1 mt-1" style={{ fontSize: '.7rem' }}>GST is switched OFF in Settings — no tax will be charged on new invoices.</div>}
              <div className="d-flex justify-content-between py-2 fs-5 fw-bold border-top"><span>Grand Total</span><span className="text-primary">{money(totals.grand)}</span></div>
            </div>

            <div className="btn-group w-100 mb-2">
              {[['cash', 'Cash', 'success', 'cash-stack'], ['upi', 'UPI', 'primary', 'qr-code'], ['card', 'Card', 'warning', 'credit-card']].map(([v, label, tone, icon]) => (
                <span key={v}>
                  <input type="radio" className="btn-check" name="pm" id={`pm-${v}`} checked={payMethod === v} onChange={() => setPayMethod(v)} />
                  <label className={`btn btn-outline-${tone} btn-sm`} htmlFor={`pm-${v}`}><i className={`bi bi-${icon} me-1`}></i>{label}</label>
                </span>
              ))}
            </div>

            {payMethod === 'cash' && (
              <div className="row g-2 mb-2">
                <div className="col-6"><label className="form-label mb-1">Tendered</label>
                  <input type="number" className="form-control form-control-sm text-end" placeholder="0" value={tendered} onChange={e => setTendered(e.target.value)} /></div>
                <div className="col-6"><label className="form-label mb-1">Change</label>
                  <input className="form-control form-control-sm text-end fw-bold" readOnly value={money(change)} /></div>
              </div>
            )}

            <div className="d-grid gap-2">
              <button className="btn btn-success btn-lg" onClick={checkout}><i className="bi bi-check2-circle me-2"></i>Complete Sale (F9)</button>
              <div className="d-flex gap-2">
                <button className="btn btn-outline-warning flex-fill" onClick={hold}><i className="bi bi-pause-circle me-1"></i>Hold</button>
                <button className="btn btn-outline-danger flex-fill" onClick={() => { if (!cart.length || window.confirm('Clear the cart?')) clearCart(); }}><i className="bi bi-trash me-1"></i>Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- held invoices ---------- */}
      <Modal show={showHeld} onClose={() => setShowHeld(false)} title={<><i className="bi bi-pause-circle me-2"></i>Held Invoices</>}>
        {held.length === 0 && <div className="text-muted text-center py-3">No held invoices</div>}
        {held.map(h => (
          <div key={h.id} className="d-flex align-items-center border rounded p-2 mb-2">
            <div><b>{h.invoice_no}</b><br /><small className="text-muted">{fmtDateTime(h.sale_date)} · {h.items} item(s) · {h.customer}</small></div>
            <div className="ms-auto fw-bold me-3">{money(h.total)}</div>
            <button className="btn btn-sm btn-primary me-1" onClick={() => resumeHeld(h.id)}><i className="bi bi-play-fill"></i></button>
            <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (window.confirm('Delete this held invoice?')) { await api(`/api/sales/${h.id}`, { method: 'DELETE' }); refreshHeld(); } }}><i className="bi bi-trash"></i></button>
          </div>
        ))}
      </Modal>

      {/* ---------- quick customer ---------- */}
      <Modal show={showCust} onClose={() => setShowCust(false)} title="Quick Add Customer" size="modal-sm"
        footer={<button className="btn btn-primary btn-sm" onClick={quickAddCustomer}>Save</button>}>
        <label className="form-label required">Name</label>
        <input className="form-control form-control-sm mb-2" value={qc.name} onChange={e => setQc({ ...qc, name: e.target.value })} />
        <label className="form-label">Phone</label>
        <input className="form-control form-control-sm" value={qc.phone} onChange={e => setQc({ ...qc, phone: e.target.value })} />
      </Modal>

      {/* ---------- success ---------- */}
      <Modal show={!!success} onClose={() => { setSuccess(null); barcodeRef.current?.focus(); }} title="Sale Completed">
        <div className="text-center py-2">
          <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3rem' }}></i>
          <h4 className="mt-2 mb-0">{success?.invoice_no}</h4>
          <div className="text-muted small">Sale completed successfully</div>
          <div className="fs-3 fw-bold my-3">{money(success?.total)}</div>
          {success?.change > 0 && <div className="text-success fw-semibold">Change to return: {money(success.change)}</div>}
          <div className="d-grid gap-2 mt-3">
            <button className="btn btn-primary" onClick={() => printInvoice(success.id)}><i className="bi bi-printer me-1"></i>Print Receipt</button>
            <button className="btn btn-outline-secondary" onClick={() => { setSuccess(null); barcodeRef.current?.focus(); }}>New Sale</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
