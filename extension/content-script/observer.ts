// extension/content-script/observer.ts — MutationObserver for SPA navigation detection
// SLICC-3.2.4: Detect route changes without full page reloads

export type NavigationCallback = (url: string) => void;

/**
 * Watches for SPA-style navigation changes using MutationObserver.
 * Detects framework-driven page changes (React, Vue, Next.js, etc.)
 * that modify the DOM without triggering traditional navigation events.
 */
export class SPAObserver {
  private observer: MutationObserver | null = null;
  private callback: NavigationCallback;
  private lastUrl: string;
  private debounceTimer: number | null = null;
  private readonly DEBOUNCE_MS = 300;

  constructor(callback: NavigationCallback) {
    this.callback = callback;
    this.lastUrl = location.href;
  }

  /** Start observing DOM changes for SPA navigation. */
  start(): void {
    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    // Observe significant DOM changes that indicate page navigation
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /** Stop observing. */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    // Check if the URL changed
    const currentUrl = location.href;
    if (currentUrl === this.lastUrl) return;

    // Count significant DOM changes (not just attribute updates)
    let significantChanges = 0;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        significantChanges +=
          mutation.addedNodes.length + mutation.removedNodes.length;
      }
    }

    // Only fire if there were meaningful DOM changes
    if (significantChanges < 3) return;

    // Debounce to avoid firing multiple times during rapid framework updates
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      const url = location.href;
      if (url !== this.lastUrl) {
        this.lastUrl = url;
        this.callback(url);
      }
      this.debounceTimer = null;
    }, this.DEBOUNCE_MS);
  }
}
