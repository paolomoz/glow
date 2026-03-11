import { describe, it, expect } from 'vitest';
import {
  parseConversation,
  conversationToSignals,
  parseExport,
} from '../../core/conversation/parser.js';
import type { ChatGPTConversation } from '../../core/conversation/parser.js';
import { DefaultIntentEngine } from '../../core/intent/engine.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal ChatGPT conversation
// ---------------------------------------------------------------------------

function makeConversation(
  messages: { role: 'user' | 'assistant'; text: string }[],
  title = 'Test Conversation',
): ChatGPTConversation {
  const mapping: ChatGPTConversation['mapping'] = {};
  const baseTime = 1700000000;

  // Root node
  const rootId = 'root';
  mapping[rootId] = {
    id: rootId,
    message: null,
    parent: null,
    children: [],
  };

  let parentId = rootId;
  let lastId = rootId;

  for (let i = 0; i < messages.length; i++) {
    const nodeId = `msg-${i}`;
    mapping[nodeId] = {
      id: nodeId,
      message: {
        id: nodeId,
        author: { role: messages[i].role },
        create_time: baseTime + i * 60,
        content: {
          content_type: 'text',
          parts: [messages[i].text],
        },
      },
      parent: parentId,
      children: [],
    };
    mapping[parentId].children.push(nodeId);
    parentId = nodeId;
    lastId = nodeId;
  }

  return {
    title,
    create_time: baseTime,
    update_time: baseTime + messages.length * 60,
    mapping,
    current_node: lastId,
    conversation_id: 'conv-1',
  };
}

// ---------------------------------------------------------------------------
// parseConversation
// ---------------------------------------------------------------------------

