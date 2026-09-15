import { useEffect, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { api, money, num, fmtDate, todayStr, monthStartStr, downloadCSV } from '../api';
import { StatCard, PayBadge, Empty } from '../components/ui';

const CHART_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316'];

function CsvBtn({ onClick, title = 'Export CSV' }) {
  return (
    <button className="btn btn-sm btn-outline-secondary float-end py-0 px-1" style={{ fontSize: '.72rem' }} onClick={onClick} title={title}>
      <i className="bi bi-filetype-csv"></i> CSV
    </button>
  );
}

export default function Reports() {
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [r, setR] = useState(null);

  const load = (f = from, t = to) => api(`/api/reports/summary?from=${f}&to=${t}`).then(setR);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const preset = d => {
    let f, t = todayStr();
    if (d === 'today') f = t;
    else if (d === 'month') f = monthStartStr();
    else { const x = new Date(); x.setDate(x.getDate() - (Number(d) - 1)); f = x.toISOString().slice(0, 10); }
    setFrom(f); setTo(t); load(f, t);
  };

  if (!r) return <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>;
  const s = r.summary;
  const gstTot = r.gst.reduce((a, g) => a + Number(g.tax), 0);
  const stamp = `${from}_to_${to}`;

  // ---- CSV exports (one per section + combined) ----
  const summaryRows = () => [
    ['Report Period', `${from} to ${to}`], [],
    ['Metric', 'Value'],
    ['Total Sales', s.sales], ['Invoices', s.invoices],
    ['Gross Profit', s.gross_profit],
    ['Avg Invoice Value', s.invoices ? Math.round(s.sales / s.invoices * 100) / 100 : 0]
  ];
  const dailyRows = () => [['Date', 'Sales', 'Invoices'], ...r.daily.map(d => [d.d, d.t, d.c])];
  const topRows = () => [['Product', 'Qty', 'Revenue', 'Profit'], ...r.topProducts.map(p => [p.name, p.qty, p.amount, p.profit])];
  const gstRows = () => [
    ['GST Rate %', 'Taxable Value', 'Tax Collected', 'CGST', 'SGST'],
    ...r.gst.map(g => [Number(g.rate), g.taxable, g.tax, g.tax / 2, g.tax / 2]),
    ['Total', r.gst.reduce((a, g) => a + Number(g.taxable), 0), gstTot, gstTot / 2, gstTot / 2]
  ];
  const payRows = () => [['Method', 'Bills', 'Amount'], ...r.byPayment.map(p => [p.m, p.c, p.t])];
  const catRows = () => [['Category', 'Qty', 'Revenue'], ...r.byCategory.map(c => [c.name, c.qty, c.amount])];
  const exportAll = () => {
    downloadCSV(`report-${stamp}.csv`, [
      ['GARMENTBILL — FULL REPORT', `${from} to ${to}`], [],
      ...summaryRows(), [],
      ['DAILY SALES'], ...dailyRows(), [],
      ['TOP PRODUCTS BY REVENUE'], ...topRows(), [],
      ['GST SUMMARY'], ...gstRows(), [],
      ['PAYMENT SPLIT'], ...payRows(), [],
      ['CATEGORY BREAKDOWN'], ...catRows()
    ]);
  };

  return (
    <>
      <div className="card mb-3">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-2 col-6"><label className="form-label mb-1">From</label><input type="date" className="form-control form-control-sm" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="col-md-2 col-6"><label className="form-label mb-1">To</label><input type="date" className="form-control form-control-sm" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div className="col-md-4 col-12 d-flex gap-2 flex-wrap">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => preset('today')}>Today</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => preset('7')}>7 days</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => preset('30')}>30 days</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => preset('month')}>This month</button>
            </div>
            <div className="col-md-4 d-flex justify-content-md-end gap-2">
              <button className="btn btn-outline-success btn-sm" onClick={exportAll}><i className="bi bi-filetype-csv me-1"></i>Export All CSV</button>
              <button className="btn btn-primary btn-sm" onClick={() => load()}><i className="bi bi-arrow-repeat me-1"></i>Run Report</button></div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <StatCard icon="currency-rupee" tone="success" label="Total Sales" value={money(s.sales)} />
        <StatCard icon="receipt" tone="primary" label="Invoices" value={s.invoices} />
        <StatCard icon="graph-up" tone="info" label="Gross Profit" value={money(s.gross_profit)} />
        <StatCard icon="cart-check" tone="warning" label="Avg Invoice Value" value={s.invoices ? money(s.sales / s.invoices) : '₹0'} />
      </div>

      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card mb-3"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`daily-sales-${stamp}.csv`, dailyRows())} /><i className="bi bi-bar-chart me-2 text-primary"></i> Daily Sales</div>
            <div className="card-body" style={{ height: 280 }}>
              <Bar data={{ labels: r.daily.map(d => fmtDate(d.d)), datasets: [
                { label: 'Sales ₹', data: r.daily.map(d => Number(d.t)), backgroundColor: '#4f46e5', borderRadius: 4, yAxisID: 'y' },
                { type: 'line', label: 'Invoices', data: r.daily.map(d => d.c), borderColor: '#10b981', tension: .3, yAxisID: 'y1' }] }}
                options={{ maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '₹' + num(v) } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }} />
            </div></div>

          <div className="card mb-3"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`top-products-${stamp}.csv`, topRows())} /><i className="bi bi-trophy me-2 text-warning"></i> Top Products (by revenue)</div>
            <div className="table-responsive"><table className="table mb-0">
              <thead><tr><th>Product</th><th className="text-end">Qty</th><th className="text-end">Revenue</th><th className="text-end">Profit</th></tr></thead>
              <tbody>
                {r.topProducts.length === 0 && <Empty colSpan={4} text="No data" />}
                {r.topProducts.map((p, i) => (
                  <tr key={i}><td className="small">{p.name}</td><td className="text-end">{p.qty}</td><td className="text-end small">{money(p.amount)}</td><td className="text-end small text-success">{money(p.profit)}</td></tr>
                ))}
              </tbody></table></div></div>

          <div className="card"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`gst-summary-${stamp}.csv`, gstRows())} /><i className="bi bi-percent me-2 text-danger"></i> GST Summary <span className="small text-muted fw-normal">(tax collected on sales)</span></div>
            <div className="table-responsive"><table className="table mb-0">
              <thead><tr><th>GST Rate</th><th className="text-end">Taxable Value</th><th className="text-end">Tax Collected</th><th className="text-end">CGST</th><th className="text-end">SGST</th></tr></thead>
              <tbody>
                {r.gst.map(g => (
                  <tr key={g.rate}><td>{Number(g.rate)}%</td><td className="text-end small">{money(g.taxable)}</td><td className="text-end small fw-semibold">{money(g.tax)}</td><td className="text-end small">{money(g.tax / 2)}</td><td className="text-end small">{money(g.tax / 2)}</td></tr>
                ))}
                <tr className="table-light fw-bold"><td>Total</td>
                  <td className="text-end">{money(r.gst.reduce((a, g) => a + Number(g.taxable), 0))}</td>
                  <td className="text-end">{money(gstTot)}</td><td className="text-end">{money(gstTot / 2)}</td><td className="text-end">{money(gstTot / 2)}</td></tr>
              </tbody></table></div></div>
        </div>

        <div className="col-lg-4">
          <div className="card mb-3"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`category-share-${stamp}.csv`, catRows())} /><i className="bi bi-pie-chart me-2 text-primary"></i> Category Share</div>
            <div className="card-body" style={{ height: 260 }}>
              <Doughnut data={{ labels: r.byCategory.map(c => c.name), datasets: [{ data: r.byCategory.map(c => Number(c.amount)), backgroundColor: CHART_COLORS }] }}
                options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
            </div></div>

          <div className="card mb-3"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`payment-split-${stamp}.csv`, payRows())} /><i className="bi bi-wallet2 me-2 text-primary"></i> Payment Split</div>
            <div className="table-responsive"><table className="table table-sm mb-0">
              <thead><tr><th>Method</th><th className="text-end">Bills</th><th className="text-end">Amount</th></tr></thead>
              <tbody>
                {r.byPayment.length === 0 && <Empty colSpan={3} text="No data" />}
                {r.byPayment.map(p => <tr key={p.m}><td><PayBadge m={p.m} /></td><td className="text-end">{p.c}</td><td className="text-end small">{money(p.t)}</td></tr>)}
              </tbody></table></div></div>

          <div className="card"><div className="card-header"><CsvBtn onClick={() => downloadCSV(`category-breakdown-${stamp}.csv`, catRows())} /><i className="bi bi-collection me-2 text-primary"></i> Category Breakdown</div>
            <div className="table-responsive"><table className="table table-sm mb-0">
              <thead><tr><th>Category</th><th className="text-end">Qty</th><th className="text-end">Revenue</th></tr></thead>
              <tbody>
                {r.byCategory.length === 0 && <Empty colSpan={3} text="No data" />}
                {r.byCategory.map(c => <tr key={c.name}><td className="small">{c.name}</td><td className="text-end small">{c.qty}</td><td className="text-end small">{money(c.amount)}</td></tr>)}
              </tbody></table></div></div>
        </div>
      </div>
    </>
  );
}
