// Memory Layer web app. Served by FastAPI at /app/, so API calls are same-origin (API = "").
const API = "", TOKEN = "mem_token", FREE_RULES = 5, root = document.getElementById("root");
const S = { user: null, rules: [], view: "memory", editing: null };

// tiny element builder: h("div", {class:"x", onclick:fn}, child, "text"). Uses textContent-style
// children only, so user-written rule text can never inject HTML.
const h = (t, p = {}, ...k) => {
  const e = document.createElement(t);
  for (const [n, v] of Object.entries(p)) {
    if (v == null || v === false || n === "value") continue;
    if (n === "class") e.className = v;
    else if (n.startsWith("on")) e.addEventListener(n.slice(2), v);
    else e.setAttribute(n, v === true ? "" : v);
  }
  e.append(...k.flat().filter((x) => x != null && x !== false));
  if (p.value != null) e.value = p.value;
  return e;
};

async function api(path, method = "GET", body) {
  const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  const tok = localStorage.getItem(TOKEN);
  if (tok) headers.Authorization = "Bearer " + tok;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error("Cannot reach the server. Is uvicorn running?"), { status: 0 });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data && data.detail;
    throw Object.assign(new Error(Array.isArray(d) ? d.map((x) => x.msg).join("; ") : d || res.statusText), { status: res.status });
  }
  return data;
}

function toast(msg, bad) {
  const t = h("div", { class: "toast" + (bad ? " bad" : "") }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = h("textarea", {}, text); document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }
  toast("Copied to clipboard");
}
function logout(note) { localStorage.removeItem(TOKEN); S.user = null; renderAuth(note); }
async function run(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.status === 401) logout("Session expired. Please log in again.");
    else if (e.status === 402) toast(e.message + " Go to Account to upgrade.", true);
    else toast(e.message, true);
  }
}
const reload = async () => { S.rules = await api("/rules"); renderApp(); };

// ---------------- login / register ----------------
function renderAuth(note) {
  let mode = "login";
  const err = h("p", { class: "err" }, note || "");
  const name = h("input", { placeholder: "Your name", autocomplete: "name" });
  const email = h("input", { type: "email", placeholder: "Email", autocomplete: "email", required: true });
  const pw = h("input", { type: "password", placeholder: "Password (min 8 characters)", autocomplete: "current-password", required: true, minlength: 8 });
  const nameBox = h("div", {}, name); nameBox.hidden = true;
  const btn = h("button", { class: "btn wide" }, "Log in");
  const tabs = [["login", "Log in"], ["register", "Register"]].map(([m, l]) =>
    h("button", { type: "button", "data-m": m, class: "tab" + (m === "login" ? " on" : ""), onclick: () => {
      mode = m; nameBox.hidden = m === "login"; btn.textContent = m === "login" ? "Log in" : "Create account";
      tabs.forEach((t) => t.classList.toggle("on", t.dataset.m === m)); err.textContent = "";
    } }, l));
  const submit = async (ev) => {
    ev.preventDefault(); btn.disabled = true; err.textContent = "";
    try {
      const body = mode === "login" ? { email: email.value.trim(), password: pw.value }
        : { email: email.value.trim(), name: name.value.trim() || "User", password: pw.value };
      const d = await api(mode === "login" ? "/auth/login" : "/auth/register", "POST", body);
      localStorage.setItem(TOKEN, d.token); S.user = d.user; await boot();
    } catch (x) { err.textContent = x.message; }
    btn.disabled = false;
  };
  root.replaceChildren(h("div", { class: "auth" },
    h("div", {},
      h("h1", {}, "Your AI memory, everywhere."),
      h("p", { class: "mut" }, "Ran out of tokens on ChatGPT? Switch to Claude or Gemini and keep going. Your rules, stack and preferences come with you."),
      h("ul", { class: "steps" },
        h("li", {}, h("b", {}, "1"), "Save your context once"),
        h("li", {}, h("b", {}, "2"), "Copy it (or auto-inject it with the extension)"),
        h("li", {}, h("b", {}, "3"), "Continue in any AI, no re-explaining"))),
    h("form", { class: "card authcard", onsubmit: submit }, h("div", { class: "tabs" }, tabs), nameBox, email, pw, err, btn)));
}

// ---------------- app shell ----------------
function renderApp() {
  const nav = ["memory", "playground", "account"].map((v) =>
    h("button", { class: "nav" + (S.view === v ? " on" : ""), onclick: () => { S.view = v; renderApp(); } }, v[0].toUpperCase() + v.slice(1)));
  const view = { memory: memoryView, playground: playView, account: accountView }[S.view]();
  root.replaceChildren(
    h("header", {}, h("div", { class: "brand" }, "◈ Memory Layer"), h("nav", {}, nav),
      h("div", { class: "who" }, h("span", { class: "pill " + S.user.plan }, S.user.plan.toUpperCase()), S.user.name,
        h("button", { class: "ghost", onclick: () => logout() }, "Log out"))),
    h("main", {}, view));
}

