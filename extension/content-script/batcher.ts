// extension/content-script/batcher.ts — Signal batching and delivery
// SLICC-3.2.2: Collect signals, batch every 500ms, send to background

import type { Signal } from '@glow/core';
import { SIGNAL_BATCH_INTERVAL_MS } from '@glow/core';

/**
 * Batches signals and sends them to the background service worker
 * at a fixed interval (500ms).
 */
export class SignalBatcher {
  private buffer: Signal[] = [];
  private timer: number | null = null;
  private pageUrl: string;

  constructor(pageUrl: string) {
    this.pageUrl = pageUrl;
  }

  /** Add a signal to the current batch. */
  push(signal: Signal): void {
    this.buffer.push(signal);

    // Start batch timer if not running
    if (this.timer === null) {
      this.timer = window.setTimeout(() => {
        this.flush();
      }, SIGNAL_BATCH_INTERVAL_MS);
    }
  }

  /** Flush the current batch to the background service worker. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0) return;

    const signals = this.buffer.slice();
    this.buffer = [];

    // Send to background
    chrome.runtime.sendMessage(
      {
        type: 'SIGNAL_BATCH',
        signals,
        pageUrl: this.pageUrl,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          // Extension context invalidated — stop collecting
          return;
        }

        // If background returns blocks, inject them
        if (response?.type === 'INJECT_BLOCKS' && response.blocks?.length > 0) {
          // Dynamic import to avoid circular dependency
          import('./injector.js').then(({ injectBlocks }) => {
            injectBlocks(response.blocks);
          });
        }
      },
    );
  }

  /** Update the page URL (after SPA navigation). */
  setPageUrl(url: string): void {
    this.pageUrl = url;
  }

  /** Stop batching and flush remaining signals. */
  stop(): void {
    this.flush();
  }
}
