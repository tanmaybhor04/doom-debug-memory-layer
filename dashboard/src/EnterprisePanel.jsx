import React, { useEffect, useState } from 'react';
import {
  getEnterpriseOverview,
  updateEnterprisePlan,
  addTeamSeat,
  removeTeamSeat,
  generateEnterpriseKey,
  revokeEnterpriseKey,
} from './api';

const DEFAULT_ENTERPRISE_STATE = {
  plan: 'free',
  workspace_name: 'Core Engineering Workspace',
  strict_pii_lock: true,
  usage: {
    current_rules: 4,
    max_rules: 3,
    seats_used: 2,
    seats_limit: 1,
    total_pii_redactions: 2,
  },
  members: [
    { id: 1, name: 'Workspace Admin', email: 'admin@doom-layer.dev', role: 'Owner', status: 'Active' },
    { id: 2, name: 'Backend Lead', email: 'backend@doom-layer.dev', role: 'Admin', status: 'Active' },
  ],
  api_keys: [],
};

const TIERS = [
  {
    id: 'free',
    name: 'Freemium Starter',
    price: '₹0 / mo',
    numericPrice: 0,
    badge: 'INDIVIDUAL',
    maxRules: 3,
    seatsLimit: 1,
    features: ['Up to 3 Active Memory Rules', 'Local SQLite Context Store', 'Standard PII Regex Scrubbing'],
  },
  {
    id: 'pro',
    name: 'Individual Pro',
    price: '₹999 / mo',
    numericPrice: 999,
    badge: 'PRO SUBSCRIPTION',
    maxRules: 999,
    seatsLimit: 1,
    features: ['Unlimited Memory Rules', 'Cross-LLM Auto-Injection (4 Platforms)', 'Priority Context Token Compression'],
  },
  {
    id: 'team',
    name: 'Team Workspace',
    price: '₹2,499 / seat',
    numericPrice: 2499,
    perSeat: true,
    badge: 'PER-SEAT PLAN',
    maxRules: 999,
    seatsLimit: 10,
    features: ['Up to 10 Shared Team Seats', 'Role-Based Access Control (RBAC)', 'Shared Project Context Sync'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Governance',
    price: '₹39,999 / mo',
    numericPrice: 39999,
    badge: 'API + COMPLIANCE',
    maxRules: 9999,
    seatsLimit: 100,
    features: ['100 Seats + Programmatic API Keys', 'Zero-Trust PII Redaction Enforcement', 'Full SOC2 / Compliance Audit Stream'],
  },
];

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

export default function EnterprisePanel() {
  const [data, setData] = useState(DEFAULT_ENTERPRISE_STATE);
  const [seatName, setSeatName] = useState('');
  const [seatEmail, setSeatEmail] = useState('');
  const [seatRole, setSeatRole] = useState('Developer');
  const [keyLabel, setKeyLabel] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // Payment Checkout Modal State
  const [checkoutTier, setCheckoutTier] = useState(null);
  const [billingEmail, setBillingEmail] = useState('billing@doom-layer.dev');
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [cardExpiry, setCardExpiry] = useState('12 / 29');
  const [cardCvc, setCardCvc] = useState('842');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        if (typeof getEnterpriseOverview === 'function') {
          const res = await getEnterpriseOverview();
          if (res && !res.error && res.usage) {
            setData(res);
          }
        }
      } catch (e) {
        console.warn('Using local enterprise fallback state:', e);
      }
    })();
  }, []);

  const applyPlanUpgrade = async (planId) => {
    const tierObj = TIERS.find((t) => t.id === planId) || TIERS[0];
    setData((prev) => ({
      ...prev,
      plan: planId,
      usage: {
        ...prev.usage,
        max_rules: tierObj.maxRules,
        seats_limit: tierObj.seatsLimit,
      },
    }));

    if (typeof updateEnterprisePlan === 'function') {
      const updated = await updateEnterprisePlan({ plan: planId });
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const handlePlanButtonClick = (tier) => {
    if (tier.numericPrice === 0) {
      applyPlanUpgrade(tier.id);
    } else {
      setCheckoutTier(tier);
    }
  };

  const handleConfirmPayment = async (e) => {
    e.preventDefault();
    if (!checkoutTier) return;
    setProcessingPayment(true);

    // Simulate realistic payment gateway authorization delay
    await new Promise((r) => setTimeout(r, 1100));

    const totalCharged = checkoutTier.perSeat
      ? checkoutTier.numericPrice * Math.max(1, data.usage.seats_used)
      : checkoutTier.numericPrice;

    await applyPlanUpgrade(checkoutTier.id);

    setLastReceipt({
      txId: `pay_inr_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      planName: checkoutTier.name,
      amount: `${formatINR(totalCharged)} INR`,
    });

    setProcessingPayment(false);
    setCheckoutTier(null);
  };

  const handleToggleLock = async () => {
    const nextLock = !data.strict_pii_lock;
    setData((prev) => ({ ...prev, strict_pii_lock: nextLock }));
    if (typeof updateEnterprisePlan === 'function') {
      const updated = await updateEnterprisePlan({
        plan: data.plan,
        strict_pii_lock: nextLock,
      });
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const handleAddSeat = async (e) => {
    e.preventDefault();
    if (!seatName.trim() || !seatEmail.trim()) return;
    const newMember = {
      id: Date.now(),
      name: seatName.trim(),
      email: seatEmail.trim(),
      role: seatRole,
      status: 'Active',
    };
    setData((prev) => ({
      ...prev,
      members: [...prev.members, newMember],
      usage: { ...prev.usage, seats_used: prev.members.length + 1 },
    }));
    setSeatName('');
    setSeatEmail('');

    if (typeof addTeamSeat === 'function') {
      const updated = await addTeamSeat({ name: newMember.name, email: newMember.email, role: newMember.role });
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const handleRemoveSeat = async (id) => {
    setData((prev) => {
      const nextMembers = prev.members.filter((m) => m.id !== id);
      return {
        ...prev,
        members: nextMembers,
        usage: { ...prev.usage, seats_used: nextMembers.length },
      };
    });
    if (typeof removeTeamSeat === 'function') {
      const updated = await removeTeamSeat(id);
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!keyLabel.trim()) return;
    const randomHex = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const localKey = {
      id: Date.now(),
      label: keyLabel.trim(),
      api_key: `doom_ent_${randomHex}`,
      scope: 'read:context,write:audit',
    };
    setData((prev) => ({
      ...prev,
      api_keys: [localKey, ...prev.api_keys],
    }));
    setKeyLabel('');

    if (typeof generateEnterpriseKey === 'function') {
      const updated = await generateEnterpriseKey({ label: localKey.label });
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const handleRevokeKey = async (id) => {
    setData((prev) => ({
      ...prev,
      api_keys: prev.api_keys.filter((k) => k.id !== id),
    }));
    if (typeof revokeEnterpriseKey === 'function') {
      const updated = await revokeEnterpriseKey(id);
      if (updated && !updated.error && updated.usage) setData(updated);
    }
  };

  const checkoutTotal = checkoutTier
    ? checkoutTier.perSeat
      ? checkoutTier.numericPrice * Math.max(1, data.usage.seats_used)
      : checkoutTier.numericPrice
    : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-4 text-slate-100 relative">
      {/* Payment Receipt Banner */}
      {lastReceipt && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/50 backdrop-blur-md px-5 py-3 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-3 text-emerald-300">
            <span className="text-base">💳</span>
            <span>
              Payment Verified ({lastReceipt.txId}) — Upgraded to <strong>{lastReceipt.planName}</strong> ({lastReceipt.amount}/mo)
            </span>
          </div>
          <button onClick={() => setLastReceipt(null)} className="text-emerald-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Top Status Banner */}
      <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/70 backdrop-blur-md p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-cyan-400">
            ● WORKSPACE GOVERNANCE & REVENUE ENGINE
          </div>
          <h2 className="text-xl font-bold mt-1">{data.workspace_name}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Active Tier: <span className="text-cyan-300 font-mono uppercase">{data.plan}</span> · Rules Quota:{' '}
            <span className="text-emerald-400 font-mono">
              {data.usage.current_rules} / {data.usage.max_rules >= 999 ? '∞' : data.usage.max_rules}
            </span>{' '}
            · Seats: <span className="text-purple-300 font-mono">{data.usage.seats_used} / {data.usage.seats_limit}</span>
          </p>
        </div>

        <button
          onClick={handleToggleLock}
          className={`px-4 py-2 rounded-xl font-mono text-xs border transition ${
            data.strict_pii_lock
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
              : 'bg-amber-950/70 border-amber-500/50 text-amber-300'
          }`}
        >
          {data.strict_pii_lock ? '🔒 Strict PII Governance: ENFORCED' : '⚠ Strict PII Governance: BYPASSED'}
        </button>
      </div>

      {/* 1. Freemium / Pro / Team / Enterprise Tier Switcher */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {TIERS.map((tier) => {
          const isCurrent = data.plan === tier.id;
          return (
            <div
              key={tier.id}
              className={`rounded-2xl p-5 border backdrop-blur-md flex flex-col justify-between transition ${
                isCurrent
                  ? 'border-cyan-400 bg-cyan-950/25 shadow-lg shadow-cyan-500/10'
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
              }`}
            >
              <div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                  {tier.badge}
                </span>
                <h3 className="text-base font-bold mt-2">{tier.name}</h3>
                <div className="text-2xl font-extrabold text-cyan-400 mt-1">{tier.price}</div>
                <ul className="mt-4 space-y-2 text-xs text-slate-300">
                  {tier.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-cyan-400">✓</span> <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => handlePlanButtonClick(tier)}
                disabled={isCurrent}
                className={`mt-5 w-full py-2.5 rounded-xl font-mono text-xs font-semibold transition ${
                  isCurrent
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 cursor-default'
                    : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                }`}
              >
                {isCurrent
                  ? '● ACTIVE PLAN'
                  : tier.numericPrice === 0
                  ? 'Downgrade to Free'
                  : `Upgrade · ${tier.price}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Bento Grid: Team Seat Workspace + Enterprise API Licensing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 2. Per-Seat Team Workspace Management */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-purple-300">
                👥 Team Workspace Seats (RBAC)
              </h3>
              <p className="text-xs text-slate-400">
                Share project memory rules across engineering & consulting teams.
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-500/40 text-purple-300">
              {data.usage.seats_used} / {data.usage.seats_limit} seats
            </span>
          </div>

          <form onSubmit={handleAddSeat} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Member name"
              value={seatName}
              onChange={(e) => setSeatName(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:border-cyan-500 outline-none"
            />
            <input
              type="email"
              placeholder="dev@company.com"
              value={seatEmail}
              onChange={(e) => setSeatEmail(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:border-cyan-500 outline-none"
            />
            <div className="flex gap-2">
              <select
                value={seatRole}
                onChange={(e) => setSeatRole(e.target.value)}
                className="flex-1 px-2 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs"
              >
                <option>Developer</option>
                <option>Admin</option>
                <option>Auditor</option>
              </select>
              <button
                type="submit"
                className="px-3 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 font-mono text-xs font-bold"
              >
                + Seat
              </button>
            </div>
          </form>

          <div className="space-y-2 max-h-52 overflow-y-auto">
            {data.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-200">{m.name}</span>{' '}
                  <span className="text-slate-400 font-mono">({m.email})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">
                    {m.role}
                  </span>
                  {m.role !== 'Owner' && (
                    <button
                      onClick={() => handleRemoveSeat(m.id)}
                      className="text-rose-400 hover:text-rose-300 font-mono text-[11px]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Enterprise API & Security Governance Licensing */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-300">
                🔑 Enterprise API & Governance Keys
              </h3>
              <p className="text-xs text-slate-400">
                Issue programmatic bearer tokens for CI/CD, IDE plugins & internal enterprise wrappers.
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
              {data.usage.total_pii_redactions} PII Blocked
            </span>
          </div>

          <form onSubmit={handleCreateKey} className="flex gap-2">
            <input
              type="text"
              placeholder="e.g., Production CI/CD Context Key"
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:border-cyan-500 outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold"
            >
              + Issue API Key
            </button>
          </form>

          <div className="space-y-2 max-h-52 overflow-y-auto">
            {data.api_keys.length === 0 ? (
              <div className="text-xs text-slate-500 font-mono py-4 text-center">
                No active Enterprise API keys issued yet.
              </div>
            ) : (
              data.api_keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-200">{k.label}</div>
                    <div className="font-mono text-[11px] text-cyan-400">{k.api_key}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(k.api_key);
                        setCopiedId(k.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px]"
                    >
                      {copiedId === k.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleRevokeKey(k.id)}
                      className="text-rose-400 hover:text-rose-300 font-mono text-[11px]"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── RAZORPAY / STRIPE INDIA PAYMENT CHECKOUT MODAL ─────────────────── */}
      {checkoutTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
                  🔒 DOOM BILLING // RAZORPAY & STRIPE SANDBOX (INR)
                </span>
                <h3 className="text-lg font-bold mt-1">Upgrade to {checkoutTier.name}</h3>
              </div>
              <button
                onClick={() => !processingPayment && setCheckoutTier(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Order Summary */}
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 flex items-center justify-between text-xs font-mono">
              <div>
                <div className="text-slate-300 font-bold">{checkoutTier.name}</div>
                <div className="text-slate-500 mt-0.5">
                  {checkoutTier.perSeat
                    ? `${formatINR(checkoutTier.numericPrice)}/seat × ${Math.max(1, data.usage.seats_used)} active seats`
                    : 'Monthly SaaS Subscription (INR)'}
                </div>
              </div>
              <div className="text-lg font-extrabold text-cyan-400">
                {formatINR(checkoutTotal)}
              </div>
            </div>

            {/* Payment Form */}
            <form onSubmit={handleConfirmPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-mono text-[10px] uppercase text-slate-400 mb-1">
                  Billing Email
                </label>
                <input
                  type="email"
                  required
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:border-cyan-500 outline-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase text-slate-400 mb-1">
                  Card Information (Test Mode)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    required
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="col-span-2 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:border-cyan-500 outline-none"
                  />
                  <input
                    type="text"
                    required
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    className="px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:border-cyan-500 outline-none"
                  />
                  <input
                    type="text"
                    required
                    value={cardCvc}
                    onChange={(e) => setCardCvc(e.target.value)}
                    className="px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-slate-200 focus:border-cyan-500 outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={() => setCheckoutTier(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-mono hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingPayment}
                  className="flex-2 w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold shadow-lg shadow-cyan-500/20"
                >
                  {processingPayment
                    ? '⟳ Authorizing Payment...'
                    : `Pay ${formatINR(checkoutTotal)} & Activate`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}