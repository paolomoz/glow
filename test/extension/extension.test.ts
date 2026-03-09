// test/extension/extension.test.ts — Tests for extension components
// Tests pure-logic modules that don't require actual Chrome/DOM APIs

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../extension/background/session.js';
import type { ExtensionMessage, IconState, SignalBatchMessage } from '../../extension/background/messages.js';
import type { Signal, IntentVector } from '@glow/core';
import { SESSION_TIMEOUT_MS, SIGNAL_BATCH_INTERVAL_MS } from '@glow/core';
import { buildSelector, findSemanticParent } from '../../extension/content-script/signals.js';

// ---------------------------------------------------------------------------
// Session Manager tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('creates a new session for a tab', () => {
    const session = manager.getSession(1, 'example.com');
    expect(session.tabId).toBe(1);
    expect(session.siteId).toBe('example.com');
    expect(session.sessionId).toMatch(/^ext-1-/);
    expect(session.signalCount).toBe(0);
    expect(session.intent).toBeNull();
  });

  it('returns the same session for the same tab and site', () => {
    const s1 = manager.getSession(1, 'example.com');
    const s2 = manager.getSession(1, 'example.com');
    expect(s1.sessionId).toBe(s2.sessionId);
  });

  it('creates a new session when site changes', () => {
    const s1 = manager.getSession(1, 'example.com');
    const s2 = manager.getSession(1, 'other.com');
    expect(s1.sessionId).not.toBe(s2.sessionId);
    expect(s2.siteId).toBe('other.com');
  });

  it('updates intent on a session', () => {
    manager.getSession(1, 'example.com');

    const intent: IntentVector = {
      sessionId: 'ext-1-123',
      archetype: 'explore',
      confidence: 0.7,
      topicEmbedding: [],
      audienceMode: 'novice',
      contentDepth: 'overview',
      emotionalRegister: 'rational',
      signalCount: 5,
      history: [],
      updatedAt: new Date().toISOString(),
    };

    manager.updateIntent(1, intent);
    const session = manager.getSession(1, 'example.com');
    expect(session.intent).toBe(intent);
    expect(session.signalCount).toBe(5);
  });

  it('records block generation', () => {
    manager.getSession(1, 'example.com');
    manager.recordGeneration(1);
    manager.recordGeneration(1);
    const session = manager.getSession(1, 'example.com');
    expect(session.generatedBlocks).toBe(2);
  });

  it('removes sessions for closed tabs', () => {
    const s1 = manager.getSession(1, 'example.com');
    manager.removeSession(1);
    const s2 = manager.getSession(1, 'example.com');
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it('cleans up expired sessions', () => {
    const session = manager.getSession(1, 'example.com');
    // Manually expire the session
    (session as any).lastActivity = Date.now() - SESSION_TIMEOUT_MS - 1000;

    manager.cleanExpired();

    // Should create a new session since old one was cleaned
    const newSession = manager.getSession(1, 'example.com');
    expect(newSession.sessionId).not.toBe(session.sessionId);
  });
});

// ---------------------------------------------------------------------------
// Message types tests
// ---------------------------------------------------------------------------

