// popup.js — DOOM Memory Layer extension popup (Direct DOM Injector)

const API_URL   = 'http://localhost:8000';
const API_TOKEN = 'local-dev-token';

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (API_TOKEN) h['Authorization'] = `Bearer ${API_TOKEN}`;
  return h;
}

async function load() {
  const statusChip = document.getElementById('chip-status');
  const nodesChip  = document.getElementById('chip-nodes');
  const list       = document.getElementById('mem-list');

  try {
    const [health, mems] = await Promise.all([
      fetch(`${API_URL}/health`, { headers: authHeaders(), cache: 'no-store' }).then(r => r.json()),
      fetch(`${API_URL}/memories`, { headers: authHeaders(), cache: 'no-store' }).then(r => r.json()),
    ]);

    statusChip.textContent = `● ONLINE · ${health.version || 'v1.0'}`;
    statusChip.className   = 'chip online';

    const validMems = Array.isArray(mems) ? mems : [];
    nodesChip.textContent  = `${validMems.length} nodes`;

    if (!validMems.length) {
      list.innerHTML = '<div class="empty">No rules yet — open the dashboard to add some.</div>';
      return;
    }

    list.innerHTML = validMems.slice(0, 8).map(m => `
      <div class="mem-item">
        <div class="mem-key">${escHtml(m.key)}</div>
        <div class="mem-val">${escHtml(m.value)}</div>
      </div>
    `).join('');

  } catch (err) {
    statusChip.textContent = '◌ OFFLINE';
    statusChip.className   = 'chip offline';
    list.innerHTML = '<div class="empty">Backend not reachable.<br>Start: uvicorn main:app --reload</div>';
  }
}

document.getElementById('inject-btn').addEventListener('click', async () => {
  const btn = document.getElementById('inject-btn');
  btn.textContent = '⟳ Injecting…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';

    // Detect platform from active tab URL
    let platform = 'custom';
    if (url.includes('chatgpt.com') || url.includes('openai.com')) platform = 'chatgpt';
    else if (url.includes('gemini.google.com')) platform = 'gemini';
    else if (url.includes('claude.ai')) platform = 'claude';
    else if (url.includes('copilot.microsoft.com')) platform = 'copilot';

    // 1. Resolve context directly from FastAPI backend (also logs to Audit table!)
    const res = await fetch(`${API_URL}/context/resolve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        prompt: '',
        platform: platform,
        conversation_is_new: true,
        force: true,
        dry_run: false
      })
    }).then(r => r.json());

    if (!res || !res.injected || !res.context_block) {
      btn.textContent = '⚠ No active rules';
      setTimeout(() => { btn.textContent = '⬡ FORCE INJECT NOW'; }, 2000);
      return;
    }

    // 2. Inject directly into the active tab's chat input (ProseMirror / Quill / Textarea)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (contextBlock, ruleCount) => {
        const editor =
          document.querySelector('#prompt-textarea') ||
          document.querySelector('.ql-editor') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea');

        if (!editor) {
          alert('DOOM: Click inside the AI chat box first!');
          return;
        }

        editor.focus();
        const existingText = (editor.value !== undefined ? editor.value : editor.innerText || '').trim();
        const combined = existingText
          ? `${contextBlock}\n\n${existingText}`
          : `${contextBlock}\n\n`;

        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(editor, combined);
          else editor.value = combined;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // ProseMirror (ChatGPT/Claude) & Quill (Gemini) rich-text injection
          editor.innerHTML = '';
          const p = document.createElement('p');
          p.textContent = combined;
          editor.appendChild(p);
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: combined }));
        }

        // Show glowing cyan confirmation toast on page
        const badge = document.createElement('div');
        badge.textContent = `⚡ DOOM // Injected ${ruleCount} neural rules`;
        Object.assign(badge.style, {
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: '999999',
          background: '#083344',
          color: '#22d3ee',
          border: '1px solid #06b6d4',
          padding: '10px 16px',
          borderRadius: '10px',
          fontFamily: 'monospace',
          fontSize: '13px',
          fontWeight: 'bold',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
        });
        document.body.appendChild(badge);
        setTimeout(() => badge.remove(), 3500);
      },
      args: [res.context_block, res.used ? res.used.length : 1]
    });

    btn.textContent = '✓ Injected!';
    setTimeout(() => { btn.textContent = '⬡ FORCE INJECT NOW'; }, 2000);

  } catch (err) {
    console.error(err);
    btn.textContent = '⚠ Reload Extension';
    setTimeout(() => { btn.textContent = '⬡ FORCE INJECT NOW'; }, 2200);
  }
});

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

load();