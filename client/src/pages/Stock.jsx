import { useEffect, useMemo, useState } from 'react';
import { api, money, num, fmtDateTime, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { StatCard, Modal, StockBadge, Empty } from '../components/ui';

export default function Stock() {
  const { me, toast } = useApp();
  const isMgr = hasRole(me, 'manager');
  const [stock, setStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [tab, setTab] = useState('inv');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [adj, setAdj] = useState(null); // {product, qty, reason, note}

  const load = async () => {
    const s = await api('/api/stock');
    setStock(s);
    if (isMgr) api('/api/stock/movements').then(setMovements).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const catNames = useMemo(() => [...new Set(stock.map(s => s.category).filter(Boolean))], [stock]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return stock.filter(x =>
      (!s || [x.name, x.sku, x.barcode, x.color, x.size, x.category].join(' ').toLowerCase().includes(s)) &&
      (!cat || x.category === cat) && (!lowOnly || x.stock <= x.low_stock_alert));
  }, [stock, q, cat, lowOnly]);

  const applyAdj = async () => {
    try {
      const r = await api('/api/stock/adjust', { method: 'POST', body: {
        product_id: adj.product.id, adjustment: Number(adj.qty),
        reason: `${adj.reason}${adj.note ? ': ' + adj.note : ''}` } });
      toast(`Stock updated → ${r.stock}`);
      setAdj(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="row g-3 mb-3">
        <StatCard icon="box-seam" tone="primary" label="Units in Stock" value={num(stock.reduce((a, s) => a + s.stock, 0))} />
        <StatCard icon="calculator" tone="info" label="Value @ Cost" value={money(stock.reduce((a, s) => a + Number(s.cost_value), 0))} />
        <StatCard icon="tag" tone="success" label="Value @ Sale Price" value={money(stock.reduce((a, s) => a + Number(s.retail_value), 0))} />
        <StatCard icon="exclamation-triangle" tone="warning" label="Low / Out of Stock" value={stock.filter(s => s.stock <= s.low_stock_alert).length} />
      </div>

      <div className="card">
        <div className="card-header">
          <ul className="nav nav-pills card-header-pills">
            <li className="nav-item"><button className={`nav-link ${tab === 'inv' ? 'active' : ''}`} onClick={() => setTab('inv')}>Stock Register</button></li>
            {isMgr && <li className="nav-item"><button className={`nav-link ${tab === 'mov' ? 'active' : ''}`} onClick={() => setTab('mov')}>Adjustment History</button></li>}
          </ul>
        </div>
        <div className="card-body py-3">
          <div className="row g-2">
            <div className="col-md-4"><div className="search-box"><i className="bi bi-search"></i>
              <input className="form-control form-control-sm" placeholder="Search stock…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
            <div className="col-md-3 col-6">
              <select className="form-select form-select-sm" value={cat} onChange={e => setCat(e.target.value)}>
                <option value="">All categories</option>
                {catNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div className="col-md-3 col-6 d-flex align-items-center">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="lowOnly" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />
                <label className="form-check-label small" htmlFor="lowOnly">Low stock only</label>
              </div></div>
          </div>
        </div>

        {tab === 'inv' ? (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead><tr><th>Product</th><th>Category</th><th>SKU / Barcode</th><th className="text-center">Stock</th>
                <th className="text-end">Cost Value</th><th className="text-end">Retail Value</th>{isMgr && <th className="text-end">Adjust</th>}</tr></thead>
              <tbody>
                {filtered.length === 0 && <Empty colSpan={7} icon="boxes" text="Nothing matches" />}
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td><div className="fw-semibold">{s.name}</div><small className="text-muted">{s.size || ''} · {s.color || ''}</small></td>
                    <td className="small">{s.category || '—'}</td>
                    <td className="small">{s.sku || '—'}<br /><span className="text-muted font-monospace">{s.barcode || ''}</span></td>
                    <td className="text-center"><StockBadge stock={s.stock} low={s.low_stock_alert} /></td>
                    <td className="text-end small">{money(s.cost_value)}</td>
                    <td className="text-end small">{money(s.retail_value)}</td>
                    {isMgr && <td className="text-end">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => setAdj({ product: s, qty: '', reason: 'Physical stock count', note: '' })}>
                        <i className="bi bi-sliders me-1"></i>Adjust</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>When</th><th>Product</th><th className="text-center">Change</th><th>Reason</th></tr></thead>
              <tbody>
                {movements.length === 0 && <Empty colSpan={4} text="No adjustments recorded" />}
                {movements.map((m, i) => (
                  <tr key={i}>
                    <td className="small text-muted">{fmtDateTime(m.created_at)}</td>
                    <td>{m.product_name}</td>
                    <td className="text-center"><span className={`badge ${m.adjustment > 0 ? 'bg-success' : 'bg-danger'} badge-soft`}>{m.adjustment > 0 ? '+' : ''}{m.adjustment}</span></td>
                    <td className="small">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal show={!!adj} onClose={() => setAdj(null)} size="modal-sm" title="Adjust Stock"
        footer={<><button className="btn btn-light btn-sm" onClick={() => setAdj(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={applyAdj}>Apply</button></>}>
        {adj && <>
          <div className="small fw-semibold mb-2">{adj.product.name} ({adj.product.size || '—'}/{adj.product.color || '—'}) — current: {adj.product.stock}</div>
          <label className="form-label">Adjustment (use − for reduction)</label>
          <input type="number" className="form-control form-control-sm mb-2" placeholder="e.g. 5 or -2" value={adj.qty} onChange={e => setAdj({ ...adj, qty: e.target.value })} />
          <label className="form-label">Reason</label>
          <select className="form-select form-select-sm mb-2" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })}>
            <option>Physical stock count</option><option>Damaged / defective</option>
            <option>Theft / loss</option><option>Exchange piece</option><option>Other</option>
          </select>
          <input className="form-control form-control-sm" placeholder="Optional note" value={adj.note} onChange={e => setAdj({ ...adj, note: e.target.value })} />
        </>}
      </Modal>
    </>
  );
}
