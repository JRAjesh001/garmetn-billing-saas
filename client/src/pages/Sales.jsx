import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, fmtDateTime, todayStr, monthStartStr, printInvoice } from '../api';
import { PayBadge, StatusBadge, Empty } from '../components/ui';
import InvoiceModal from '../components/InvoiceModal';

export default function Sales() {
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [invoiceId, setInvoiceId] = useState(null);

  const load = async () => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    setRows(await api('/api/sales?' + p.toString()));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to, status]);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const total = rows.reduce((a, s) => a + (s.status === 'completed' ? Number(s.total) : 0), 0);

  return (
    <div className="card">
      <div className="card-body py-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-2 col-6"><label className="form-label mb-1">From</label><input type="date" className="form-control form-control-sm" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="col-md-2 col-6"><label className="form-label mb-1">To</label><input type="date" className="form-control form-control-sm" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="col-md-2 col-6"><label className="form-label mb-1">Status</label>
            <select className="form-select form-select-sm" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option><option value="completed">Completed</option>
              <option value="held">Held</option><option value="returned">Returned</option>
            </select></div>
          <div className="col-md-3 col-6"><label className="form-label mb-1">Search</label>
            <input className="form-control form-control-sm" placeholder="Invoice # or customer…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="col-md-3 d-flex gap-2 justify-content-md-end">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => { setFrom(monthStartStr()); setTo(todayStr()); setStatus(''); setQ(''); }}>Reset</button>
            <Link className="btn btn-primary btn-sm" to="/pos"><i className="bi bi-cart-plus me-1"></i>New Sale</Link>
          </div>
        </div>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th className="text-center">Items</th>
            <th className="text-end">Total</th><th className="text-center">Payment</th><th className="text-center">Status</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty colSpan={8} icon="receipt" text="No invoices found for this filter" />}
            {rows.map(s => (
              <tr key={s.id}>
                <td className="fw-semibold clickable text-primary" onClick={() => setInvoiceId(s.id)}>{s.invoice_no}</td>
                <td className="small">{fmtDateTime(s.sale_date)}</td>
                <td>{s.customer}</td>
                <td className="text-center">{s.items || 0}</td>
                <td className="text-end fw-semibold">{money(s.total)}</td>
                <td className="text-center"><PayBadge m={s.payment_method} /></td>
                <td className="text-center"><StatusBadge s={s.status} /></td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setInvoiceId(s.id)} title="View / Print"><i className="bi bi-eye"></i></button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => printInvoice(s.id)} title="Direct print"><i className="bi bi-printer"></i></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-footer bg-white small text-muted">{rows.length} invoice(s) · Completed sales value: {money(total)}</div>

      <InvoiceModal saleId={invoiceId} onClose={() => setInvoiceId(null)} onChanged={load} />
    </div>
  );
}
