import { useApp } from '../context/AppContext';

const icons = { success: 'check-circle-fill', error: 'x-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };

export function ToastHost() {
  const { toasts } = useApp();
  return (
    <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 2000 }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast show align-items-center border-0 ${t.type === 'error' ? 'text-bg-danger' : t.type === 'warning' ? 'text-bg-warning' : t.type === 'info' ? 'text-bg-info' : 'text-bg-success'}`} role="alert">
          <div className="d-flex">
            <div className="toast-body"><i className={`bi bi-${icons[t.type] || icons.info} me-2`}></i>{t.msg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
