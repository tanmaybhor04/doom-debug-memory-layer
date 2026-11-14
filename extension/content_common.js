/**
 * content_common.js — shared injection logic
 * Included via script tag in each platform-specific content script.
 *
 * HOW IT WORKS:
 * 1. Detect when the user is about to submit a prompt (send button click / Enter key)
 * 2. Ask the background worker for the context block
 * 3. Prepend the context block invisibly to the textarea / contenteditable
 * 4. Show a small non-intrusive chip confirming injection
 */

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Insert text at the START of a textarea or contenteditable element
 * in a way that React / Vue / ProseMirror accept (triggers synthetic events).
 */
function insertTextAtStart(el, text) {
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(el, text + '\n' + el.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // contenteditable (ProseMirror / Quill / Lexical / TipTap)
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    sel.collapseToStart();
    document.execCommand('insertText', false, text + '\n');
  }
}

/**
 * Count visible user-turn messages in the DOM to decide if this is a new conversation.
 */
function countUserMessages(selector) {
  return document.querySelectorAll(selector).length;
}

/**
 * Show a small floating chip to let the user know context was injected.
 */
function showInjectionChip(rulesCount, platform) {
  const existing = document.getElementById('doom-chip');
  if (existing) existing.remove();

  const chip = document.createElement('div');
  chip.id = 'doom-chip';
  chip.style.cssText = `
    position: fixed; bottom: 80px; right: 20px; z-index: 999999;
    background: linear-gradient(135deg, #0f172a, #1e293b);
    border: 1px solid #22d3ee44;
    color: #22d3ee;
    font-family: monospace; font-size: 11px;
    padding: 7px 14px; border-radius: 999px;
    box-shadow: 0 0 20px rgba(34,211,238,0.25);
    display: flex; align-items: center; gap: 6px;
    animation: doomSlideIn 0.3s ease;
    cursor: pointer;
  `;
  chip.innerHTML = `
    <style>
      @keyframes doomSlideIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
    </style>
    <span style="width:6px;height:6px;border-radius:50%;background:#22d3ee;display:inline-block;animation:pulse 1.5s infinite"></span>
    ⬡ DOOM injected ${rulesCount} rule${rulesCount !== 1 ? 's' : ''} → ${platform}
  `;
  chip.onclick = () => chip.remove();
  document.body.appendChild(chip);
  setTimeout(() => chip && chip.remove(), 5000);
}

/**
 * Core injection function — called by each platform content script.
 *
 * @param {Object} opts
 * @param {string}   opts.platform          - e.g. "chatgpt"
 * @param {string}   opts.userMsgSelector   - CSS selector that counts sent user messages
 * @param {Function} opts.getInputEl        - returns the active textarea/contenteditable
 * @param {Function} opts.getSendBtn        - returns the send button element
 */
async function setupInjector({ platform, userMsgSelector, getInputEl, getSendBtn }) {
  let injectedThisSession = false;

  async function inject() {
    if (injectedThisSession) return;

    const inputEl = getInputEl();
    if (!inputEl) return;

    const msgCount = countUserMessages(userMsgSelector);
    const isNew = msgCount === 0;

    // Don't inject mid-conversation unless forced
    if (!isNew && injectedThisSession) return;

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const tid = setTimeout(() => reject(new Error('timeout')), 7000);
        chrome.runtime.sendMessage(
          { type: 'RESOLVE_CONTEXT', payload: { prompt: inputEl.value || inputEl.innerText || '', platform, conversation_is_new: isNew } },
          (res) => { clearTimeout(tid); resolve(res); }
        );
      });
    } catch (err) {
      console.warn('[DOOM] context fetch failed:', err.message);
      return;
    }

    if (!result || !result.injected || !result.context_block) return;

    insertTextAtStart(inputEl, result.context_block);
    injectedThisSession = true;
    showInjectionChip(result.used?.length ?? '?', platform.toUpperCase());
  }

  // ── intercept send button click ──────────────────────────────────────────
  document.addEventListener('click', async (e) => {
    const btn = getSendBtn();
    if (btn && (btn === e.target || btn.contains(e.target))) {
      await inject();
    }
  }, true);

  // ── intercept keyboard Enter (without Shift) ─────────────────────────────
  document.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const inputEl = getInputEl();
    if (inputEl && (inputEl === document.activeElement || inputEl.contains(document.activeElement))) {
      await inject();
    }
  }, true);

  // Reset session flag when a new conversation starts (URL change)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      injectedThisSession = false;
    }
  }).observe(document.body, { childList: true, subtree: true });
}
