/**
 * background.js — DOOM Memory Layer (Manifest V3 Service Worker)
 *
 * Handles ALL network calls so that content scripts avoid mixed-content
 * (HTTPS page → HTTP localhost) issues. The service worker is exempt from
 * CORS when the URL is listed in host_permissions.
 */

const API_URL   = 'http://localhost:8000';     // change to your ngrok URL for demos
const API_TOKEN = 'local-dev-token';                           // paste token here if API_TOKEN is set in backend/.env

// ── cache: last successful context block per platform ──────────────────────
const CACHE_TTL_MS = 30_000; // 30s — re-fetch if stale
const cache = {};             // { [platform]: { ts, data } }

// ── utility ────────────────────────────────────────────────────────────────
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_TOKEN) h['Authorization'] = `Bearer ${API_TOKEN}`;
  return h;
}

async function fetchContext(payload) {
  const key = payload.platform;
  const now = Date.now();

  // Return cached result if fresh and conversation is not new
  if (!payload.conversation_is_new && cache[key] && now - cache[key].ts < CACHE_TTL_MS) {
    return { ...cache[key].data, fromCache: true };
  }

  const r = await fetch(`${API_URL}/context/resolve`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify(payload),
  });

  if (!r.ok) throw new Error(`Backend ${r.status}: ${r.statusText}`);
  const data = await r.json();

  if (data.injected) {
    cache[key] = { ts: now, data };
    // persist for offline fallback
    chrome.storage.local.set({ [`lastContext_${key}`]: data });
  }
  return data;
}

// ── message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'RESOLVE_CONTEXT') {
    fetchContext(msg.payload)
      .then(sendResponse)
      .catch(async (err) => {
        console.warn('[DOOM background] backend unreachable, trying offline cache:', err.message);
        const key = `lastContext_${msg.payload.platform}`;
        const stored = await chrome.storage.local.get(key);
        const offline = stored[key];
        sendResponse(offline
          ? { ...offline, offline: true }
          : { injected: false, reason: 'backend_offline', context_block: '' }
        );
      });
    return true; // keep message channel open for async reply
  }

  if (msg.type === 'PING_BACKEND') {
    fetch(`${API_URL}/health`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => sendResponse({ ok: true, memories: d.memories }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
