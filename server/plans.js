// ---------------- SaaS subscription plans ----------------
// products/users: null = unlimited
const PLANS = {
  trial: { key: 'trial', name: 'Free Trial', price: 0, users: 5, products: null, reports: true, trialDays: 14,
    tagline: '14 days. Every Pro feature. No card required.' },
  starter: { key: 'starter', name: 'Starter', price: 499, users: 2, products: 200, reports: false,
    tagline: 'For a single counter shop getting started.' },
  pro: { key: 'pro', name: 'Pro', price: 999, users: 5, products: null, reports: true,
    tagline: 'Full power: unlimited products, reports & GST.' }
};
module.exports = { PLANS };
