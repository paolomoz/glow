// snippet/loader.ts — Production JS snippet
// CC-4.2.1: Minimal async loader (<2KB gzipped target)
// Reads config from data attributes, collects signals, communicates with Worker

import type {
  Signal,
  SignalType,
  BlockReplacement,
} from '@glow/core';
import {
  SIGNAL_BATCH_INTERVAL_MS,
  SCROLL_THROTTLE_MS,
  HOVER_DWELL_THRESHOLD_MS,
} from '@glow/core';

// ---------------------------------------------------------------------------
// Configuration from script data attributes
// ---------------------------------------------------------------------------

interface GlowConfig {
  endpoint: string;   // Worker URL
  siteId: string;     // Site identifier
  consent: boolean;   // Wait for consent before collecting
}

function readConfig(): GlowConfig | null {
  const script = document.currentScript as HTMLScriptElement | null ??
    document.querySelector('script[data-glow-endpoint]');

  if (!script) return null;

  const endpoint = script.getAttribute('data-glow-endpoint');
  const siteId = script.getAttribute('data-glow-site-id') ?? location.hostname;
  const consent = script.getAttribute('data-glow-consent') === 'true';

  if (!endpoint) return null;

  return { endpoint, siteId, consent };
}

// ---------------------------------------------------------------------------
// Session management (CC-4.2.4)
// ---------------------------------------------------------------------------

function getSessionId(): string {
  const COOKIE_NAME = '_glow_sid';
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`),
  );
  if (match) return match[1];

  const sid = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const maxAge = 30 * 60; // 30 min
  document.cookie = `${COOKIE_NAME}=${sid}; path=/; max-age=${maxAge}; SameSite=Lax`;
  return sid;
}

function renewSession(sid: string): void {
  const COOKIE_NAME = '_glow_sid';
  const maxAge = 30 * 60;
  document.cookie = `${COOKIE_NAME}=${sid}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Signal collection (CC-4.2.2 — same logic as extension)
// ---------------------------------------------------------------------------

type SignalCallback = (signal: Signal) => void;

function collectSignals(callback: SignalCallback): () => void {
  const cleanupFns: (() => void)[] = [];

  // Page visit
  callback({
    type: 'page_visit',
    timestamp: new Date().toISOString(),
    data: { url: location.href, referrer: document.referrer, title: document.title },
    pageUrl: location.href,
  });

  // Scroll (throttled)
  let lastScroll = 0;
  let maxDepth = 0;
  const onScroll = () => {
    const now = Date.now();
    if (now - lastScroll < SCROLL_THROTTLE_MS) return;
    lastScroll = now;
    const depth = window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);
    const clamped = Math.min(1, Math.max(0, depth));
    maxDepth = Math.max(maxDepth, clamped);
    callback({
      type: 'scroll_depth',
      timestamp: new Date().toISOString(),
      data: { depth: Math.round(clamped * 100) / 100, maxDepth: Math.round(maxDepth * 100) / 100 },
      pageUrl: location.href,
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanupFns.push(() => window.removeEventListener('scroll', onScroll));

  // Click
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t) return;
    callback({
      type: 'click_target',
      timestamp: new Date().toISOString(),
      data: {
        selector: t.id ? `#${t.id}` : t.tagName.toLowerCase(),
        text: (t.textContent ?? '').trim().slice(0, 100),
        href: t.closest('a')?.href,
        semanticParent: t.closest('section,article,main,nav')?.tagName.toLowerCase() ?? 'body',
      },
      pageUrl: location.href,
    });
  };
  document.addEventListener('click', onClick, { passive: true });
  cleanupFns.push(() => document.removeEventListener('click', onClick));

  // Hover dwell
  const hoverTimers = new Map<EventTarget, number>();
  const onEnter = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t?.matches?.('section,article,div,aside')) return;
    hoverTimers.set(t, window.setTimeout(() => {
      callback({
        type: 'hover_dwell',
        timestamp: new Date().toISOString(),
        data: { selector: t.id ? `#${t.id}` : t.tagName.toLowerCase(), dwellMs: HOVER_DWELL_THRESHOLD_MS },
        pageUrl: location.href,
      });
      hoverTimers.delete(t);
    }, HOVER_DWELL_THRESHOLD_MS));
  };
  const onLeave = (e: MouseEvent) => {
    const timer = hoverTimers.get(e.target as EventTarget);
    if (timer !== undefined) { clearTimeout(timer); hoverTimers.delete(e.target as EventTarget); }
  };
  document.addEventListener('mouseenter', onEnter, { passive: true, capture: true });
  document.addEventListener('mouseleave', onLeave, { passive: true, capture: true });
  cleanupFns.push(() => {
    document.removeEventListener('mouseenter', onEnter, { capture: true });
    document.removeEventListener('mouseleave', onLeave, { capture: true });
  });

  // Navigation (SPA support)
  let currentUrl = location.href;
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  const onNav = (method: 'pushstate' | 'popstate') => {
    if (location.href !== currentUrl) {
      callback({
        type: 'navigation',
        timestamp: new Date().toISOString(),
        data: { from: currentUrl, to: location.href, method },
        pageUrl: location.href,
      });
      currentUrl = location.href;
    }
  };
  history.pushState = function (...args) { origPush(...args); onNav('pushstate'); };
  history.replaceState = function (...args) { origReplace(...args); onNav('pushstate'); };
  const onPopstate = () => onNav('popstate');
  window.addEventListener('popstate', onPopstate);
  cleanupFns.push(() => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', onPopstate);
  });

  return () => { for (const fn of cleanupFns) fn(); };
}

