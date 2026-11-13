async function load() {
  const { memories = [] } = await chrome.storage.local.get("memories");
  const list = document.getElementById("list");
  const redacted = memories.reduce(
    (n, m) => n + (m.text.match(/\[REDACTED\]/g) || []).length, 0
  );
  document.getElementById("count").textContent = memories.length + " saved";
  document.getElementById("stats").textContent =
    "Sensitive items redacted: " + redacted + " | Stored locally";
  list.innerHTML = "";
  if (!memories.length) {
    list.innerHTML = '<div class="empty">No memories yet. Chat on any AI site.</div>';
    return;
  }
  [...memories].reverse().forEach((m) => {
    const div = document.createElement("div");
    div.className = "item";
    const text = document.createElement("div");
    text.textContent = m.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    const src = document.createElement("span");
    src.textContent = m.source;
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "Delete";
    del.onclick = async () => {
      const cur = (await chrome.storage.local.get("memories")).memories || [];
      await chrome.storage.local.set({ memories: cur.filter((x) => x.id !== m.id) });
      load();
    };
    meta.append(src, del);
    div.append(text, meta);
    list.appendChild(div);
  });
}

document.getElementById("clear").onclick = async () => {
  await chrome.storage.local.set({ memories: [] });
  load();
};

load();
