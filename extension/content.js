console.log("Memory Layer loaded");

// ---------- SELECTORS ----------
const USER_SEL = [
  '[data-testid="user-message"]', // Claude
  '[data-message-author-role="user"]', // ChatGPT (older layout)
  '[class*="bg-user-message"]', // ChatGPT (your layout)
  "user-query", // Gemini
].join(",");

const AI_SEL = [
  ".standard-markdown", // Claude
  '[data-message-author-role="assistant"]', // ChatGPT (older layout)
  '[data-markdown-text-style*="assistant"]', // ChatGPT (your layout)
  "model-response", // Gemini
].join(",");

const HANDOFF_MARK = "Continuing a conversation from";

// ---------- HELPERS ----------
function getEditor() {
  return document.querySelector(
    '#prompt-textarea, div[contenteditable="true"], textarea'
  );
}

function injectText(text) {
  const el = getEditor();
  if (!el) return alert("Chat box not found");
  const current = el.value ?? el.innerText;
  if (current.includes(text)) return console.log("Already injected");
  el.focus();
  if (el.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    ).set;
    setter.call(el, text + "\n\n" + el.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text + "\n\n" + current);
  }
}

function callApi(path, body) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) {
        return resolve({ ok: false, error: "Extension reloaded, refresh the page" });
      }
      chrome.runtime.sendMessage({ path, body }, (res) =>
        resolve(res || { ok: false, error: "No response" })
      );
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function getUserMessages() {
  return [...document.querySelectorAll(USER_SEL)]
    .map((e) => e.innerText.trim())
    .filter(Boolean);
}

function toast(msg) {
  document.getElementById("ml-toast")?.remove();
  const d = document.createElement("div");
  d.id = "ml-toast";
  d.textContent = msg;
  d.style.cssText =
    "position:fixed;bottom:70px;right:20px;z-index:999999;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;max-width:300px";
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}

function badge(n) {
  return n > 0
    ? `🔒 ${n} sensitive item${n > 1 ? "s" : ""} hidden from memory. `
    : "";
}

// ---------- AUTO MODE ----------
const FACT_RE =
  /\b(i am|i'm|im|my|we are|we're|our|using|building|working on|prefer|project|stack|need|want|use|learning|studying|live|work)\b/i;
const REQUEST_RE =
  /[,;.]?\s*\b(help me|can you|could you|please|how do|how can|how to|what is|why|write me|give me|explain|tell me)\b.*$/i;

function extractFact(text) {
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  return parts
    .map((s) => s.replace(REQUEST_RE, "").trim().replace(/[,;.]$/, ""))
    .filter((s) => s.length >= 15 && FACT_RE.test(s))
    .join(". ");
}

let injectedUrl = null;
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    injectedUrl = null;
  }
}, 1000);

async function captureMemory(text) {
  const fact = extractFact(text);
  if (!fact) return 0;
  const res = await callApi("/memories", {
    text: fact,
    source: location.hostname,
    workspace: "personal", // background.js swaps in the popup's workspace
  });
  return res?.data?.redactions || 0;
}

document.addEventListener(
  "keydown",
  async (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const el = getEditor();
    if (!el || !(e.target === el || el.contains(e.target))) return;
    const text = (el.value ?? el.innerText).trim();
    if (!text) return;

    // already has injected context or handoff: let it send
    if (text.includes("Context about me:") || text.includes(HANDOFF_MARK)) {
      injectedUrl = null;
      return;
    }

    // not the first message: only save facts
    if (injectedUrl === location.href || getUserMessages().length > 0) {
      captureMemory(text).then((n) => {
        if (n > 0) toast(badge(n).trim());
      });
      return;
    }

    // first message of a new chat: inject memory, user presses Enter again
    e.preventDefault();
    e.stopImmediatePropagation();
    injectedUrl = location.href;
    const [n, res] = await Promise.all([
      captureMemory(text),
      callApi("/context", { prompt: text, workspace: "personal" }),
    ]);
    const ctx = res && res.ok && res.data && res.data.context;
    if (ctx) {
      injectText(ctx);
      toast(badge(n) + "Memory added. Press Enter to send");
    } else {
      toast(badge(n) + "No memory yet. Press Enter to send");
    }
  },
  true
);

