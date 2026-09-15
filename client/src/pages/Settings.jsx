import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../context/AppContext";

const FIELDS = [
  "shop_name",
  "tagline",
  "address",
  "phone",
  "email",
  "gstin",
  "receipt_footer",
];
const LABELS = {
  shop_name: ["Shop Name", true],
  tagline: ["Tagline"],
  address: ["Address"],
  phone: ["Phone"],
  email: ["Email"],
  gstin: ["GSTIN"],
  receipt_footer: ["Receipt Footer Message"],
};

export default function Settings() {
  const { me, toast, setShop } = useApp();
  const isAdmin = me.role === "admin";
  const [form, setForm] = useState({});

  useEffect(() => {
    api("/api/settings").then(setForm);
  }, []);

  const save = async () => {
    try {
      await api("/api/settings", { method: "PUT", body: form });
      setShop(form);
      toast("Settings saved");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="row g-3">
      <div className="col-lg-7">
        <div className="card">
          <div className="card-header">
            <i className="bi bi-shop me-2 text-primary"></i> Shop Details{" "}
            <span className="small text-muted fw-normal">
              (printed on receipts)
            </span>
          </div>
          <div className="card-body">
            <div className="row g-3">
              {FIELDS.map((f) => (
                <div
                  key={f}
                  className={
                    f === "shop_name" || f === "tagline" ? "col-md-6" : "col-12"
                  }
                >
                  <label
                    className={`form-label ${LABELS[f][1] ? "required" : ""}`}
                  >
                    {LABELS[f][0]}
                  </label>
                  {f === "address" || f === "receipt_footer" ? (
                    <textarea
                      className="form-control form-control-sm"
                      rows="2"
                      value={form[f] || ""}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setForm({ ...form, [f]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      className="form-control form-control-sm"
                      value={form[f] || ""}
                      disabled={!isAdmin || f === "email"}
                      onChange={(e) =>
                        setForm({ ...form, [f]: e.target.value })
                      }
                    />
                  )}
                  {f === "email" && (
                    <div
                      className="form-text mt-1"
                      style={{ fontSize: ".7rem" }}
                    >
                      Owner login — cannot be changed
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* GST / tax switch */}
            {/* <div className="d-flex align-items-center justify-content-between border rounded p-3 mt-3">
              <div>
                <div className="fw-semibold"><i className="bi bi-receipt-cutoff me-1 text-primary"></i>GST billing</div>
                <div className="small text-muted">When OFF, new invoices are created without charging GST (product tax rates are kept for later).</div>
              </div>
              <div className="form-check form-switch m-0">
                <input className="form-check-input" type="checkbox" role="switch" style={{ width: '2.6em', height: '1.3em' }}
                  disabled={!isAdmin} checked={form.gst_enabled === undefined ? true : !!form.gst_enabled}
                  onChange={e => setForm({ ...form, gst_enabled: e.target.checked ? 1 : 0 })} />
                <div className="small mt-1 fw-semibold text-center" style={{ minWidth: 44 }}>
                  {form.gst_enabled === undefined || !!form.gst_enabled
                    ? <span className="text-success">ON</span> : <span className="text-danger">OFF</span>}
                </div>
              </div>
            </div> */}

            {isAdmin ? (
              <button className="btn btn-primary btn-sm mt-3" onClick={save}>
                <i className="bi bi-check2 me-1"></i>Save Settings
              </button>
            ) : (
              <div className="alert alert-warning small py-2 mt-3 mb-0">
                <i className="bi bi-shield-lock me-1"></i>Only <b>admin</b> can
                modify shop settings.
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="col-lg-5">
        <div className="card">
          <div className="card-header">
            <i className="bi bi-info-circle me-2 text-primary"></i> About this
            System
          </div>
          <div className="card-body small">
            <p className="mb-2">
              <b>Garment Billing System v2.0</b> — React + Express.js + MySQL.
            </p>
            <ul className="mb-2">
              <li>POS billing with barcode scanner &amp; search</li>
              <li>Purchase &amp; sale complete cycle with stock impact</li>
              <li>Stock management with adjustments &amp; valuation</li>
              <li>
                Products with Category, Size, Color, SKU, Barcode, Qty, MRP,
                Sale Price, GST
              </li>
              <li>
                Dashboard, Reports, GST summary, Receipt printing (80&nbsp;mm)
              </li>
              <li>Role-based login: Admin / Manager / Cashier</li>
            </ul>
            <p className="text-muted mb-0">
              Database: <code>garment_billing</code> (MySQL). Sample data loads
              automatically on first run.
            </p>
          </div>
        </div>
        <div className="card mt-3">
          <div className="card-header">
            <i className="bi bi-database me-2 text-primary"></i> Database
          </div>
          <div className="card-body small text-muted">
            Tip: to reset the demo, drop the <code>garment_billing</code>{" "}
            database in MySQL and restart the server — schema and sample data
            are re-created automatically.
          </div>
        </div>
      </div>
    </div>
  );
}
