// extension/content-script/signals.ts — DOM event listeners for behavioral signals
// SLICC-3.2.1: Signal collector for scroll, click, hover, visibility, navigation, forms

import type { Signal, SignalType } from '@glow/core';
import {
  SCROLL_THROTTLE_MS,
  HOVER_DWELL_THRESHOLD_MS,
} from '@glow/core';

export type SignalCallback = (signal: Signal) => void;

/**
 * Collects behavioral signals from the page DOM.
 * Attaches throttled event listeners and reports via callback.
 */
export class SignalCollector {
  private callback: SignalCallback;
  private cleanupFns: (() => void)[] = [];
  private hoverTimers = new Map<string, number>();
  private intersectionObserver: IntersectionObserver | null = null;

  constructor(callback: SignalCallback) {
    this.callback = callback;
  }

  /** Start collecting signals from the page. */
  start(): void {
    this.attachScrollListener();
    this.attachClickListener();
    this.attachHoverListener();
    this.attachVisibilityObserver();
    this.attachNavigationListener();
    this.attachFormListener();
    this.emitPageVisit();
  }

  /** Stop collecting and remove all listeners. */
  stop(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
    this.hoverTimers.clear();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
  }

  /** Emit a page visit signal for the current page. */
  private emitPageVisit(): void {
    this.emit('page_visit', {
      url: location.href,
      referrer: document.referrer,
      title: document.title,
    });
  }

  // -------------------------------------------------------------------------
  // Scroll tracking (throttled to 200ms)
  // -------------------------------------------------------------------------

  private attachScrollListener(): void {
    let lastEmit = 0;
    let maxDepth = 0;

    const handler = () => {
      const now = Date.now();
      if (now - lastEmit < SCROLL_THROTTLE_MS) return;
      lastEmit = now;

      const depth =
        window.scrollY / (document.body.scrollHeight - window.innerHeight);
      const clampedDepth = Math.min(1, Math.max(0, depth));
      maxDepth = Math.max(maxDepth, clampedDepth);

      this.emit('scroll_depth', {
        depth: Math.round(clampedDepth * 100) / 100,
        maxDepth: Math.round(maxDepth * 100) / 100,
      });
    };

    window.addEventListener('scroll', handler, { passive: true });
    this.cleanupFns.push(() =>
      window.removeEventListener('scroll', handler),
    );
  }

  // -------------------------------------------------------------------------
  // Click tracking
  // -------------------------------------------------------------------------

  private attachClickListener(): void {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const selector = buildSelector(target);
      const text = (target.textContent ?? '').trim().slice(0, 100);
      const href = target.closest('a')?.href;
      const semanticParent = findSemanticParent(target);

      this.emit('click_target', {
        selector,
        text,
        href,
        semanticParent,
      });
    };

