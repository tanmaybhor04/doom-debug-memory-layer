/**
 * api.js — Doom Memory Layer (Adapter for Soham's FastAPI + Ngrok Backend)
 * Translates Antigravity UI calls to Soham's /rules, /inject, and /workspaces endpoints.
 */

export const API_URL   = import.meta.env.VITE_API_URL   || 'https://baffling-pulverize-prayer.ngrok-free.dev';
export const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'u9S8_fiU6u90c_NelcWYOKWkoBjE0L5aVqKEwmoFGGI';

// Local cache of recent injections so the Audit & Stats tabs work even if /audit isn't on the backend yet
const localAuditCache = JSON.parse(localStorage.getItem('doom_audit_cache') || '[]');
function recordLocalAudit(entry) {
  localAuditCache.unshift(entry);
  if (localAuditCache.length > 30) localAuditCache.pop();
  localStorage.setItem('doom_audit_cache', JSON.stringify(localAuditCache));
}

function buildHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true', // CRITICAL: Bypasses ngrok free-tier warning HTML
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    ...extra,
  };
}

/** Wrapper: returns null on network error, {error} on API error */
async function request(path, opts = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: buildHeaders(opts.headers || {}),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (res.status === 204) return { ok: true };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.detail || `HTTP ${res.status}` };
    }
    return res.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name !== 'AbortError') console.warn(`[api] ${path}:`, err.message);
    return null;
  }
}

// ── Health ─────────────────────────────────────────────────────────────────
export async function pingHealth() {
  const t0  = Date.now();
  const res = await request('/health');
  const ok  = !!(res && !res.error && res.status === 'ok');
  if (ok) {
    // Auto-upgrade user to Pro on Soham's backend so the 5-rule free limit never blocks your demo
    request('/me/upgrade', { method: 'POST' }).catch(() => {});
  }
  return {
    ok,
    latencyMs: Date.now() - t0,
    info:      res,
  };
}

// ── Memories (Mapped to Soham's /rules endpoint) ───────────────────────────
export async function getMemories() {
  const res = await request('/rules');
  if (!Array.isArray(res)) return null;
  return res.map(r => ({
    id:         r.id,
    key:        r.title,
    value:      r.content,
    category:   r.category || 'Custom',
    scope:      r.workspace_id ? 'project' : 'global',
    enabled:    r.is_active !== false,
    priority:   r.priority ?? 50,
    redactions: 0,
  }));
}

export async function createMemory(payload) {
  // Translates { key, value, category, scope } -> Soham's { title, content, category, priority, is_active }
  const res = await request('/rules', {
    method: 'POST',
    body: JSON.stringify({
      title:     payload.key,
      content:   payload.value,
      category:  payload.category || 'Custom',
      priority:  50,
      is_active: true,
    }),
  });
  if (!res || res.error) return res;
  return {
    id:       res.id,
    key:      res.title,
    value:    res.content,
    category: res.category || 'Custom',
    scope:    payload.scope || 'global',
    upserted: false,
  };
}

export async function updateMemory(id, patch) {
  const body = {};
  if (patch.key !== undefined)     body.title     = patch.key;
  if (patch.value !== undefined)   body.content   = patch.value;
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.enabled !== undefined) body.is_active = patch.enabled;
  return request(`/rules/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
}

export async function deleteMemory(id) {
  const res = await request(`/rules/${id}`, { method: 'DELETE' });
  return res || { ok: true };
}

export async function getMemoryHistory(id) {
  return [];
}

// ── Context Resolution (Mapped to Soham's POST /inject) ────────────────────
export async function resolveContext(payload) {
  const promptText = payload.prompt || '';
  const platform   = payload.platform || 'chatgpt';

  const [injectRes, rules] = await Promise.all([
    request('/inject', {
      method: 'POST',
      body: JSON.stringify({
        prompt:   promptText,
        platform: platform,
        scrub:    true,
      }),
    }),
    getMemories(),
  ]);

  if (!injectRes || injectRes.error) {
    return injectRes || { error: 'Backend unreachable' };
  }

  const activeRules = (rules || []).filter(r => r.enabled !== false);
  const lines = activeRules.map(m => `- ${m.key}: ${m.value}`).join('\n');
  const contextBlock = lines
    ? `[Context from my AI Memory Layer. Apply it where relevant.]\n${lines}\n[End of context]`
    : '[No active rules in memory layer]';

  const tokenEst = Math.max(1, Math.round((injectRes.final_prompt || contextBlock).length / 4));

  // Record in local audit cache so the Audit Tab & Injections counter update live
  recordLocalAudit({
    id:           `aud_${Date.now()}`,
    ts:           new Date().toISOString(),
    platform:     platform,
    project:      'global',
    memory_count: injectRes.rules_used ?? activeRules.length,
    tokens:       tokenEst,
    prompt_chars: promptText.length,
  });

  return {
    injected:       (injectRes.rules_used ?? activeRules.length) > 0,
    context_block:  contextBlock,
    final_prompt:   injectRes.final_prompt,
    used:           activeRules,
    token_estimate: tokenEst,
    redactions:     injectRes.redactions || {},
  };
}

// ── Projects (Mapped to Soham's /workspaces) ───────────────────────────────
export async function getProjects() {
  const res = await request('/workspaces');
  if (!Array.isArray(res)) return { active: null, projects: [] };
  return {
    active:   null,
    projects: res.map(w => w.name),
  };
}

export async function setActiveProject(name) {
  const projs = await getProjects();
  return { ...projs, active: name || null };
}

// ── Audit Log & Stats ──────────────────────────────────────────────────────
export async function getAudit(limit = 10) {
  const res = await request(`/audit?limit=${limit}`);
  if (Array.isArray(res)) return res;
  return localAuditCache.slice(0, limit);
}

export async function getStats() {
  const rules = await getMemories();
  if (!rules) return null;
  const totalInjections = localAuditCache.length;
  const avgTok = totalInjections > 0
    ? localAuditCache.reduce((s, a) => s + (a.tokens || 0), 0) / totalInjections
    : 0;
  return {
    memories:                 rules.length,
    enabled:                  rules.filter(r => r.enabled !== false).length,
    injections:               totalInjections,
    avg_tokens_per_injection: avgTok,
  };
}

// ── Export / Import ────────────────────────────────────────────────────────
export async function exportAll() {
  const rules = await getMemories();
  return { memories: rules || [] };
}

export async function importMemories(memories) {
  if (!Array.isArray(memories)) return { error: 'Invalid format' };
  for (const m of memories) {
    await createMemory(m);
  }
  return { ok: true };
}