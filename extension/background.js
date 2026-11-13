const API = "http://localhost:8000";

const PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,                                   // API keys
  /AKIA[0-9A-Z]{16}/g,                                        // AWS keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g,                              // GitHub tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,                                // emails
  /\b\d{10}\b/g,                                              // phone numbers
  /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

function redact(text) {
  let count = 0;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, () => { count++; return "[REDACTED]"; });
  }
  return { text: out, count };
}

function tokens(s) {
  return s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

async function getStore() {
  const { memories = [] } = await chrome.storage.local.get("memories");
  return memories;
}

async function localSave(body) {
  const memories = await getStore();
  const r = redact(body.text);
  if (memories.some((m) => m.text === r.text)) return { id: 0, redactions: r.count };
  const item = {
    id: Date.now(), text: r.text.slice(0, 300), source: body.source,
    workspace: body.workspace, ts: Date.now(),
  };
  memories.push(item);
  await chrome.storage.local.set({ memories: memories.slice(-200) });
  return { id: item.id, redactions: r.count };
}

async function localContext(body) {
  const memories = (await getStore()).filter((m) => m.workspace === body.workspace);
  const q = new Set(tokens(body.prompt || ""));
  const ranked = memories
    .map((m) => ({ m, score: tokens(m.text).filter((w) => q.has(w)).length }))
    .sort((a, b) => b.score - a.score || b.m.ts - a.m.ts);
  const top = ranked.slice(0, 3).map((x) => x.m.text.slice(0, 200));
  if (!top.length) return { context: "", redactions: 0 };
  const r = redact("Context about me:\n- " + top.join("\n- "));
  return { context: r.text, redactions: r.count };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
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
      const data = msg.path === "/memories"
        ? await localSave(msg.body)
        : await localContext(msg.body);
      sendResponse({ ok: true, data, via: "local" });
    }
  })();
  return true;
});