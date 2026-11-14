// content_claude.js — Claude (claude.ai)

(async function () {
  const src = chrome.runtime.getURL('content_common.js');
  await import(src);

  setupInjector({
    platform: 'claude',
    userMsgSelector: '[data-testid="human-turn"]',
    getInputEl: () =>
      document.querySelector('[contenteditable="true"].ProseMirror') ||
      document.querySelector('[contenteditable="true"][role="textbox"]'),
    getSendBtn: () =>
      document.querySelector('button[aria-label="Send Message"]') ||
      document.querySelector('button[type="submit"]'),
  });
})();
