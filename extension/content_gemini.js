// content_gemini.js — Google Gemini (gemini.google.com)

(async function () {
  const src = chrome.runtime.getURL('content_common.js');
  await import(src);

  setupInjector({
    platform: 'gemini',
    userMsgSelector: '.user-query-bubble-with-background',
    getInputEl: () =>
      document.querySelector('rich-textarea .ql-editor') ||
      document.querySelector('[contenteditable="true"]'),
    getSendBtn: () =>
      document.querySelector('button.send-button') ||
      document.querySelector('[aria-label="Send message"]'),
  });
})();
