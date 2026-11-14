// content_copilot.js — Microsoft Copilot (copilot.microsoft.com)

(async function () {
  const src = chrome.runtime.getURL('content_common.js');
  await import(src);

  setupInjector({
    platform: 'copilot',
    userMsgSelector: '[data-content="user-message"]',
    getInputEl: () =>
      document.querySelector('textarea[name="q"]') ||
      document.querySelector('[contenteditable="true"]'),
    getSendBtn: () =>
      document.querySelector('button[aria-label="Submit"]') ||
      document.querySelector('button[type="submit"]'),
  });
})();
