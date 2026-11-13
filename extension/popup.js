const $ = (id) => document.getElementById(id), out = $("out");
const send = (m) => chrome.runtime.sendMessage(m);

async function render() {
  const s = (await send({ type: "STATUS" })).data;
  if (s.user) {
    out.innerHTML = `<p>Logged in as <b id="n"></b></p><p class="m" id="sv"></p>
      <label><input type="checkbox" id="auto"> Auto-inject on new chats</label>
      <button id="lo">Log out</button>
      <p class="m">Tip: use the ◈ Memory button on any chat to inject manually.</p>`;
    $("n").textContent = s.user.name; $("sv").textContent = s.server; $("auto").checked = s.auto !== false;
    $("auto").onchange = () => send({ type: "SET", values: { auto: $("auto").checked } });
    $("lo").onclick = async () => { await send({ type: "LOGOUT" }); render(); };
  } else {
    out.innerHTML = `<input id="sv" placeholder="Server URL"><input id="em" type="email" placeholder="Email">
      <input id="pw" type="password" placeholder="Password"><p class="e" id="er"></p>
      <button id="go">Log in</button><p class="m">No account? Register on the website first.</p>`;
    $("sv").value = s.server;
    $("go").onclick = async () => {
      $("er").textContent = "";
      const r = await send({ type: "LOGIN", server: $("sv").value.trim(), email: $("em").value.trim(), password: $("pw").value });
      if (r.ok) render(); else $("er").textContent = r.error;
    };
  }
}
render();
