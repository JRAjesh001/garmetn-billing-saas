// ---------------------------------------------------------------
// Razorpay gateway helper (no SDK dependency — plain REST + HMAC).
// Configure with env vars to accept real payments:
//   RAZORPAY_KEY_ID      rzp_test_xxx / rzp_live_xxx
//   RAZORPAY_KEY_SECRET  matching secret
// Without keys the app runs in "demo" mode: orders are simulated
// and activated instantly so the full flow stays testable.
// ---------------------------------------------------------------
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

function configured() { return Boolean(KEY_ID && KEY_SECRET); }
function keyId() { return KEY_ID; }

// Create a Razorpay order. amountPaise is in paise (₹1 = 100).
async function createOrder({ amountPaise, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `Razorpay error (HTTP ${res.status})`;
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }
  return data; // { id, amount, currency, status, ... }
}

// Standard Razorpay checkout signature: HMAC_SHA256(secret, order_id|payment_id)
function verifySignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { configured, keyId, createOrder, verifySignature };
