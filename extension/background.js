// Service worker: the only place that talks to the backend (content scripts on https pages
// cannot call http://localhost directly; this worker can, thanks to host_permissions).
const DEFAULTS = { server: "http://localhost:8000", auto: true };
const get = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });

async function call(path, method, body, auth = true) {
  const c = await get();
  const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  if (auth && c.token) headers.Authorization = "Bearer " + c.token;
  let r;
  try {
    r = await fetch(c.server.replace(/\/$/, "") + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw { status: 0, message: "Cannot reach the server. Is uvicorn running?" };
  }
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401) await chrome.storage.local.remove(["token", "user"]);
    const x = d && d.detail;
    throw { status: r.status, message: Array.isArray(x) ? x.map((i) => i.msg).join("; ") : x || r.statusText };
  }
  return d;
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  (async () => {
    if (m.type === "LOGIN") {
      await chrome.storage.local.set({ server: m.server });
      const d = await call("/auth/login", "POST", { email: m.email, password: m.password }, false);
      await chrome.storage.local.set({ token: d.token, user: d.user });
      return { user: d.user };
    }
    if (m.type === "LOGOUT") { await chrome.storage.local.remove(["token", "user"]); return {}; }
    if (m.type === "SET") { await chrome.storage.local.set(m.values); return {}; }
    if (m.type === "STATUS") { const c = await get(); return { user: c.user || null, server: c.server, auto: c.auto }; }
    if (m.type === "INJECT") {
      if (!(await get()).token) throw { status: 401, message: "Log in via the extension icon first." };
      return call("/inject", "POST", { prompt: m.prompt, platform: m.platform });
    }
  })().then((data) => send({ ok: true, data }), (e) => send({ ok: false, status: e.status, error: e.message }));
  return true; // keep the channel open for the async reply
});
