const API = "http://localhost:8000";
const GEMINI_MODEL = "gemini-2.5-flash"; // change here if Google renames the model

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
  const turns = (body.turns || []).slice(-30).map((t) => {
    const r = redact(t.text);
    redactions += r.count;
    return { role: t.role, text: r.text.slice(0, 3000) };
  });
  // signature of this chat; if it matches what's already stored, keep the
  // old snapshot (and its "used" flag) so the same chat isn't handed off twice
  const last = turns[turns.length - 1];
  const sig =
    body.site + ":" + turns.length + ":" + (last ? last.text.slice(-80) : "");
  const { snapshot: old } = await chrome.storage.local.get("snapshot");
  if (old && old.sig === sig) return { saved: 0, redactions };

  await chrome.storage.local.set({
    snapshot: { site: body.site, ts: Date.now(), turns, sig },
  });
  return { saved: turns.length, redactions };
}

// ---------- SUMMARY ----------
const STOP = new Set(
  "the and for that with this you your are was have has not but can will from they their what when which how about would could should there been into also just like than then them these those some any more very".split(
    " "
  )
);

function splitSentences(t) {
  return t
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 400);
}

// Fallback used when Gemini fails (no key, no internet, bad response).
// Extractive: picks the most important existing sentences.
function localSummary(turns) {
  const prior = turns.filter((t) => t.role === "ctx").map((t) => t.text).join(" ");
  const users = turns.filter((t) => t.role === "user");
  const ais = turns.filter((t) => t.role === "ai");

  const freq = {};
  for (const t of turns)
    for (const w of tokens(t.text))
      if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;

  const scored = ais
    .flatMap((t) => splitSentences(t.text))
    .map((s, i) => {
      const w = tokens(s).filter((x) => !STOP.has(x));
      const score =
        w.reduce((a, x) => a + (freq[x] || 0), 0) / Math.sqrt(w.length || 1);
      return { s, i, score };
    });
  const keyPoints = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s.slice(0, 220));

  const lines = [];
  if (prior) lines.push("Earlier context: " + prior.slice(0, 300));
  if (users[0]) lines.push("Topic / goal: " + users[0].text.slice(0, 250));
  if (users.length > 2) {
    const asked = users
      .slice(1, -1)
      .slice(-3)
      .map((u) => "- " + u.text.slice(0, 120));
    lines.push("Other things I asked:\n" + asked.join("\n"));
  }
  if (keyPoints.length)
    lines.push(
      "Key points from the AI:\n" + keyPoints.map((k) => "- " + k).join("\n")
    );
  if (users.length > 1)
    lines.push("My latest question: " + users[users.length - 1].text.slice(0, 250));
  return lines.join("\n\n");
}

async function geminiSummary(turns) {
  const { geminiKey } = await chrome.storage.local.get("geminiKey");
  if (!geminiKey) throw new Error("no key");

  const convo = turns
    .map((t) => (t.role === "ctx" ? "earlier context" : t.role) + ": " + t.text)
    .join("\n");
  const prompt =
    "Summarize this chat so another AI can continue it. Include: the user's goal, " +
    "key facts and decisions, what has been answered, and what is still open. " +
    "Write it from the user's point of view where natural. " +
    "Cover the whole conversation, not just the end. " +
    "Under 250 words, plain text, no preamble.\n\n" +
    convo;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        GEMINI_MODEL +
        ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: ctrl.signal,
      }
    );
    if (!r.ok) throw new Error("gemini status " + r.status);
    const d = await r.json();
    const summary = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!summary) throw new Error("empty");
    return summary;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- MESSAGE ROUTER ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.path === "/snapshot") {
      sendResponse({ ok: true, data: await saveSnapshot(msg.body), via: "local" });
      return;
    }

    if (msg.path === "/summarize") {
      // redact BEFORE anything leaves the browser
      // "ctx" turns are older handoffs pasted into this chat; leave them out
      // so the summary only covers the chat you actually just had
      const turns = (msg.body.turns || [])
        .filter((t) => t.role !== "ctx")
        .map((t) => ({
          role: t.role,
          text: redact(t.text).text,
        }));
      try {
        const summary = await geminiSummary(turns);
        sendResponse({ ok: true, data: { summary }, via: "gemini" });
      } catch (e) {
        console.warn("Gemini summary failed, using local:", e);
        sendResponse({
          ok: true,
          data: { summary: localSummary(turns) },
          via: "local",
        });
      }
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