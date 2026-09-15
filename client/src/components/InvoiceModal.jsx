import { useEffect, useState } from 'react';
import { api, receiptHTML, printInvoice, hasRole } from '../api';
import { useApp } from '../context/AppContext';
import { Modal } from './ui';

/* Receipt viewer with Print + (manager+) Return — pass saleId, onClose, onChanged */
export default function InvoiceModal({ saleId, onClose, onChanged }) {
  const { me, toast } = useApp();
  const [sale, setSale] = useState(null);

  useEffect(() => {
    if (!saleId) return;
    api(`/api/sales/${saleId}`).then(setSale).catch(e => { toast(e.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const doReturn = async () => {
    if (!window.confirm(`Return invoice ${sale.invoice_no}? Items will be restocked.`)) return;
    try {
      await api(`/api/sales/${saleId}/return`, { method: 'PUT' });
      toast('Invoice returned, stock restored');
      onClose(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal show={!!saleId} onClose={onClose} title={<>Invoice {sale?.invoice_no}</>}
      footer={<>
        {sale && hasRole(me, 'manager') && sale.status === 'completed' && (
          <button className="btn btn-outline-danger btn-sm me-auto" onClick={doReturn}>
            <i className="bi bi-arrow-return-left me-1"></i>Return</button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => printInvoice(saleId)}>
          <i className="bi bi-printer me-1"></i>Print</button>
      </>}>
      {sale && <div className="d-flex justify-content-center bg-light rounded p-3" dangerouslySetInnerHTML={{ __html: receiptHTML(sale) }} />}
    </Modal>
  );
}