// ---------------- memory (rules) ----------------
function memoryView() {
  const e = S.editing, free = S.user.plan === "free";
  const title = h("input", { placeholder: "Title, e.g. Language", value: e && e.title, maxlength: 100, required: true });
  const content = h("textarea", { rows: 4, maxlength: 2000, required: true, placeholder: "e.g. Always write code in Python. I build IoT projects on ESP32." }, e ? e.content : "");
  const cat = h("select", { value: e ? e.category : "general" }, ["general", "coding", "writing", "project", "style"].map((c) => h("option", { value: c }, c)));
  const save = (ev) => {
    ev.preventDefault();
    run(async () => {
      const b = { title: title.value.trim(), content: content.value.trim(), category: cat.value };
      if (e) await api("/rules/" + e.id, "PATCH", b); else await api("/rules", "POST", b);
      S.editing = null; toast(e ? "Rule updated" : "Saved to your memory"); await reload();
    });
  };
  const form = h("form", { class: "card", onsubmit: save }, h("h3", {}, e ? "Edit rule" : "Add to your memory"), title, content,
    h("div", { class: "row" }, cat, h("button", { class: "btn" }, e ? "Save changes" : "Save rule"),
      e && h("button", { type: "button", class: "ghost", onclick: () => { S.editing = null; renderApp(); } }, "Cancel")));
  const carry = h("div", { class: "card" }, h("h3", {}, "Hit a limit? Take your memory with you"),
    h("p", { class: "mut" }, "Copy your context, open another AI, paste it as your first message."),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => run(async () => copy((await api("/context")).context_block || "No active rules yet.")) }, "Copy my context"),
      [["ChatGPT", "https://chatgpt.com"], ["Claude", "https://claude.ai"], ["Gemini", "https://gemini.google.com"]]
        .map(([n, u]) => h("a", { class: "ghost", href: u, target: "_blank", rel: "noopener" }, "Open " + n))));
  const list = S.rules.map((r) => h("div", { class: "rule" + (r.is_active ? "" : " off") },
    h("div", { class: "rhead" }, h("b", {}, r.title), h("span", { class: "pill" }, r.category), r.scope === "workspace" && h("span", { class: "pill team" }, "team")),
    h("p", {}, r.content),
    h("div", { class: "row" },
      h("button", { class: "ghost", onclick: () => run(async () => { await api("/rules/" + r.id, "PATCH", { is_active: !r.is_active }); await reload(); }) }, r.is_active ? "Pause" : "Resume"),
      h("button", { class: "ghost", onclick: () => { S.editing = r; renderApp(); scrollTo(0, 0); } }, "Edit"),
      h("button", { class: "ghost danger", onclick: () => confirm("Delete this rule?") && run(async () => { await api("/rules/" + r.id, "DELETE"); await reload(); }) }, "Delete"))));
  return h("div", { class: "grid" }, h("div", {}, carry, form),
    h("div", {}, h("h3", { class: "sec" }, `Your rules (${S.rules.length}${free ? " / " + FREE_RULES : ""})`),
      list.length ? list : h("p", { class: "mut" }, "No rules yet. Add your first one on the left.")));
}

// ---------------- playground (what the extension will do) ----------------
function playView() {
  const p = h("textarea", { rows: 5, placeholder: "Type a prompt, e.g. Fix this memory leak" });
  const plat = h("select", {}, ["chatgpt", "claude", "gemini", "copilot"].map((x) => h("option", { value: x }, x)));
  const out = h("div", { class: "card" }, h("p", { class: "mut" }, "Your enriched prompt appears here."));
  const show = (text, d) => out.replaceChildren(
    h("div", { class: "row" }, h("h3", {}, "Result"),
      Object.entries(d.redactions || {}).map(([k, v]) => h("span", { class: "pill warn" }, `${k} ×${v}`)),
      d.rules_used != null && h("span", { class: "pill" }, d.rules_used + " rules used")),
    h("pre", {}, text.split(/(\[REDACTED_[A-Z_]+\])/).map((s) => (s.startsWith("[REDACTED_") ? h("mark", {}, s) : s))),
    h("button", { class: "btn", onclick: () => copy(text) }, "Copy"));
  return h("div", { class: "narrow", style: "max-width:760px" },
    h("div", { class: "card" }, h("h3", {}, "Playground"),
      h("p", { class: "mut" }, "See exactly what the extension sends to the AI: your memory added, secrets removed."), p,
      h("div", { class: "row" }, plat,
        h("button", { class: "btn", onclick: () => run(async () => { const d = await api("/inject", "POST", { prompt: p.value, platform: plat.value }); show(d.final_prompt, d); }) }, "Build prompt"),
        h("button", { class: "ghost", onclick: () => run(async () => { const d = await api("/security/scrub", "POST", { text: p.value }); show(d.clean_text, d); }) }, "Scan for secrets only"),
        h("button", { class: "ghost", onclick: () => { p.value = "Fix this memory leak. My key is sk-proj-abc123def456ghi789jkl012, email priya@acme.com, DB_PASSWORD=Sup3rS3cret!"; } }, "Fill demo"))),
    out);
}

// ---------------- account ----------------
function accountView() {
  const u = S.user, free = u.plan === "free";
  return h("div", { class: "card narrow" }, h("h3", {}, u.name), h("p", { class: "mut" }, u.email),
    h("p", {}, "Plan: ", h("span", { class: "pill " + u.plan }, u.plan.toUpperCase())),
    h("p", { class: "mut" }, free ? `Free: ${FREE_RULES} rules and 50 injections per day.` : "Pro: unlimited rules and injections."),
    free && h("button", { class: "btn", onclick: () => run(async () => { S.user = await api("/me/upgrade", "POST"); toast("Upgraded to Pro (demo billing)"); renderApp(); }) }, "Upgrade to Pro (demo)"));
}

// ---------------- start ----------------
async function boot() {
  if (!localStorage.getItem(TOKEN)) return renderAuth();
  try {
    if (!S.user) S.user = await api("/me");
    S.rules = await api("/rules");
    renderApp();
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(TOKEN); renderAuth(); } else renderAuth(e.message);
  }
}
boot();