describe('Extension message types', () => {
  it('SIGNAL_BATCH message has correct shape', () => {
    const msg: SignalBatchMessage = {
      type: 'SIGNAL_BATCH',
      signals: [
        {
          type: 'page_visit',
          timestamp: new Date().toISOString(),
          data: { url: 'https://example.com', referrer: '', title: 'Test' },
          pageUrl: 'https://example.com',
        },
      ],
      pageUrl: 'https://example.com',
    };

    expect(msg.type).toBe('SIGNAL_BATCH');
    expect(msg.signals).toHaveLength(1);
    expect(msg.signals[0].type).toBe('page_visit');
  });

  it('all icon states are defined', () => {
    const states: IconState[] = ['inactive', 'indexing', 'active', 'generating'];
    expect(states).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Signal collector helpers tests (DOM utilities)
// ---------------------------------------------------------------------------

describe('Signal collector utilities', () => {
  // These tests use jsdom (provided by vitest)

  describe('buildSelector', () => {
    it('uses id when available', () => {
      const el = document.createElement('div');
      el.id = 'test-el';
      document.body.appendChild(el);

      expect(buildSelector(el)).toBe('#test-el');
      el.remove();
    });

    it('builds path for elements without id', () => {
      const parent = document.createElement('section');
      parent.id = 'parent';
      const child = document.createElement('p');
      parent.appendChild(child);
      document.body.appendChild(parent);

      const selector = buildSelector(child);
      expect(selector).toBe('#parent > p');

      parent.remove();
    });

    it('uses nth-of-type for siblings', () => {
      const parent = document.createElement('div');
      parent.id = 'container';
      const p1 = document.createElement('p');
      const p2 = document.createElement('p');
      parent.appendChild(p1);
      parent.appendChild(p2);
      document.body.appendChild(parent);

      const selector = buildSelector(p2);
      expect(selector).toBe('#container > p:nth-of-type(2)');

      parent.remove();
    });
  });

  describe('findSemanticParent', () => {
    it('finds nearest semantic parent', () => {
      const section = document.createElement('section');
      section.id = 'sec';
      const div = document.createElement('div');
      const span = document.createElement('span');
      div.appendChild(span);
      section.appendChild(div);
      document.body.appendChild(section);

      const result = findSemanticParent(span);
      expect(result).toBe('#sec');

      section.remove();
    });

    it('returns body when no semantic parent', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      div.appendChild(span);
      document.body.appendChild(div);

      const result = findSemanticParent(span);
      expect(result).toBe('body');

      div.remove();
    });
  });
});

// ---------------------------------------------------------------------------
// SPA Observer tests
// ---------------------------------------------------------------------------

describe('SPAObserver', () => {
  it('can be imported and constructed', async () => {
    const { SPAObserver } = await import(
      '../../extension/content-script/observer.js'
    );
    const callback = vi.fn();
    const observer = new SPAObserver(callback);
    expect(observer).toBeDefined();

    // Start and stop without error
    observer.start();
    observer.stop();
  });
});

// ---------------------------------------------------------------------------
// Panel component tests
// ---------------------------------------------------------------------------

describe('Panel components', () => {
  describe('renderIntentMeter', () => {
    it('renders intent data into container', async () => {
      const { renderIntentMeter } = await import(
        '../../extension/panel/components/intent-meter.js'
      );

      const container = document.createElement('div');
      const intent: IntentVector = {
        sessionId: 'test-session',
        archetype: 'explore',
        confidence: 0.75,
        topicEmbedding: [],
        audienceMode: 'intermediate',
        contentDepth: 'detailed',
        emotionalRegister: 'rational',
        signalCount: 12,
        history: [],
        updatedAt: new Date().toISOString(),
      };

      renderIntentMeter(container, intent);

      expect(container.innerHTML).toContain('75%');
      expect(container.innerHTML).toContain('explore');
      expect(container.innerHTML).toContain('moderate');
      expect(container.innerHTML).toContain('12');
      expect(container.innerHTML).toContain('detailed');
      expect(container.innerHTML).toContain('intermediate');
    });

    it('shows none level for low confidence', async () => {
      const { renderIntentMeter } = await import(
        '../../extension/panel/components/intent-meter.js'
      );

      const container = document.createElement('div');
      const intent: IntentVector = {
        sessionId: 'test',
        archetype: 'compare',
        confidence: 0.2,
        topicEmbedding: [],
        audienceMode: 'novice',
        contentDepth: 'overview',
        emotionalRegister: 'rational',
        signalCount: 2,
        history: [],
        updatedAt: new Date().toISOString(),
      };

      renderIntentMeter(container, intent);
      expect(container.innerHTML).toContain('none');
    });

    it('shows full level for high confidence', async () => {
      const { renderIntentMeter } = await import(
        '../../extension/panel/components/intent-meter.js'
      );

      const container = document.createElement('div');
      const intent: IntentVector = {
        sessionId: 'test',
        archetype: 'seek_action',
        confidence: 0.95,
        topicEmbedding: [],
        audienceMode: 'expert',
        contentDepth: 'comprehensive',
        emotionalRegister: 'urgent',
        signalCount: 30,
        history: [],
        updatedAt: new Date().toISOString(),
      };

      renderIntentMeter(container, intent);
      expect(container.innerHTML).toContain('full');
      expect(container.innerHTML).toContain('95%');
    });
  });

  describe('appendSignalEntry', () => {
    it('appends signal entries to log', async () => {
      const { appendSignalEntry } = await import(
        '../../extension/panel/components/signal-log.js'
      );

      const container = document.createElement('div');
      container.innerHTML = '<div class="empty-state">No signals yet</div>';

      const signal: Signal = {
        type: 'page_visit',
        timestamp: new Date().toISOString(),
        data: { url: 'https://example.com', referrer: '', title: 'Test Page' },
        pageUrl: 'https://example.com',
      };

      appendSignalEntry(container, signal);

      // Empty state should be removed
      expect(container.querySelector('.empty-state')).toBeNull();
      // Signal entry should be added
      expect(container.querySelectorAll('.signal-entry')).toHaveLength(1);
      expect(container.innerHTML).toContain('page_visit');
      expect(container.innerHTML).toContain('Test Page');
    });

    it('prepends new entries (newest first)', async () => {
      const { appendSignalEntry } = await import(
        '../../extension/panel/components/signal-log.js'
      );

      const container = document.createElement('div');

      appendSignalEntry(container, {
        type: 'page_visit',
        timestamp: new Date().toISOString(),
        data: { url: '', referrer: '', title: 'First' },
        pageUrl: '',
      });

      appendSignalEntry(container, {
        type: 'click_target',
        timestamp: new Date().toISOString(),
        data: { selector: '.btn', text: 'Click Me', semanticParent: 'body' },
        pageUrl: '',
      });

      const entries = container.querySelectorAll('.signal-entry');
      expect(entries).toHaveLength(2);
      // Most recent should be first
      expect(entries[0].innerHTML).toContain('click_target');
      expect(entries[1].innerHTML).toContain('page_visit');
    });
  });

  describe('renderBlockList', () => {
    it('shows empty state when no blocks', async () => {
      const { renderBlockList } = await import(
        '../../extension/panel/components/block-map.js'
      );

      const container = document.createElement('div');
      renderBlockList(container, []);
      expect(container.innerHTML).toContain('No blocks generated');
    });

    it('renders block entries', async () => {
      const { renderBlockList } = await import(
        '../../extension/panel/components/block-map.js'
      );

      const container = document.createElement('div');
      renderBlockList(container, [
        {
          block: {
            selector: '[data-template-id="hero-1"]',
            html: '<div>Hello</div>',
            templateId: 'hero-1',
            atomIds: ['a1', 'a2'],
            generationTimeMs: 450,
            model: 'gpt-oss-120b',
            confidence: 0.85,
          },
          pageUrl: 'https://example.com',
          timestamp: Date.now(),
        },
      ]);

      expect(container.querySelectorAll('.block-item')).toHaveLength(1);
      expect(container.innerHTML).toContain('hero-1');
      expect(container.innerHTML).toContain('gpt-oss-120b');
      expect(container.innerHTML).toContain('450ms');
    });
  });

  describe('renderTimingBreakdown', () => {
    it('shows empty state when no blocks', async () => {
      const { renderTimingBreakdown } = await import(
        '../../extension/panel/components/timing-breakdown.js'
      );

      const container = document.createElement('div');
      renderTimingBreakdown(container, [], 0);
      expect(container.innerHTML).toContain('No timing data');
    });

    it('renders timing bars for blocks', async () => {
      const { renderTimingBreakdown } = await import(
        '../../extension/panel/components/timing-breakdown.js'
      );

      const container = document.createElement('div');
      renderTimingBreakdown(
        container,
        [
          {
            selector: '.hero',
            html: '<div></div>',
            templateId: 'hero-block',
            atomIds: [],
            generationTimeMs: 800,
            model: 'gpt-oss-120b',
            confidence: 0.9,
          },
          {
            selector: '.mid',
            html: '<div></div>',
            templateId: 'mid-block',
            atomIds: [],
            generationTimeMs: 500,
            model: 'glm-4.7-flash',
            confidence: 0.7,
          },
        ],
        1300,
      );

      const bars = container.querySelectorAll('.timing-bar');
      // 1 total + 2 per-block
      expect(bars).toHaveLength(3);
      expect(container.innerHTML).toContain('1300ms');
      expect(container.innerHTML).toContain('800ms');
      expect(container.innerHTML).toContain('500ms');
      expect(container.innerHTML).toContain('Budget: 2500ms');
    });
  });
});

// ---------------------------------------------------------------------------
// Injector pure-logic tests
// ---------------------------------------------------------------------------

describe('Block injector', () => {
  it('exports expected functions', async () => {
    const mod = await import('../../extension/content-script/injector.js');
    expect(typeof mod.injectBlocks).toBe('function');
    expect(typeof mod.restoreAll).toBe('function');
    expect(typeof mod.isInjected).toBe('function');
  });

  it('isInjected returns false for non-injected selectors', async () => {
    const { isInjected } = await import(
      '../../extension/content-script/injector.js'
    );
    expect(isInjected('.nonexistent')).toBe(false);
  });
});
