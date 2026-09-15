import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Doughnut, Pie } from 'react-chartjs-2';
import { api, money, num, fmtDateTime, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { StatCard, Empty } from '../components/ui';
import InvoiceModal from '../components/InvoiceModal';

const CHART_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316'];
const pmColors = { cash: '#10b981', upi: '#6366f1', card: '#f59e0b', bank: '#0ea5e9' };

export default function Dashboard() {
  const { me } = useApp();
  const [d, setD] = useState(null);
  const [invoiceId, setInvoiceId] = useState(null);

  const load = () => api('/api/dashboard').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!d) return <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>;
  const k = d.kpi;

  return (
    <>
      <div className="row g-3">
        <StatCard icon="cash-coin" tone="success" label="Today's Sales" value={money(k.todaySales)} />
        <StatCard icon="calendar-check" tone="primary" label="This Month" value={money(k.monthSales)} />
        <StatCard icon="box-seam" tone="info" label="Stock Value (retail)" value={money(k.retailValue)} />
        <StatCard icon="exclamation-triangle" tone="warning" label="Low Stock Items" value={k.lowStock} />
      </div>

      <div className="row g-3 mt-1">
        <div className="col-lg-8">
          <div className="card">
            <div className="card-header d-flex align-items-center">
              <i className="bi bi-graph-up-arrow me-2 text-primary"></i> Sales — Last 14 Days
              <div className="ms-auto small text-muted">{k.todayInvoices} invoices today · {k.skus} SKUs · {k.customers} customers</div>
            </div>
            <div className="card-body" style={{ height: 320 }}>
              <Bar
                data={{
                  labels: d.trend.labels,
                  datasets: [
                    { type: 'line', label: 'Sales ₹', data: d.trend.sales, borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.12)', fill: true, tension: .35, yAxisID: 'y' },
                    { label: 'Invoices', data: d.trend.invoices, backgroundColor: 'rgba(16,185,129,.55)', borderRadius: 4, yAxisID: 'y1' }
                  ]
                }}
                options={{ maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                  scales: { y: { beginAtZero: true, ticks: { callback: v => '₹' + num(v) } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } } },
                  plugins: { legend: { position: 'bottom' } } }} />
            </div>
          </div>
          <div className="row g-3 mt-1">
            <div className="col-md-6">
              <div className="card h-100">
                <div className="card-header"><i className="bi bi-pie-chart me-2 text-primary"></i> Category-wise Sales <span className="text-muted fw-normal small">(30 days)</span></div>
                <div className="card-body" style={{ height: 270 }}>
                  <Doughnut data={{ labels: d.categorySales.map(c => c.name), datasets: [{ data: d.categorySales.map(c => Number(c.amount)), backgroundColor: CHART_COLORS }] }}
                    options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 11, font: { size: 11 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${money(c.parsed)}` } } } }} />
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="card h-100">
                <div className="card-header"><i className="bi bi-wallet2 me-2 text-primary"></i> Payment Methods <span className="text-muted fw-normal small">(30 days)</span></div>
                <div className="card-body" style={{ height: 270 }}>
                  <Pie data={{ labels: d.paymentSplit.map(p => p.m.toUpperCase()), datasets: [{ data: d.paymentSplit.map(p => Number(p.t)), backgroundColor: d.paymentSplit.map(p => pmColors[p.m] || '#94a3b8') }] }}
                    options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 11, font: { size: 11 } } } } }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4 d-flex flex-column gap-3">
          <div className="card">
            <div className="card-header d-flex"><i className="bi bi-lightning-charge me-2 text-warning"></i> Quick Actions</div>
            <div className="card-body d-grid gap-2">
              <Link className="btn btn-primary" to="/pos"><i className="bi bi-cart-plus me-2"></i>New Sale (POS)</Link>
              <div className="row g-2">
                <div className="col-6"><Link className="btn btn-outline-secondary w-100" to="/products"><i className="bi bi-plus-circle me-1"></i>Product</Link></div>
                {hasRole(me, 'manager') && <div className="col-6"><Link className="btn btn-outline-secondary w-100" to="/purchases"><i className="bi bi-truck me-1"></i>Purchase</Link></div>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><i className="bi bi-receipt me-2 text-primary"></i> Recent Invoices</div>
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead><tr><th>Invoice</th><th>Customer</th><th className="text-end">Total</th></tr></thead>
                <tbody>
                  {d.recent.length === 0 && <Empty colSpan={3} text="No sales yet" />}
                  {d.recent.map(r => (
                    <tr key={r.id} className="clickable" onClick={() => setInvoiceId(r.id)}>
                      <td><span className="fw-semibold">{r.invoice_no}</span><br /><small className="text-muted">{fmtDateTime(r.sale_date)}</small></td>
                      <td className="small">{r.customer}<br /><small className="text-muted">{r.items} item(s)</small></td>
                      <td className="text-end fw-semibold">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header d-flex"><i className="bi bi-fire me-2 text-danger"></i> Top Products <span className="text-muted fw-normal small ms-auto">30 days</span></div>
            <div className="table-responsive">
              <table className="table mb-0">
                <thead><tr><th>Product</th><th className="text-end">Qty</th><th className="text-end">Revenue</th></tr></thead>
                <tbody>
                  {d.topProducts.length === 0 && <Empty colSpan={3} text="No data" />}
                  {d.topProducts.map((t, i) => (
                    <tr key={i}><td className="small">{t.name}</td><td className="text-end">{t.qty}</td><td className="text-end small">{money(t.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card border-warning-subtle">
            <div className="card-header text-warning"><i className="bi bi-exclamation-triangle me-2"></i> Low Stock Alerts</div>
            <div className="card-body py-2 small">
              {d.lowStockList.length === 0 && <div className="text-muted">All good — no low stock items 🎉</div>}
              {d.lowStockList.map(p => (
                <div key={p.id} className="d-flex justify-content-between py-1 border-bottom">
                  <span>{p.name} <span className="text-muted">({p.size || ''}/{p.color || ''})</span></span>
                  <span className="badge bg-danger badge-soft">{p.stock} left</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <InvoiceModal saleId={invoiceId} onClose={() => setInvoiceId(null)} onChanged={load} />
    </>
  );
}