// ---------- BUTTON ACTIONS ----------
async function onSave() {
  const selected = window.getSelection().toString().trim();
  const msgs = getUserMessages();
  const text = selected || msgs[msgs.length - 1];
  if (!text) return alert("Nothing to save");
  const res = await callApi("/memories", {
    text,
    source: location.hostname,
    workspace: "personal",
  });
  console.log("Save result:", res);
  const n = res?.data?.redactions || 0;
  toast(badge(n) + "Saved to memory");
}

async function onInject() {
  const el = getEditor();
  const prompt = el ? el.value ?? el.innerText : "";
  const res = await Promise.race([
    callApi("/context", { prompt, workspace: "personal" }),
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  const ctx = res && res.ok && res.data && res.data.context;
  if (ctx) {
    injectText(ctx);
    toast("Memory added. Press Enter to send");
  } else {
    toast("No memory yet");
  }
}

// ---------- WIDGET ----------
function createWidget() {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:999999;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      button { background:#6d28d9; color:#fff; border:none; border-radius:10px; padding:10px 14px; cursor:pointer; font:600 13px sans-serif; margin-left:6px; }
      button:hover { background:#5b21b6; }
    </style>
    <button id="save">Save chat</button>
    <button id="inject">Inject context</button>`;
  shadow.getElementById("inject").onclick = onInject;
  shadow.getElementById("save").onclick = onSave;
  document.body.appendChild(host);
}

// ---------- CHAT HANDOFF ----------
function getTurns() {
  const els = [...document.querySelectorAll(USER_SEL + "," + AI_SEL)];
  // drop elements nested inside another matched element (avoids duplicates)
  const top = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  return top
    .map((el) => {
      const role = el.matches(USER_SEL) ? "user" : "ai";
      let text = el.innerText.trim();
      if (role === "user") {
        // a handoff message: keep its content as plain context, don't re-wrap it
        if (text.startsWith(HANDOFF_MARK)) {
          text = text
            .replace(/^[^\n]*\n/, "")
            .replace(/\n*Continue from here\.?\s*$/i, "")
            .trim();
          return { role: "ctx", text };
        }
        // strip an injected memory block
        text = text.replace(/^Context about me:[\s\S]*?\n\n/, "").trim();
      }
      return { role, text };
    })
    .filter((t) => t.text);
}

// only the tab you are actively using may save a snapshot
let lastActive = 0;
["keydown", "pointerdown"].forEach((ev) =>
  document.addEventListener(
    ev,
    () => {
      lastActive = Date.now();
    },
    true
  )
);

let lastSig = "";
function saveChatSnapshot() {
  if (Date.now() - lastActive > 10 * 60 * 1000) return;
  const turns = getTurns();
  if (turns.length < 2) return;
  if (!turns.some((t) => t.role === "user")) return;
  const sig = turns.length + ":" + turns[turns.length - 1].text.length;
  if (sig === lastSig) return;
  lastSig = sig;
  console.log("snapshot saved", turns.map((t) => t.role).join(","));
  callApi("/snapshot", { site: location.hostname, turns: turns.slice(-10) });
}
setInterval(saveChatSnapshot, 5000);

let handoffUrl = null;
async function checkHandoff() {
  if (handoffUrl === location.href) return;
  if (!/^\/(u\/\d+\/)?(app\/?|new\/?)?$/.test(location.pathname)) return;
  if (getUserMessages().length > 0) return;
  const el = getEditor();
  if (!el) return;
  if ((el.value ?? el.innerText).trim()) return;
  if (injectedUrl === location.href) return;
  try {
    const { snapshot } = await chrome.storage.local.get("snapshot");
    if (!snapshot || snapshot.used) return;
    if (snapshot.site === location.hostname) return;
    if (Date.now() - snapshot.ts > 6 * 3600 * 1000) return;
    handoffUrl = location.href;
    const body = snapshot.turns
      .map((t) =>
        t.role === "user"
          ? "Me: " + t.text
          : t.role === "ai"
          ? "AI: " + t.text
          : t.text
      )
      .join("\n");
    injectText(
      `${HANDOFF_MARK} ${snapshot.site}. Recent context:\n${body}\n\nContinue from here.`
    );
    // one-shot: refreshing or opening another new chat won't re-inject it
    await chrome.storage.local.set({ snapshot: { ...snapshot, used: true } });
    toast("Chat carried over. Press Enter to send");
  } catch (e) {}
}
setInterval(checkHandoff, 1500);

createWidget();