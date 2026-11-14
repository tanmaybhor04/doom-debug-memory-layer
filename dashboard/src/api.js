/**
 * api.js — DOOM Memory Layer (Local Mode)
 */

// Ensure there is NO trailing slash at the end of this URL
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const API_TOKEN = 'local-dev-token';

function buildHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    ...extra,
  };
}

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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.detail || `Not Found (${res.status}) - check endpoint path` };
    }
    return res.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name !== 'AbortError') console.warn(`[api] ${path}:`, err.message);
    return null;
  }
}

export async function pingHealth() {
  const t0  = Date.now();
  const res = await request('/health');
  return {
    ok:        !!(res && !res.error && res.status === 'ok'),
    latencyMs: Date.now() - t0,
    info:      res,
  };
}

export async function getMemories() {
  const res = await request('/memories');
  return Array.isArray(res) ? res : null;
}

export async function createMemory(payload) {
  return request('/memories', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
}

export async function updateMemory(id, patch) {
  return request(`/memories/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(patch),
  });
}

export async function deleteMemory(id) {
  return request(`/memories/${id}`, { method: 'DELETE' });
}

export async function getMemoryHistory(id) {
  return request(`/memories/${id}/history`);
}

export async function resolveContext(payload) {
  return request('/context/resolve', {
    method: 'POST',
    body:   JSON.stringify({
      prompt:              '',
      platform:            'unknown',
      conversation_is_new: true,
      force:               false,
      dry_run:             false,
      ...payload,
    }),
  });
}

export async function getProjects() {
  return request('/projects');
}

export async function setActiveProject(name) {
  return request('/projects/active', {
    method: 'PUT',
    body:   JSON.stringify({ name: name ?? null }),
  });
}

export async function getAudit(limit = 10) {
  return request(`/audit?limit=${limit}`);
}

export async function getStats() {
  return request('/stats');
}
export async function getEnterpriseOverview() {
  return request('/enterprise/overview');
}

export async function updateEnterprisePlan(payload) {
  return request('/enterprise/plan', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function addTeamSeat(payload) {
  return request('/enterprise/seats', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function removeTeamSeat(id) {
  return request(`/enterprise/seats/${id}`, { method: 'DELETE' });
}

export async function generateEnterpriseKey(payload) {
  return request('/enterprise/keys', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function revokeEnterpriseKey(id) {
  return request(`/enterprise/keys/${id}`, { method: 'DELETE' });
}