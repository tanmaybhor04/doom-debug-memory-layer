// content_chatgpt.js — ChatGPT (chatgpt.com)
// Injects DOOM context into ChatGPT's prompt field before sending.
//
// IMPORTANT: ChatGPT's DOM changes frequently. If the selectors break,
// open DevTools, right-click the textarea → Inspect, and update them here.

(async function () {
  // Load the shared injector logic
  const src = chrome.runtime.getURL('content_common.js');
  await import(src);

  setupInjector({
    platform: 'chatgpt',

    // Counts how many user turns are already visible
    userMsgSelector: '[data-message-author-role="user"]',

    // ChatGPT uses a <div contenteditable> (ProseMirror) since late 2023
    getInputEl: () =>
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"][data-id]') ||
      document.querySelector('textarea[placeholder]'),

    // The send/arrow button
    getSendBtn: () =>
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button[data-testid="fruitjuice-send-button"]'),
  });
})();