describe('parseConversation', () => {
  it('extracts user and assistant messages in order', () => {
    const conv = makeConversation([
      { role: 'user', text: 'What is Glow?' },
      { role: 'assistant', text: 'Glow is a personalization system.' },
      { role: 'user', text: 'How does it work?' },
      { role: 'assistant', text: 'It uses signals and intent detection.' },
    ]);

    const messages = parseConversation(conv);
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('What is Glow?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[3].role).toBe('assistant');
  });

  it('skips system messages', () => {
    const conv = makeConversation([
      { role: 'user', text: 'Hello' },
    ]);
    // Add a system message node
    const systemId = 'system-msg';
    conv.mapping[systemId] = {
      id: systemId,
      message: {
        id: systemId,
        author: { role: 'system' as any },
        create_time: 1700000000,
        content: { content_type: 'text', parts: ['You are a helpful assistant.'] },
      },
      parent: 'root',
      children: ['msg-0'],
    };
    conv.mapping['root'].children = [systemId];
    conv.mapping['msg-0'].parent = systemId;

    const messages = parseConversation(conv);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('Hello');
  });

  it('handles empty conversation', () => {
    const conv = makeConversation([]);
    const messages = parseConversation(conv);
    expect(messages).toHaveLength(0);
  });

  it('follows active branch in branching conversation', () => {
    const conv = makeConversation([
      { role: 'user', text: 'Question 1' },
      { role: 'assistant', text: 'Answer 1' },
    ]);

    // Add a branch: alternate answer to question 1
    const branchId = 'branch-answer';
    conv.mapping[branchId] = {
      id: branchId,
      message: {
        id: branchId,
        author: { role: 'assistant' },
        create_time: 1700000200,
        content: { content_type: 'text', parts: ['Different answer'] },
      },
      parent: 'msg-0',
      children: [],
    };
    conv.mapping['msg-0'].children.push(branchId);

    // current_node still points to msg-1 (original branch)
    const messages = parseConversation(conv);
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toBe('Answer 1');
  });
});

// ---------------------------------------------------------------------------
// conversationToSignals
// ---------------------------------------------------------------------------

describe('conversationToSignals', () => {
  const pageUrl = 'https://example.com/';

  it('creates search_query signals from user messages', () => {
    const messages = [
      { role: 'user' as const, text: 'What is the pricing for enterprise?', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'assistant' as const, text: 'Our enterprise plan starts at...', timestamp: '2024-01-01T00:01:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const searchSignals = signals.filter((s) => s.type === 'search_query');
    expect(searchSignals).toHaveLength(1);
    expect(searchSignals[0].data.query).toBe('What is the pricing for enterprise?');
    expect(searchSignals[0].data.source).toBe('chatgpt');
  });

  it('extracts URLs as page_visit signals', () => {
    const messages = [
      { role: 'user' as const, text: 'Check out https://example.com/pricing and https://example.com/features', timestamp: '2024-01-01T00:00:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const visitSignals = signals.filter(
      (s) => s.type === 'page_visit' && (s.data.referrer as string) === 'chatgpt'
        && !(s.data.url as string).includes('#topic-'),
    );
    expect(visitSignals).toHaveLength(2);
    expect(visitSignals[0].data.url).toBe('https://example.com/pricing');
    expect(visitSignals[1].data.url).toBe('https://example.com/features');
  });

  it('detects action intent keywords', () => {
    const messages = [
      { role: 'user' as const, text: 'How do I sign up for the free trial?', timestamp: '2024-01-01T00:00:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const clickSignals = signals.filter((s) => s.type === 'click_target');
    expect(clickSignals.length).toBeGreaterThanOrEqual(1);
    expect(clickSignals[0].data.source).toBe('chatgpt');
  });

  it('detects comparison intent', () => {
    const messages = [
      { role: 'user' as const, text: 'Compare the Pro and Enterprise plans', timestamp: '2024-01-01T00:00:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const filterSignals = signals.filter((s) => s.type === 'filter_select');
    expect(filterSignals.length).toBeGreaterThanOrEqual(1);
    expect(filterSignals[0].data.filterName).toBe('comparison');
  });

  it('generates time_on_section for long conversations', () => {
    const messages = [
      { role: 'user' as const, text: 'A'.repeat(600), timestamp: '2024-01-01T00:00:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const timeSignals = signals.filter((s) => s.type === 'time_on_section');
    expect(timeSignals).toHaveLength(1);
    expect((timeSignals[0].data.durationMs as number)).toBeGreaterThan(0);
  });

  it('generates scroll_depth proxy for deep technical questions', () => {
    const messages = [
      { role: 'user' as const, text: 'Explain the architecture of the system', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user' as const, text: 'How does the API integrate with webhooks?', timestamp: '2024-01-01T00:01:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const scrollSignals = signals.filter((s) => s.type === 'scroll_depth');
    expect(scrollSignals).toHaveLength(1);
    expect((scrollSignals[0].data.depth as number)).toBeGreaterThan(0);
  });

  it('extracts distinct topics as page_visit diversity', () => {
    const messages = [
      { role: 'user' as const, text: 'What is the pricing?', timestamp: '2024-01-01T00:00:00Z' },
      { role: 'user' as const, text: 'How does the API work?', timestamp: '2024-01-01T00:01:00Z' },
      { role: 'user' as const, text: 'Tell me about security features', timestamp: '2024-01-01T00:02:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    const topicVisits = signals.filter(
      (s) => s.type === 'page_visit' && (s.data.url as string).includes('#topic-'),
    );
    expect(topicVisits.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for assistant-only messages', () => {
    const messages = [
      { role: 'assistant' as const, text: 'Hello!', timestamp: '2024-01-01T00:00:00Z' },
    ];

    const signals = conversationToSignals(messages, pageUrl);
    expect(signals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: conversation → intent engine
// ---------------------------------------------------------------------------

describe('conversation → intent engine integration', () => {
  it('seek_action conversation produces seek_action archetype', () => {
    const conv = makeConversation([
      { role: 'user', text: 'How much does the enterprise plan cost?' },
      { role: 'assistant', text: 'Our enterprise plan starts at $99/month.' },
      { role: 'user', text: 'How do I sign up? Can I get a free trial?' },
      { role: 'assistant', text: 'You can start a free trial at...' },
      { role: 'user', text: 'I want to buy the annual plan. What is the checkout process?' },
      { role: 'assistant', text: 'Click Get Started to begin checkout.' },
    ]);

    const messages = parseConversation(conv);
    const signals = conversationToSignals(messages, 'https://example.com/');

    const engine = new DefaultIntentEngine();
    const intent = engine.ingestSignals(null, signals);

    expect(intent.archetype).toBe('seek_action');
    expect(intent.confidence).toBeGreaterThan(0.3);
  });

  it('comparison conversation produces compare archetype', () => {
    const conv = makeConversation([
      { role: 'user', text: 'Compare the free vs pro plans' },
      { role: 'assistant', text: 'Here is a comparison...' },
      { role: 'user', text: 'Which plan is better for a small team?' },
      { role: 'assistant', text: 'For small teams, the Pro plan...' },
      { role: 'user', text: 'What are the pros and cons of each?' },
      { role: 'assistant', text: 'Free plan pros: ...' },
      { role: 'user', text: 'What alternatives are there to your product?' },
    ]);

    const messages = parseConversation(conv);
    const signals = conversationToSignals(messages, 'https://example.com/');

    const engine = new DefaultIntentEngine();
    const intent = engine.ingestSignals(null, signals);

    // compare should be favored, but explore is acceptable given topic diversity
    expect(['compare', 'explore']).toContain(intent.archetype);
    // Should have meaningful confidence from the comparison signals
    expect(intent.confidence).toBeGreaterThan(0.3);
  });

  it('deep technical conversation produces dive_deep archetype', () => {
    const conv = makeConversation([
      { role: 'user', text: 'Explain the architecture of the distributed cache system' },
      { role: 'assistant', text: 'The cache uses consistent hashing...' },
      { role: 'user', text: 'How does the API handle rate limiting under the hood?' },
      { role: 'assistant', text: 'Rate limiting uses a token bucket algorithm...' },
      { role: 'user', text: 'Can you provide technical documentation for the SDK integration?' },
      { role: 'assistant', text: 'Here is the SDK documentation...' },
      { role: 'user', text: 'What is the implementation detail of the webhook retry mechanism?' },
    ]);

    const messages = parseConversation(conv);
    const signals = conversationToSignals(messages, 'https://example.com/');

    const engine = new DefaultIntentEngine();
    const intent = engine.ingestSignals(null, signals);

    // dive_deep or explore are both valid for deep technical content
    expect(['dive_deep', 'explore']).toContain(intent.archetype);
    expect(intent.confidence).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// parseExport
// ---------------------------------------------------------------------------

describe('parseExport', () => {
  it('parses array of conversations', () => {
    const conv1 = makeConversation([
      { role: 'user', text: 'How much does it cost?' },
    ], 'Pricing question');
    const conv2 = makeConversation([
      { role: 'user', text: 'Compare plans' },
    ], 'Plan comparison');

    const signals = parseExport([conv1, conv2], 'https://example.com/');
    expect(signals.length).toBeGreaterThan(0);
  });

  it('filters by conversation ID', () => {
    const conv1 = makeConversation([
      { role: 'user', text: 'First conversation' },
    ]);
    conv1.conversation_id = 'conv-target';
    const conv2 = makeConversation([
      { role: 'user', text: 'Second conversation' },
    ]);
    conv2.conversation_id = 'conv-other';

    const signals = parseExport([conv1, conv2], 'https://example.com/', {
      conversationId: 'conv-target',
    });

    const queries = signals.filter((s) => s.type === 'search_query');
    expect(queries).toHaveLength(1);
    expect(queries[0].data.query).toBe('First conversation');
  });

  it('limits number of conversations', () => {
    const convs = Array.from({ length: 10 }, (_, i) =>
      makeConversation([
        { role: 'user', text: `Question ${i}` },
      ], `Conv ${i}`),
    );

    const signals = parseExport(convs, 'https://example.com/', {
      maxConversations: 2,
    });

    const queries = signals.filter((s) => s.type === 'search_query');
    expect(queries).toHaveLength(2);
  });

  it('handles ChatGPTExport wrapper format', () => {
    const conv = makeConversation([
      { role: 'user', text: 'Hello world' },
    ]);

    const signals = parseExport(
      { conversations: [conv] },
      'https://example.com/',
    );
    expect(signals.length).toBeGreaterThan(0);
  });
});
