// extension/content-script/index.ts — Content script entry point
// Initializes signal collection, batching, and SPA observation

import { SignalCollector } from './signals.js';
import { SignalBatcher } from './batcher.js';
import { SPAObserver } from './observer.js';
import { injectBlocks, restoreAll } from './injector.js';

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
console.log(`[glow] Content script loaded — build: ${__BUILD_TIMESTAMP__}`);

const batcher = new SignalBatcher(location.href);

const collector = new SignalCollector((signal) => {
  batcher.push(signal);
});

const spaObserver = new SPAObserver((newUrl) => {
  // On SPA navigation: update batcher URL, flush pending signals,
  // emit a new page visit, restart signal collection
  batcher.setPageUrl(newUrl);
  batcher.flush();
  collector.stop();
  collector.start();
});

// Start everything
collector.start();
spaObserver.start();

// Listen for messages from background (e.g., block injection commands)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'INJECT_BLOCKS' && message.blocks) {
    injectBlocks(message.blocks);
  }
  if (message.type === 'RESTORE_ALL') {
    restoreAll();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  collector.stop();
  spaObserver.stop();
  batcher.stop();
});
