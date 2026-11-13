// Runs inside ChatGPT / Claude / Gemini. Selectors are best-effort: these sites change their
// HTML often, so if auto-inject stops working, update BOX / SEND below.
(() => {
  const host = location.hostname;
  const P = host.includes("chatgpt") ? "chatgpt" : host.includes("claude") ? "claude" : "gemini";
  const BOX = { chatgpt: "#prompt-textarea", claude: 'div[contenteditable="true"]',
    gemini: 'div.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]' }[P];
  const SEND = { chatgpt: 'button[data-testid="send-button"]',
    claude: 'button[aria-label="Send message"], button[aria-label="Send Message"]',
    gemini: 'button[aria-label="Send message"], button.send-button' }[P];
  const MARK = "[Persistent user context";
  let auto = true, busy = false, bypass = false;
  chrome.storage.local.get("auto").then((v) => (auto = v.auto !== false));
  chrome.storage.onChanged.addListener((c) => { if (c.auto) auto = c.auto.newValue !== false; });

  const box = () => document.querySelector(BOX);
  const read = (el) => (el.tagName === "TEXTAREA" ? el.value : el.innerText);
  // Only inject at the START of a conversation: saves tokens and avoids repeating the context.
  const isNew = () => !/\/(c|chat|app)\/[\w-]{6,}/.test(location.pathname);

  function note(msg) {
    const n = document.createElement("div");
    n.textContent = msg;
    Object.assign(n.style, { position: "fixed", right: "16px", bottom: "140px", zIndex: 2147483647, background: "#121a33",
      color: "#fff", padding: "10px 14px", borderRadius: "10px", font: "13px system-ui", border: "1px solid #6d7cff" });
    document.body.append(n);
    setTimeout(() => n.remove(), 4000);
  }

  function write(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text); // works with ProseMirror/Quill editors
    }
  }

  async function enrich(el) {
    const text = read(el).trim();
    if (!text || text.startsWith(MARK)) return false;
    const r = await chrome.runtime.sendMessage({ type: "INJECT", prompt: text, platform: P });
    if (!r.ok) {
      note(r.status === 402 ? "Memory Layer: free limit reached. Upgrade on the website."
        : r.status === 401 ? "Memory Layer: click the extension icon to log in." : "Memory Layer: " + r.error);
      return false; // never block the user's own message
    }
    write(el, r.data.final_prompt);
    const n = Object.values(r.data.redactions || {}).reduce((a, b) => a + b, 0);
    if (n) note(`Memory Layer removed ${n} secret(s) from your prompt.`);
    return true;
  }

  function send(el) {
    const b = document.querySelector(SEND);
    if (b && !b.disabled) b.click();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  }

  function handle(e) {
    if (bypass || busy || !auto || !isNew()) return;
    const el = box();
    if (!el) return;
    const t = read(el).trim();
    if (!t || t.startsWith(MARK)) return;
    e.preventDefault(); e.stopImmediatePropagation(); // pause the send, enrich, then send for real
    busy = true;
    enrich(el).finally(() => setTimeout(() => { bypass = true; send(el); bypass = false; busy = false; }, 120));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.closest && e.target.closest(BOX)) handle(e);
  }, true);
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(SEND)) handle(e); }, true);

  // Manual button: works on any message, any time.
  const fab = document.createElement("button");
  fab.textContent = "◈ Memory";
  Object.assign(fab.style, { position: "fixed", right: "16px", bottom: "96px", zIndex: 2147483647, padding: "8px 12px",
    border: "0", borderRadius: "20px", background: "#6d7cff", color: "#fff", font: "600 13px system-ui", cursor: "pointer" });
  fab.onclick = async () => { const el = box(); if (!el) return note("Memory Layer: click into the chat box first."); await enrich(el); };
  document.body.append(fab);
})();
