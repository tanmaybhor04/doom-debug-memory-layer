const API = "http://localhost:8000";

// ---------- REDACTION ----------
const PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g, // API keys
  /AKIA[0-9A-Z]{16}/g, // AWS keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // emails
  /\b\d{10}\b/g, // phone numbers
  /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

function redact(text) {
  let count = 0;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return "[REDACTED]";
    });
  }
  return { text: out, count };
}

function tokens(s) {
  return s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

// ---------- LOCAL STORE ----------
async function getStore() {
  const { memories = [] } = await chrome.storage.local.get("memories");
  return memories;
}

async function localSave(body) {
  const memories = await getStore();
  const r = redact(body.text);
  if (memories.some((m) => m.text === r.text && m.workspace === body.workspace)) {
    return { id: 0, redactions: r.count };
  }
  const item = {
    id: Date.now(),
    text: r.text.slice(0, 300),
    workspace: body.workspace,
    source: body.source,
    ts: Date.now(),
  };
  memories.push(item);
  await chrome.storage.local.set({ memories: memories.slice(-200) });
  return { id: item.id, redactions: r.count };
}

async function localContext(body) {
  const p = (body.prompt || "").toLowerCase();
  const memories = (await getStore()).filter(
    (m) => m.workspace === body.workspace && !p.includes(m.text.toLowerCase())
  );
  const q = new Set(tokens(body.prompt || ""));
  const ranked = memories
    .map((m) => ({ m, score: tokens(m.text).filter((w) => q.has(w)).length }))
    .sort((a, b) => b.score - a.score || b.m.ts - a.m.ts);
  const top = ranked.slice(0, 3).map((x) => x.m.text.slice(0, 200));
  if (!top.length) return { context: "", redactions: 0 };
  const r = redact("Context about me:\n- " + top.join("\n- "));
  return { context: r.text, redactions: r.count };
}

// ---------- CHAT SNAPSHOT ----------
async function saveSnapshot(body) {
  let redactions = 0;
  const turns = (body.turns || []).slice(-10).map((t) => { // FIX: was -4
    const r = redact(t.text);
    redactions += r.count;
    return { role: t.role, text: r.text.slice(0, 2000) }; // FIX: was 300
  });
  await chrome.storage.local.set({
    snapshot: { site: body.site, ts: Date.now(), turns },
  });
  return { saved: turns.length, redactions };
}

// ---------- MESSAGE ROUTER ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.path === "/snapshot") {
      sendResponse({ ok: true, data: await saveSnapshot(msg.body), via: "local" });
      return;
    }

    const { workspace = "personal" } = await chrome.storage.local.get("workspace");
    msg.body.workspace = workspace;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(API + msg.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error("bad status");
      sendResponse({ ok: true, data: await r.json(), via: "api" });
    } catch (e) {
      const data =
        msg.path === "/memories"
          ? await localSave(msg.body)
          : await localContext(msg.body);
      sendResponse({ ok: true, data, via: "local" });
    }
  })();
  return true;
});