// ---------------------------------------------------------------------------
// Block injection (CC-4.2.3 — same DOM manipulation as extension)
// ---------------------------------------------------------------------------

function injectBlocks(blocks: BlockReplacement[]): void {
  for (const block of blocks) {
    const target = document.querySelector(block.selector);
    if (!target || !(target instanceof HTMLElement)) continue;

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-glow-injected', 'true');
    wrapper.style.cssText = `position:relative;min-height:${target.getBoundingClientRect().height}px;overflow:hidden;opacity:0;transition:opacity 200ms`;
    wrapper.innerHTML = block.html;

    // AI badge
    const badge = document.createElement('span');
    badge.innerHTML = '✦';
    badge.title = `Glow · ${block.model} · ${block.generationTimeMs}ms`;
    badge.style.cssText = 'position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(139,92,246,0.85);color:#fff;font-size:10px;line-height:20px;text-align:center;z-index:10000;opacity:0.6';
    wrapper.appendChild(badge);

    target.style.transition = 'opacity 200ms';
    target.style.opacity = '0';

    setTimeout(() => {
      target.style.opacity = '';
      target.style.transition = '';
      target.innerHTML = '';
      target.appendChild(wrapper);
      requestAnimationFrame(() => { wrapper.style.opacity = '1'; });
    }, 200);
  }
}

// ---------------------------------------------------------------------------
// Consent integration (CC-4.2.5)
// ---------------------------------------------------------------------------

function waitForConsent(): Promise<void> {
  return new Promise((resolve) => {
    // Check for common consent frameworks
    const win = window as Record<string, unknown>;

    // OneTrust
    if (typeof win.OneTrust === 'object') {
      const check = () => {
        if (document.cookie.includes('OptanonConsent') &&
            document.cookie.includes('isGpcEnabled=0')) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
      return;
    }

    // CookieBot
    if (typeof win.Cookiebot === 'object') {
      window.addEventListener('CookiebotOnAccept', () => resolve(), { once: true });
      return;
    }

    // Custom callback: window.glowConsent()
    (window as Record<string, unknown>).glowConsent = resolve;

    // Fallback: resolve after 5s if no consent framework detected
    setTimeout(resolve, 5000);
  });
}

// ---------------------------------------------------------------------------
// Main initialization
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const config = readConfig();
  if (!config) return;

  // CC-4.2.5: Wait for consent if required
  if (config.consent) {
    await waitForConsent();
  }

  const sessionId = getSessionId();
  const buffer: Signal[] = [];
  let batchTimer: number | null = null;

  // Flush signals to Worker and receive blocks
  const flush = async () => {
    if (buffer.length === 0) return;
    batchTimer = null;

    const signals = buffer.splice(0);
    renewSession(sessionId);

    try {
      // Send signals
      await fetch(`${config.endpoint}/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          siteId: config.siteId,
          signals,
          pageUrl: location.href,
        }),
        keepalive: true,
      });

      // Request blocks
      const blocksUrl = new URL(`${config.endpoint}/blocks`);
      blocksUrl.searchParams.set('sessionId', sessionId);
      blocksUrl.searchParams.set('siteId', config.siteId);
      blocksUrl.searchParams.set('pageUrl', location.href);

      const blocksResponse = await fetch(blocksUrl.toString(), {
        headers: { 'X-Session-Id': sessionId },
      });

      if (blocksResponse.ok) {
        const data = (await blocksResponse.json()) as {
          blocks: BlockReplacement[];
        };
        if (data.blocks?.length > 0) {
          injectBlocks(data.blocks);
        }
      }
    } catch {
      // Silent fail — don't break the host page
    }
  };

  // Collect signals with batching
  const stopCollecting = collectSignals((signal) => {
    buffer.push(signal);
    if (batchTimer === null) {
      batchTimer = window.setTimeout(flush, SIGNAL_BATCH_INTERVAL_MS);
    }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopCollecting();
    if (batchTimer !== null) clearTimeout(batchTimer);
    // Fire final batch with keepalive
    if (buffer.length > 0) {
      navigator.sendBeacon?.(
        `${config.endpoint}/signals`,
        JSON.stringify({
          sessionId,
          siteId: config.siteId,
          signals: buffer,
          pageUrl: location.href,
        }),
      );
    }
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
