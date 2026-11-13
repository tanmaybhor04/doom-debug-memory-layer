console.log("Memory Layer loaded");

const MOCK_CONTEXT = "I'm a React developer using TypeScript and Supabase. Prefer concise answers with code.";

function getEditor() {
  return document.querySelector('#prompt-textarea, div[contenteditable="true"], textarea');
}

function injectText(text) {
  const el = getEditor();
  if (!el) return alert("Chat box not found");
  el.focus();
  if (el.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, text + "\n\n" + el.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text + "\n\n" + el.innerText);
  }
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
  shadow.getElementById("inject").onclick = () => injectText(MOCK_CONTEXT);
  shadow.getElementById("save").onclick = () => console.log("Save clicked (backend later)");
  document.body.appendChild(host);
}

createWidget();