// ---------- API + formatting helpers (shared across the React app) ----------

const API_URL = import.meta.env.VITE_API_URL || "";

export async function api(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    credentials: "include",
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !["/api/login", "/api/signup"].includes(path)) {
    const pub = ["/", "/login", "/signup", "/platform"];

    if (!pub.includes(window.location.pathname)) {
      window.location.href = "/login";
    }

    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export const inrFmt = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});
export const money = (n) => "₹" + inrFmt.format(Number(n || 0));
export const num = (n) => inrFmt.format(Number(n || 0));
export const fmtDate = (s) =>
  s
    ? new Date(s).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
export const fmtDateTime = (s) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return (
    d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
    ", " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  );
};
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const monthStartStr = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

export const RANK = { cashier: 1, manager: 2, admin: 3 };
export const hasRole = (me, min) =>
  !!me && (RANK[me.role] || 0) >= (RANK[min] || 0);

// Download rows as a CSV file (Excel-friendly: UTF-8 BOM, quoted cells).
// `rows` = array of arrays; first row is the header.
export function downloadCSV(filename, rows) {
  const csv =
    "\uFEFF" +
    rows
      .map((r) =>
        r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const AV_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#334155",
  "#f97316",
];

// ---------- Receipt (same 80mm thermal layout as before) ----------
export function receiptHTML(s) {
  const shop = s.shop || {};
  const lines = s.items
    .map(
      (it) => `
    <tr><td colspan="3" style="padding-top:3px">${it.product_name}</td></tr>
    <tr>
      <td style="width:34px">${it.qty} x</td>
      <td>${inrFmt.format(it.price)}${it.discount > 0 ? ` (-${inrFmt.format(it.discount)})` : ""}</td>
      <td style="text-align:right">${inrFmt.format(it.amount - it.tax_amount)}</td>
    </tr>`,
    )
    .join("");
  return `<div class="receipt">
    <div style="text-align:center">
      <h5 style="margin:0;font-weight:700">${shop.shop_name || "Shop"}</h5>
      ${shop.tagline ? `<div>${shop.tagline}</div>` : ""}
      <div style="font-size:11px">${shop.address || ""}</div>
      <div>Ph: ${shop.phone || ""}${shop.gstin ? ` | GSTIN: ${shop.gstin}` : ""}</div>
    </div>
    <hr>
    <div class="rl"><span>Invoice: ${s.invoice_no}</span><span>${fmtDateTime(s.sale_date)}</span></div>
    <div class="rl"><span>Customer: ${s.customer || "Walk-in Customer"}</span><span></span></div>
    <hr>
    <table>
      <thead><tr style="border-bottom:1px dashed #555"><th style="text-align:left">Item</th><th></th><th style="text-align:right">Amt</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <hr>
    <div class="rl"><span>Subtotal</span><span>${inrFmt.format(s.subtotal)}</span></div>
    ${s.discount > 0 ? `<div class="rl"><span>Discount</span><span>-${inrFmt.format(s.discount)}</span></div>` : ""}
    <div class="rl"><span>CGST</span><span>${inrFmt.format(s.tax_amount / 2)}</span></div>
    <div class="rl"><span>SGST</span><span>${inrFmt.format(s.tax_amount / 2)}</span></div>
    <div class="rl" style="font-weight:700;font-size:15px;border-top:1px dashed #555;padding-top:4px;margin-top:4px"><span>TOTAL</span><span>₹${inrFmt.format(s.total)}</span></div>
    <div class="rl"><span>Paid (${(s.payment_method || "").toUpperCase()})</span><span>${inrFmt.format(s.paid_amount)}</span></div>
    ${s.change_amount > 0 ? `<div class="rl"><span>Change</span><span>${inrFmt.format(s.change_amount)}</span></div>` : ""}
    ${s.status === "returned" ? '<div style="text-align:center;font-weight:700">*** RETURNED ***</div>' : ""}
    <hr>
    <div style="text-align:center;font-size:11px">${shop.receipt_footer || "Thank you! Visit again."}</div>
    <div style="text-align:center;margin-top:6px;font-size:14px">••••••••••••••••••••••</div>
  </div>`;
}

export async function printInvoice(id) {
  const sale = await api(`/api/sales/${id}`);
  const el = document.getElementById("printArea");
  el.innerHTML = receiptHTML(sale);
  window.print();
}