    document.addEventListener('click', handler, { passive: true });
    this.cleanupFns.push(() =>
      document.removeEventListener('click', handler),
    );
  }

  // -------------------------------------------------------------------------
  // Hover/dwell tracking (500ms threshold)
  // -------------------------------------------------------------------------

  private attachHoverListener(): void {
    const handleMouseEnter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !target.tagName || !isContentBlock(target)) return;

      const selector = buildSelector(target);
      this.hoverTimers.set(
        selector,
        window.setTimeout(() => {
          this.emit('hover_dwell', {
            selector,
            dwellMs: HOVER_DWELL_THRESHOLD_MS,
            blockType: target.tagName.toLowerCase(),
          });
          this.hoverTimers.delete(selector);
        }, HOVER_DWELL_THRESHOLD_MS),
      );
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !target.tagName) return;
      const selector = buildSelector(target);
      const timer = this.hoverTimers.get(selector);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.hoverTimers.delete(selector);
      }
    };

    document.addEventListener('mouseenter', handleMouseEnter, {
      passive: true,
      capture: true,
    });
    document.addEventListener('mouseleave', handleMouseLeave, {
      passive: true,
      capture: true,
    });
    this.cleanupFns.push(() => {
      document.removeEventListener('mouseenter', handleMouseEnter, {
        capture: true,
      });
      document.removeEventListener('mouseleave', handleMouseLeave, {
        capture: true,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Viewport block visibility (IntersectionObserver)
  // -------------------------------------------------------------------------

  private attachVisibilityObserver(): void {
    const visibilityTimers = new Map<Element, number>();

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) {
            const startTime = Date.now();
            visibilityTimers.set(el, startTime);
          } else {
            const startTime = visibilityTimers.get(el);
            if (startTime) {
              const durationMs = Date.now() - startTime;
              if (durationMs > 1000) {
                // Only report meaningful visibility
                this.emit('viewport_block_visibility', {
                  blockSelector: buildSelector(el as HTMLElement),
                  visiblePercent: Math.round(
                    entry.intersectionRatio * 100,
                  ),
                  durationMs,
                });
              }
              visibilityTimers.delete(el);
            }
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1.0] },
    );

    // Observe major content blocks
    const blocks = document.querySelectorAll(
      'section, article, [role="main"], .hero, .content, main > div',
    );
    for (const block of blocks) {
      this.intersectionObserver.observe(block);
    }
  }

  // -------------------------------------------------------------------------
  // Navigation tracking (popstate, pushstate, link clicks)
  // -------------------------------------------------------------------------

  private attachNavigationListener(): void {
    let currentUrl = location.href;

    const handleNavigation = (method: 'popstate' | 'pushstate' | 'click') => {
      const newUrl = location.href;
      if (newUrl !== currentUrl) {
        this.emit('navigation', {
          from: currentUrl,
          to: newUrl,
          method,
        });
        currentUrl = newUrl;
      }
    };

    // Intercept pushState/replaceState for SPA routing
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      origPushState(...args);
      handleNavigation('pushstate');
    };

    history.replaceState = function (...args) {
      origReplaceState(...args);
      handleNavigation('pushstate');
    };

    const popstateHandler = () => handleNavigation('popstate');
    window.addEventListener('popstate', popstateHandler);

    this.cleanupFns.push(() => {
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
      window.removeEventListener('popstate', popstateHandler);
    });
  }

  // -------------------------------------------------------------------------
  // Form interaction (no PII capture)
  // -------------------------------------------------------------------------

  private attachFormListener(): void {
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!isFormField(target)) return;

      this.emit('form_interaction', {
        formId: target.closest('form')?.id || undefined,
        fieldName: (target as HTMLInputElement).name || target.id || 'unknown',
        action: 'focus',
      });
    };

    const handleSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      this.emit('form_interaction', {
        formId: form.id || undefined,
        fieldName: '',
        action: 'submit',
      });
    };

    document.addEventListener('focusin', handleFocus, { passive: true });
    document.addEventListener('submit', handleSubmit, { passive: true });
    this.cleanupFns.push(() => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('submit', handleSubmit);
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private emit(type: SignalType, data: Record<string, unknown>): void {
    this.callback({
      type,
      timestamp: new Date().toISOString(),
      data,
      pageUrl: location.href,
    });
  }
}

// ---------------------------------------------------------------------------
// DOM utility functions
// ---------------------------------------------------------------------------

/** Build a concise CSS selector for an element. */
export function buildSelector(el: HTMLElement): string {
  if (!el || !el.tagName) return 'unknown';
  if (el.id) return `#${el.id}`;

  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;

  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName,
  );
  if (siblings.length === 1) {
    const parentSelector = buildSelector(parent);
    return `${parentSelector} > ${tag}`;
  }

  const index = siblings.indexOf(el) + 1;
  const parentSelector = buildSelector(parent);
  return `${parentSelector} > ${tag}:nth-of-type(${index})`;
}

/** Find the nearest semantic parent element. */
export function findSemanticParent(el: HTMLElement): string {
  const semanticTags = new Set([
    'section',
    'article',
    'aside',
    'nav',
    'header',
    'footer',
    'main',
    'form',
  ]);

  let current: HTMLElement | null = el.parentElement;
  while (current) {
    if (semanticTags.has(current.tagName.toLowerCase())) {
      return buildSelector(current);
    }
    current = current.parentElement;
  }
  return 'body';
}

/** Check if an element is a meaningful content block. */
function isContentBlock(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    ['section', 'article', 'div', 'aside', 'main'].includes(tag) &&
    el.children.length > 0
  );
}

/** Check if an element is a form field. */
function isFormField(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return ['input', 'textarea', 'select'].includes(tag);
}
