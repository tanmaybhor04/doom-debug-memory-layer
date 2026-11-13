console.log("Memory Layer loaded");

const MOCK_CONTEXT = "I'm a React developer using TypeScript and Supabase. Prefer concise answers with code.";

function getEditor() {
  return document.querySelector('#prompt-textarea, div[contenteditable="true"], textarea');
}

function injectText(text) {
  const el = getEditor();
  if (!el) return alert("Chat box not found");
  const current = el.value ?? el.innerText;
  if (current.includes(text)) return console.log("Already injected");
  el.focus();
  if (el.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
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
  const sel = '[data-testid="user-message"], [data-message-author-role="user"]';
  return [...document.querySelectorAll(sel)]
    .map((e) => e.innerText.trim())
    .filter(Boolean);
}

async function onSave() {
  const selected = window.getSelection().toString().trim();
  const msgs = getUserMessages();
  const text = selected || msgs[msgs.length - 1];
  if (!text) return alert("Nothing to save");
  const res = await callApi("/memories", {
    text, source: location.hostname, workspace: "personal",
  });
  console.log("Save result:", res);
}

async function onInject() {
  const el = getEditor();
  const prompt = el ? (el.value ?? el.innerText) : "";
  let context = MOCK_CONTEXT;
  try {
    const res = await Promise.race([
      callApi("/context", { prompt, workspace: "personal" }),
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (res && res.ok && res.data && res.data.context) context = res.data.context;
  } catch (e) {
    console.log("API failed, using mock:", e);
  }
  console.log("Injecting:", context);
  injectText(context);
}

function createWidget() {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:999999;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      button { background:#6d28d9; color:#fff; border:none; padding:10px 14px;
        border-radius:10px; cursor:pointer; font:600 13px sans-serif; margin-left:6px; }
      button:hover { background:#5b21b6; }
    </style>
    <button id="save">Save chat</button>
    <button id="inject">Inject context</button>`;
  shadow.getElementById("inject").onclick = onInject;
  shadow.getElementById("save").onclick = onSave;
  document.body.appendChild(host);
}

createWidget();