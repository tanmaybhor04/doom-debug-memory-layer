import React, { useState, useEffect, useCallback, useRef } from 'react';
import MemoryVisualizer from './MemoryVisualizer';
import EnterprisePanel from './EnterprisePanel';
import {
  pingHealth, getMemories, createMemory, deleteMemory,
  getAudit, getStats, getProjects, setActiveProject, resolveContext,
} from './api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CATEGORIES = ['Standard', 'Architecture', 'Preference', 'Profile', 'Custom'];
const PLATFORMS  = [
  { id: 'chatgpt',  label: 'ChatGPT',  icon: '🤖', color: 'from-emerald-500 to-teal-600' },
  { id: 'claude',   label: 'Claude',   icon: '🧠', color: 'from-orange-500 to-amber-600' },
  { id: 'gemini',   label: 'Gemini',   icon: '✨', color: 'from-blue-500 to-indigo-600'  },
  { id: 'copilot',  label: 'Copilot',  icon: '🪁', color: 'from-violet-500 to-purple-600'},
];

const CATEGORY_DOT = {
  Standard:     'bg-cyan-400',
  Architecture: 'bg-violet-400',
  Preference:   'bg-emerald-400',
  Profile:      'bg-amber-400',
  Custom:       'bg-blue-400',
};

const DEMO_SEEDS = [
  { id: '__d1', key: 'Preferred Stack',   value: 'React 19, Tailwind CSS, Python FastAPI, SQLite',  category: 'Architecture', scope: 'global' },
  { id: '__d2', key: 'Coding Standard',   value: 'Always use functional components. No class components. Use TypeScript types.',  category: 'Standard',  scope: 'global' },
  { id: '__d3', key: 'Response Format',   value: 'Give concise bullet points first, then detailed explanation if asked.',       category: 'Preference', scope: 'global' },
  { id: '__d4', key: 'Hardware Target',   value: 'ESP32 C++ firmware. Optimize for memory. Use FreeRTOS primitives.',           category: 'Profile',   scope: 'global' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fc = 'w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/70 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-200 font-mono';
const card = (extra = '') => `bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-800/60 shadow-2xl ${extra}`;

function timeAgo(ts) {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="fixed top-20 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-mono shadow-2xl backdrop-blur-xl transition-all duration-300 pointer-events-auto
            ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-700 text-emerald-300' :
              t.type === 'error'   ? 'bg-red-950/90     border-red-700     text-red-300' :
                                     'bg-cyan-950/90    border-cyan-700    text-cyan-300'}`}
        >
          <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : '◎'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'text-cyan-400' }) {
  return (
    <div className={card('p-4 text-center group hover:border-slate-700 transition-all')}>
      <p className="text-[9px] font-mono text-slate-600 tracking-[0.2em] uppercase mb-2">{label}</p>
      <p className={`text-3xl font-black font-mono leading-none ${color} group-hover:scale-105 transition-transform`}>{value ?? '—'}</p>
      {sub && <p className="text-[9px] font-mono text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

// ─── HOW IT WORKS BANNER ──────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { n: '01', icon: '📝', title: 'You define your rules', desc: 'Add your stack, preferences, and coding standards once in the dashboard.' },
    { n: '02', icon: '🧠', title: 'Brain stores them', desc: 'Rules saved to our backend with smart relevance scoring & secret redaction.' },
    { n: '03', icon: '🔌', title: 'Extension watches', desc: 'The Chrome extension silently watches ChatGPT, Claude, Gemini & Copilot.' },
    { n: '04', icon: '⚡', title: 'Auto-injects on send', desc: 'On every new conversation, your context is prepended automatically — invisible to the AI, but it reads it.' },
  ];
  return (
    <div className={card('p-6 mb-6 relative overflow-hidden')}>
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-violet-500/5 pointer-events-none" />
      <h2 className="text-xs font-mono uppercase tracking-[0.25em] text-slate-500 mb-5">How It Works</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {steps.map((s, i) => (
          <div key={i} className="relative">
            {i < steps.length - 1 && (
              <div className="hidden md:block absolute top-5 left-full w-full h-px bg-gradient-to-r from-cyan-800/50 to-transparent z-10" />
            )}
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className="text-[9px] font-mono text-cyan-600 mb-1 tracking-widest">STEP {s.n}</div>
            <div className="text-xs font-bold text-slate-300 mb-1">{s.title}</div>
            <div className="text-[11px] text-slate-500 leading-relaxed">{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const { toasts, push } = useToast();

  // form
  const [memKey,    setMemKey]    = useState('');
  const [memVal,    setMemVal]    = useState('');
  const [category,  setCategory]  = useState('Custom');
  const [scope,     setScope]     = useState('global');
  const [submitting, setSubmitting] = useState(false);

  // data
  const [memories,  setMemories]  = useState(DEMO_SEEDS);
  const [audit,     setAudit]     = useState([]);
  const [stats,     setStats]     = useState(null);
  const [projects,  setProjects]  = useState({ active: null, projects: [] });

  // connection
  const [online,    setOnline]    = useState(false);
  const [latency,   setLatency]   = useState(null);
  const [firstLoad, setFirstLoad] = useState(true);

  // UI
  const [tab,       setTab]       = useState('dashboard');
  const [search,    setSearch]    = useState('');
  const [platform,  setPlatform]  = useState('chatgpt');

  // preview
  const [prompt,    setPrompt]    = useState('Fix this memory leak in my C++ IoT firmware');
  const [preview,   setPreview]   = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const refreshRef = useRef(false);

  // ── Sync with backend ──────────────────────────────────────────────────────
  const refresh = useCallback(async (quiet = false) => {
    if (refreshRef.current) return;
    refreshRef.current = true;
    try {
      const ping = await pingHealth();
      setOnline(ping.ok);
      setLatency(ping.ok ? ping.latencyMs : null);

      if (ping.ok) {
        const [mems, log, st, proj] = await Promise.all([
          getMemories(),
          getAudit(8),
          getStats(),
          getProjects(),
        ]);
        if (Array.isArray(mems))    setMemories(mems);
        if (Array.isArray(log))     setAudit(log);
        if (st && !st.error)        setStats(st);
        if (proj && !proj.error)    setProjects(proj);
        if (firstLoad && !quiet)    push('Connected to backend ✓', 'success');
      } else if (firstLoad) {
        push('Backend offline — showing demo data', 'info');
      }
    } finally {
      refreshRef.current = false;
      setFirstLoad(false);
    }
  }, [firstLoad, push]);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const id = setInterval(() => refresh(true), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // ── Add memory ─────────────────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!memKey.trim() || !memVal.trim()) {
      push('Fill in both fields', 'error'); return;
    }
    setSubmitting(true);
    const payload = { key: memKey.trim(), value: memVal.trim(), category, scope };
    if (online) {
      const res = await createMemory(payload);
      if (!res || res.error) {
        push(res?.error || 'Save failed — is backend running?', 'error');
      } else {
        push(res.upserted ? 'Rule updated (old value kept in history)' : 'Rule committed ✓', 'success');
        if (res.redacted && Object.values(res.redacted).some(v => v > 0))
          push('⚠ Sensitive data was auto-redacted before saving', 'info');
        await refresh(true);
        setMemKey(''); setMemVal('');
      }
    } else {
      setMemories(p => [{ id: `local_${Date.now()}`, ...payload, _local: true }, ...p]);
      push('Saved locally — syncs when backend reconnects', 'info');
      setMemKey(''); setMemVal('');
    }
    setSubmitting(false);
  };

  // ── Delete memory ──────────────────────────────────────────────────────────
  const handleDelete = async (mem) => {
    if (typeof mem.id === 'string' && (mem.id.startsWith('local_') || mem.id.startsWith('__'))) {
      setMemories(p => p.filter(m => m.id !== mem.id));
      return;
    }
    if (!online) { push('Cannot delete — backend offline', 'error'); return; }
    const res = await deleteMemory(mem.id);
    if (!res || res.error) { push('Delete failed', 'error'); return; }
    push('Rule purged', 'info');
    setMemories(p => p.filter(m => m.id !== mem.id));
  };

  // ── Preview injection ──────────────────────────────────────────────────────
  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    if (online) {
      const res = await resolveContext({
        prompt,
        platform,
        conversation_is_new: true,
        force:   true,
        dry_run: true,
      });
      setPreview(res?.error ? { error: res.error } : res);
    } else {
      // offline simulation
      const lines = memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
      const block = `[Context from my AI Memory Layer. Apply it where relevant.]\n${lines}\n[End of context]`;
      setPreview({
        injected: true, simulated: true,
        context_block: block,
        used: memories,
        token_estimate: Math.round(block.length / 4),
      });
    }
    setPreviewing(false);
  };

  // ── Project switch ─────────────────────────────────────────────────────────
  const handleProjectChange = async (val) => {
    const res = await setActiveProject(val || null);
    if (res && !res.error) setProjects(res);
  };

  const filtered = memories.filter(m =>
    m.key?.toLowerCase().includes(search.toLowerCase()) ||
    m.value?.toLowerCase().includes(search.toLowerCase())
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#020810] text-slate-100 font-sans">
      {/* Grid overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 0%, rgba(14,165,233,0.12) 0%, transparent 60%),
            linear-gradient(rgba(14,165,233,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(14,165,233,0.03) 1px, transparent 1px)`,
          backgroundSize: 'auto, 56px 56px, 56px 56px',
        }}
      />

      <Toast toasts={toasts} />

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#020810]/80 backdrop-blur-xl px-6 flex items-stretch justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3 py-4">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping opacity-50" />
          </div>
          <span className="font-black text-sm md:text-base tracking-[0.15em] bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-500 bg-clip-text text-transparent select-none">
            DOOM // MEMORY_LAYER v1.0
          </span>
        </div>

        {/* Tabs */}
        <div className="hidden md:flex items-stretch gap-0.5">
          {[
            { id: 'dashboard',  label: '◎ Dashboard'  },
            { id: 'preview',    label: '▶ Injector'   },
            { id: 'audit',      label: '⬡ Audit'      },
            { id: 'enterprise', label: '💎 ENTERPRISE' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 text-[11px] font-mono uppercase tracking-widest border-b-2 transition-all duration-200 ${
                tab === t.id
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-600 hover:text-slate-400 hover:border-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-2 py-4">
          <span className={`text-[10px] font-mono px-3 py-1 rounded-full border transition-all ${
            online
              ? 'border-cyan-800/60 text-cyan-400 bg-cyan-950/40'
              : 'border-amber-800/60 text-amber-400 bg-amber-950/40 animate-pulse'
          }`}>
            {online ? '● ONLINE' : '◌ OFFLINE'}
          </span>
          {latency != null && (
            <span className="hidden md:block text-[10px] font-mono px-2 py-1 rounded-full border border-slate-800 text-slate-500">
              {latency}ms
            </span>
          )}
        </div>
      </nav>

      {/* ── DASHBOARD TAB ───────────────────────────────────────────────── */}
      {tab === 'dashboard' && (
        <main className="max-w-screen-xl mx-auto px-4 md:px-6 pt-6 pb-20 space-y-6">
          <HowItWorks />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT */}
            <div className="lg:col-span-5 space-y-5">

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Total Rules" value={memories.filter(m => !m.id?.toString().startsWith('__')).length || memories.length} color="text-cyan-400" />
                <StatCard label="Injections"  value={stats?.injections ?? (online ? 0 : '—')} color="text-emerald-400" />
                <StatCard label="Platforms"   value={4} sub="ChatGPT+3" color="text-violet-400" />
              </div>

              {/* Inject Rule Form */}
              <div className={card('p-6 relative overflow-hidden')}>
                <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500" />
                <div className="absolute top-0 inset-x-0 h-20 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />

                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                    <span className="text-lg">⬡</span>
                    Inject Context Rule
                  </h2>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                    online ? 'border-cyan-900 text-cyan-600 bg-cyan-950/40' : 'border-amber-900 text-amber-600 bg-amber-950/40'
                  }`}>
                    {online ? 'SECURE_WRITE' : 'LOCAL_ONLY'}
                  </span>
                </div>

                <form onSubmit={handleAdd} className="space-y-4">
                  <div>
                    <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">
                      Context Key
                    </label>
                    <input
                      type="text" value={memKey} onChange={e => setMemKey(e.target.value)}
                      placeholder="e.g., preferred_language"
                      className={fc}
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">
                      Instructions / Payload
                    </label>
                    <textarea
                      value={memVal} onChange={e => setMemVal(e.target.value)}
                      placeholder="Always use Python 3.11+. Never use global state. Prefer async/await..."
                      rows={3}
                      className={`${fc} resize-none`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">Category</label>
                      <select value={category} onChange={e => setCategory(e.target.value)} className={fc}>
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">Scope</label>
                      <select value={scope} onChange={e => setScope(e.target.value)} className={fc}>
                        <option value="global">🌐 Global</option>
                        <option value="project">📁 Project</option>
                      </select>
                    </div>
                  </div>

                  {/* Project selector (backend projects) */}
                  {projects.projects.length > 0 && (
                    <div>
                      <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">Active Project</label>
                      <select
                        value={projects.active || ''}
                        onChange={e => handleProjectChange(e.target.value)}
                        className={fc}
                        disabled={!online}
                      >
                        <option value="">(none — global rules only)</option>
                        {projects.projects.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="relative w-full overflow-hidden rounded-xl py-3 font-bold text-sm text-white transition-all active:scale-[0.98] disabled:opacity-60 group"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-600 group-hover:from-cyan-400 group-hover:to-blue-500 transition-all" />
                    <div className="absolute inset-0 shadow-[0_0_30px_rgba(6,182,212,0.4)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span className="relative flex items-center justify-center gap-2">
                      {submitting ? (
                        <><span className="animate-spin">◎</span> Committing…</>
                      ) : (
                        <><span>⬡</span> Commit to Neural Store</>
                      )}
                    </span>
                  </button>
                </form>
              </div>

              {/* Platform quick-links */}
              <div className={card('p-5')}>
                <h3 className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-4">Supported Platforms</h3>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORMS.map(p => (
                    <a
                      key={p.id}
                      href={
                        p.id === 'chatgpt' ? 'https://chatgpt.com' :
                        p.id === 'claude'  ? 'https://claude.ai'   :
                        p.id === 'gemini'  ? 'https://gemini.google.com' :
                                             'https://copilot.microsoft.com'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r ${p.color} bg-opacity-10 border border-white/5 hover:border-white/10 hover:scale-[1.02] transition-all text-xs font-medium`}
                    >
                      <span className="text-base">{p.icon}</span>
                      <span>{p.label}</span>
                      <span className="ml-auto text-[9px] opacity-60">↗</span>
                    </a>
                  ))}
                </div>
                <p className="text-[10px] font-mono text-slate-600 mt-3 text-center">
                  Extension auto-injects your rules into all 4 platforms
                </p>
              </div>
            </div>

            {/* RIGHT */}
            <div className="lg:col-span-7 space-y-5">

              {/* Cross-AI Portability Handoff Card */}
              <div className={card('p-5 relative overflow-hidden')}>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 pointer-events-none" />
                
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                    <span>⚡</span> Seamless Cross-AI Portability
                  </h2>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900 text-emerald-500 animate-pulse">
                    HANDOFF ACTIVE
                  </span>
                </div>
                
                <p className="text-[11px] text-slate-400 mb-4 leading-relaxed font-mono">
                  Rate limit reached? The extension automatically summarizes your current conversation and queues it for the next AI agent.
                </p>

                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">
                        Limit Reached On
                      </label>
                      <select className={fc} defaultValue="gemini">
                        <option value="gemini">Gemini (Google)</option>
                        <option value="claude">Claude 3.5 Sonnet</option>
                        <option value="chatgpt">ChatGPT-4o</option>
                      </select>
                    </div>
                    
                    <div className="text-slate-500 mt-5 font-bold">→</div>
                    
                    <div className="flex-1">
                      <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">
                        Auto-Shift Target
                      </label>
                      <select className={fc} defaultValue="chatgpt">
                        <option value="chatgpt">ChatGPT-4o</option>
                        <option value="claude">Claude 3.5 Sonnet</option>
                        <option value="copilot">Copilot</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3D Visualizer */}
              <div className={card('p-5')}>
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                    <span>◎</span> Spatial Context Cluster
                  </h2>
                  <div className="flex items-center gap-2 text-[9px] font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-cyan-600">WebGL · Three.js</span>
                  </div>
                </div>
                <MemoryVisualizer memories={memories} />
              </div>

              {/* Memory Registry */}
              <div className={card('p-5')}>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                    <span>▦</span> Active Memory Registry
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-slate-600 bg-slate-900/60 border border-slate-800 px-2 py-0.5 rounded">
                      {filtered.length}/{memories.length}
                    </span>
                    <input
                      type="text" placeholder="⌕ filter…" value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="bg-slate-950/80 border border-slate-800 text-[11px] rounded-lg px-3 py-1.5 text-slate-300 placeholder-slate-700 focus:outline-none focus:border-cyan-800 font-mono w-32"
                    />
                  </div>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {filtered.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-slate-600 font-mono text-sm">No matching rules</p>
                    </div>
                  ) : filtered.map(mem => (
                    <div
                      key={mem.id}
                      className="group flex items-start gap-3 bg-slate-950/60 border border-slate-800/60 hover:border-cyan-900/60 rounded-xl px-4 py-3 transition-all duration-200"
                    >
                      <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${CATEGORY_DOT[mem.category] || 'bg-slate-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="font-bold font-mono text-xs text-slate-200">{mem.key}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-500 uppercase">
                            {mem.category}
                          </span>
                          {mem.scope === 'project' && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-950/60 border border-violet-900 text-violet-500 uppercase">
                              {mem.project || 'project'}
                            </span>
                          )}
                          {mem.redactions > 0 && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-900 text-amber-500">
                              🔒 redacted
                            </span>
                          )}
                          {mem._local && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-950/60 border border-orange-900 text-orange-500">
                              local
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono leading-relaxed line-clamp-2">{mem.value}</p>
                      </div>
                      <button
                        onClick={() => handleDelete(mem)}
                        className="opacity-0 group-hover:opacity-100 text-[9px] font-mono text-slate-700 hover:text-red-400 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg transition-all flex-shrink-0"
                      >
                        PURGE
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </main>
      )}

      {/* ── INJECTOR PREVIEW TAB ───────────────────────────────────────────── */}
      {tab === 'preview' && (
        <main className="max-w-3xl mx-auto px-4 pt-8 pb-20 space-y-5">
          {/* Explainer */}
          <div className={card('p-6 relative overflow-hidden')}>
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 pointer-events-none" />
            <h2 className="text-sm font-bold text-cyan-300 mb-2 flex items-center gap-2">
              <span>▶</span> Injection Simulator
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              This shows <strong className="text-slate-400">exactly</strong> what your Chrome extension prepends to your prompt before it reaches the AI.
              The AI reads this hidden context block first — then your actual prompt.
            </p>
          </div>

          {/* Platform Selector */}
          <div className={card('p-5')}>
            <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-3">Target Platform</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    platform === p.id
                      ? `bg-gradient-to-r ${p.color} border-transparent text-white shadow-lg`
                      : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                  }`}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt input */}
          <div className={card('p-5')}>
            <label className="block text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">Your Raw Prompt (before injection)</label>
            <textarea
              value={prompt} onChange={e => setPrompt(e.target.value)}
              rows={3}
              placeholder="Fix this memory leak..."
              className={`${fc} resize-none`}
            />
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="mt-4 w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-500 to-blue-600 hover:from-violet-400 hover:to-blue-500 text-white shadow-[0_0_30px_rgba(139,92,246,0.3)] transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {previewing ? <><span className="animate-spin">◎</span> Simulating…</> : <><span>▶</span> Simulate Injection for {PLATFORMS.find(p => p.id === platform)?.label}</>}
            </button>
          </div>

          {/* Result */}
          {preview && (
            <div className={card('p-5 space-y-4')}>
              {preview.error ? (
                <p className="text-red-400 font-mono text-sm flex items-center gap-2"><span>✗</span>{preview.error}</p>
              ) : preview.injected ? (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
                    <span className="text-emerald-400 text-xl">✓</span>
                    <div>
                      <p className="text-sm font-bold text-emerald-300">Context will be injected</p>
                      <p className="text-[10px] font-mono text-emerald-600 mt-0.5">
                        {preview.used?.length} rules · ~{preview.token_estimate} tokens
                        {preview.simulated && ' · offline simulation'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500 mb-2">
                      What {PLATFORMS.find(p => p.id === platform)?.label} actually receives:
                    </p>
                    <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                      {/* injected block */}
                      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/40">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-mono text-slate-600 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">INJECTED CONTEXT (hidden prefix)</span>
                        </div>
                        <pre className="text-[11px] font-mono text-slate-500 whitespace-pre-wrap leading-relaxed">{preview.context_block}</pre>
                      </div>
                      {/* actual prompt */}
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-mono text-cyan-600 bg-cyan-950/40 border border-cyan-900 px-2 py-0.5 rounded">YOUR ACTUAL PROMPT</span>
                        </div>
                        <p className="text-sm font-mono text-slate-200">{prompt}</p>
                      </div>
                    </div>
                  </div>

                  {preview.used?.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-slate-600 mb-2">Rules included:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.used.map(m => (
                          <span key={m.id} className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${CATEGORY_DOT[m.category]?.replace('bg-', 'border-').replace('-400', '-800') || 'border-slate-700'} text-slate-400 bg-slate-900`}>
                            {m.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-slate-500 font-mono text-sm">Nothing would be injected: {preview.reason}</p>
              )}
            </div>
          )}
        </main>
      )}

      {/* ── AUDIT TAB ──────────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <main className="max-w-3xl mx-auto px-4 pt-8 pb-20 space-y-5">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Rules"  value={stats.memories}         color="text-cyan-400" />
              <StatCard label="Active"       value={stats.enabled}          color="text-emerald-400" />
              <StatCard label="Injections"   value={stats.injections}       color="text-blue-400" />
              <StatCard label="Avg Tokens"   value={Math.round(stats.avg_tokens_per_injection || 0)} sub="per injection" color="text-violet-400" />
            </div>
          )}

          <div className={card('p-5')}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xs font-bold text-cyan-300 flex items-center gap-2"><span>⬡</span> Injection Audit Log</h2>
              <span className="text-[9px] font-mono text-slate-700 border border-slate-800 px-2 py-0.5 rounded">[PROMPT TEXT NEVER STORED]</span>
            </div>

            {!online ? (
              <div className="text-center py-10 space-y-2">
                <p className="text-slate-600 font-mono text-sm">Backend offline</p>
                <p className="text-slate-700 text-xs">Start the backend to see injection history</p>
              </div>
            ) : audit.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <p className="text-3xl mb-3">🔌</p>
                <p className="text-slate-500 font-mono text-sm">No injections logged yet</p>
                <p className="text-slate-700 text-xs">Load the Chrome extension → open ChatGPT → start a new chat</p>
              </div>
            ) : (
              <div className="space-y-2">
                {audit.map(a => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-[11px] font-mono hover:border-slate-700 transition-all">
                    <span className="text-slate-600">{timeAgo(a.ts)}</span>
                    <span className="text-cyan-400 font-bold uppercase">{a.platform}</span>
                    <span className="text-violet-400">{a.project || 'global'}</span>
                    <span className="ml-auto text-emerald-400">{a.memory_count} rules</span>
                    <span className="text-slate-600">~{a.tokens} tok</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-slate-600">{a.prompt_chars} chars</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Backend connect guide */}
          {!online && (
            <div className={card('p-5 border-amber-900/40')}>
              <h3 className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2">⚠ Backend not running</h3>
              <div className="space-y-2">
                <div className="bg-slate-950/80 rounded-xl p-3 font-mono text-xs text-slate-300 border border-slate-800">
                  <p className="text-slate-600 text-[9px] mb-1"># Terminal 1 — Start backend</p>
                  <p className="text-cyan-400">cd "C:\Users\santo\Desktop\Duplicate DOOM\doom-backend-wiring\backend"</p>
                  <p className="text-cyan-400">start_backend.bat</p>
                </div>
                <div className="bg-slate-950/80 rounded-xl p-3 font-mono text-xs text-slate-300 border border-slate-800">
                  <p className="text-slate-600 text-[9px] mb-1"># Or manually with Python</p>
                  <p className="text-cyan-400">C:\Users\santo\AppData\Local\Programs\Python\Python312\python.exe -m uvicorn main:app --reload --port 8000</p>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* ── ENTERPRISE TAB ─────────────────────────────────────────────────── */}
      {tab === 'enterprise' && (
        <main className="max-w-screen-xl mx-auto px-4 md:px-6 pt-6 pb-20">
          <EnterprisePanel />
        </main>
      )}

      {/* Fixed bottom mobile tabs */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-[#020810]/90 backdrop-blur-xl border-t border-slate-800 flex">
        {[
          { id: 'dashboard',  icon: '◎', label: 'Dashboard'  },
          { id: 'preview',    icon: '▶', label: 'Preview'    },
          { id: 'audit',      icon: '⬡', label: 'Audit'      },
          { id: 'enterprise', icon: '💎', label: 'Enterprise' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 text-xs font-mono flex flex-col items-center gap-0.5 transition-all ${
              tab === t.id ? 'text-cyan-400' : 'text-slate-700'
            }`}
          >
            <span className="text-sm">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}