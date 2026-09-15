import { AV_COLORS } from '../api';

/* ---------- Modal (Bootstrap classes, no JS dependency) ---------- */
export function Modal({ show, onClose, title, children, footer, size = '' }) {
  if (!show) return null;
  return (
    <>
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div className={`modal-dialog ${size}`}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </>
  );
}

/* ---------- KPI stat card ---------- */
export function StatCard({ icon, tone = 'primary', label, value }) {
  return (
    <div className="col-sm-6 col-xl-3">
      <div className="card kpi p-3">
        <div className="d-flex gap-3 align-items-center">
          <div className={`kpi-icon bg-${tone}-subtle text-${tone}`}><i className={`bi bi-${icon}`}></i></div>
          <div><div className="kpi-val">{value}</div><div className="kpi-lbl">{label}</div></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Badges ---------- */
export function StockBadge({ stock, low }) {
  if (stock <= 0) return <span className="badge bg-danger badge-soft">Out of stock</span>;
  if (stock <= low) return (
    <span className="badge bg-warning text-dark badge-soft"><span className="low-dot bg-danger"></span>Low: {stock}</span>
  );
  return <span className="badge bg-success badge-soft">{stock}</span>;
}

const payIcon = { cash: 'cash-stack', upi: 'qr-code', card: 'credit-card', bank: 'bank2' };
export function PayBadge({ m }) {
  return (
    <span className="badge bg-light text-dark border badge-soft">
      <i className={`bi bi-${payIcon[m] || 'cash'} me-1`}></i>{(m || '').toUpperCase()}
    </span>
  );
}

export function StatusBadge({ s }) {
  const map = { completed: 'success', held: 'warning text-dark', returned: 'secondary', void: 'danger', paid: 'success', partial: 'warning text-dark', pending: 'danger' };
  return <span className={`badge bg-${map[s] || 'secondary'} badge-soft text-capitalize`}>{s}</span>;
}

export function RoleBadge({ role }) {
  const map = { admin: 'danger', manager: 'warning text-dark', cashier: 'success' };
  return <span className={`badge bg-${map[role] || 'secondary'} badge-soft text-capitalize`}>{role}</span>;
}

/* ---------- Avatars ---------- */
export function Avatar({ name, size = 40 }) {
  const i = (name || '?').charCodeAt(0) % AV_COLORS.length;
  const initials = String(name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="avatar-tile" style={{ background: AV_COLORS[i], width: size, height: size, borderRadius: size >= 38 ? 9 : '50%', fontSize: size * 0.32 }}>
      {initials}
    </div>
  );
}

export function UserTile({ u, size = 30 }) {
  const c = u.avatar_color || AV_COLORS[(u.name || 'U').charCodeAt(0) % AV_COLORS.length];
  const init = String(u.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span style={{ display: 'inline-flex', width: size, height: size, borderRadius: '50%', background: c, color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 600, flex: 'none' }}>
      {init}
    </span>
  );
}

/* ---------- Empty state ---------- */
export function Empty({ icon = 'inbox', text = 'Nothing here yet', colSpan }) {
  return colSpan ? (
    <tr><td colSpan={colSpan}><div className="empty-state"><i className={`bi bi-${icon} d-block`}></i>{text}</div></td></tr>
  ) : (
    <div className="empty-state"><i className={`bi bi-${icon} d-block`}></i>{text}</div>
  );
}

/* ---------- Page loading splash ---------- */
export function Loading() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status"></div>
    </div>
  );
}
