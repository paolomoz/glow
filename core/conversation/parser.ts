// core/conversation/parser.ts — Parse ChatGPT conversation exports into Glow signals
// Converts conversation messages into the existing Signal types so they feed
// directly into the intent engine without a parallel path.

import type { Signal, SignalType } from '../types.js';

// ---------------------------------------------------------------------------
// ChatGPT export types (observed structure, not officially documented)
// ---------------------------------------------------------------------------

export interface ChatGPTExport {
  conversations: ChatGPTConversation[];
}

export interface ChatGPTConversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ChatGPTNode>;
  current_node: string;
  conversation_id: string;
  default_model_slug?: string;
}

export interface ChatGPTNode {
  id: string;
  message: ChatGPTMessage | null;
  parent: string | null;
  children: string[];
}

export interface ChatGPTMessage {
  id: string;
  author: { role: 'system' | 'user' | 'assistant' | 'tool'; name?: string };
  create_time: number | null;
  content: {
    content_type: string;
    parts?: (string | Record<string, unknown>)[];
  };
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parsed message (flattened from tree)
// ---------------------------------------------------------------------------

export interface ParsedMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a ChatGPT conversation export into an ordered list of messages.
 * Handles the tree structure by following the active branch to current_node.
 */
export function parseConversation(conv: ChatGPTConversation): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  // Build path from root to current_node by walking parents backward
  const path: string[] = [];
  let nodeId: string | null = conv.current_node;
  while (nodeId) {
    path.unshift(nodeId);
    nodeId = conv.mapping[nodeId]?.parent ?? null;
  }

  for (const id of path) {
    const node = conv.mapping[id];
    if (!node?.message) continue;

    const msg = node.message;
    if (msg.author.role !== 'user' && msg.author.role !== 'assistant') continue;

    const text = extractText(msg);
    if (!text) continue;

    const timestamp = msg.create_time
      ? new Date(msg.create_time * 1000).toISOString()
      : new Date(conv.create_time * 1000).toISOString();

    messages.push({ role: msg.author.role, text, timestamp });
  }

  return messages;
}

/**
 * Extract plain text from a ChatGPT message content object.
 */
function extractText(msg: ChatGPTMessage): string {
  if (!msg.content?.parts) return '';
  return msg.content.parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Signal conversion
// ---------------------------------------------------------------------------

// Intent keyword patterns
const ACTION_PATTERNS = /\b(buy|purchase|sign.?up|subscribe|get.?started|register|download|try|free.?trial|add.?to.?cart|checkout|order|book|reserve|schedule|apply|pricing|cost|how much)\b/i;
const COMPARE_PATTERNS = /\b(compare|vs\.?|versus|difference|better|best|which|alternative|pros.?and.?cons|trade.?off|benchmark|review)\b/i;
const DEEP_PATTERNS = /\b(how does|explain|architecture|technical|implementation|under.?the.?hood|internals|deep.?dive|in.?depth|documentation|spec|api|sdk|integrate)\b/i;

/**
 * Convert a parsed ChatGPT conversation into Glow signals.
 * Maps user messages to existing signal types so the intent engine
 * can classify the visitor's archetype from conversation context.
 *
 * @param messages - Ordered conversation messages
 * @param pageUrl  - The page URL to associate signals with
 */
export function conversationToSignals(
  messages: ParsedMessage[],
  pageUrl: string,
): Signal[] {
  const signals: Signal[] = [];
  const userMessages = messages.filter((m) => m.role === 'user');

  if (userMessages.length === 0) return signals;

  // 1. Each user message → search_query signal
  for (const msg of userMessages) {
    signals.push({
      type: 'search_query',
      timestamp: msg.timestamp,
      data: {
        query: msg.text.slice(0, 500),
        source: 'chatgpt',
      },
      pageUrl,
    });
  }

  // 2. Extract URLs mentioned in user messages → page_visit signals
  const urlRegex = /https?:\/\/[^\s)>\]"']+/g;
  for (const msg of userMessages) {
    const urls = msg.text.match(urlRegex);
    if (urls) {
      for (const url of urls) {
        signals.push({
          type: 'page_visit',
          timestamp: msg.timestamp,
          data: { url, referrer: 'chatgpt', title: '' },
          pageUrl,
        });
      }
    }
  }

  // 3. Detect action-oriented language → click_target signals
  for (const msg of userMessages) {
    const actionMatch = msg.text.match(ACTION_PATTERNS);
    if (actionMatch) {
      signals.push({
        type: 'click_target',
        timestamp: msg.timestamp,
        data: {
          text: actionMatch[0],
          href: '',
          source: 'chatgpt',
          context: msg.text.slice(0, 200),
        },
        pageUrl,
      });
    }
  }

  // 4. Detect comparison language → click_target with comparison context
  for (const msg of userMessages) {
    const compareMatch = msg.text.match(COMPARE_PATTERNS);
    if (compareMatch) {
      signals.push({
        type: 'filter_select',
        timestamp: msg.timestamp,
        data: {
          filterName: 'comparison',
          value: compareMatch[0],
          source: 'chatgpt',
          context: msg.text.slice(0, 200),
        },
        pageUrl,
      });
    }
  }

  // 5. Long conversation → time_on_section proxy (deep engagement)
  const totalChars = userMessages.reduce((sum, m) => sum + m.text.length, 0);
  if (totalChars > 500) {
    // Estimate reading/typing time: ~200 chars/min typing + thinking
    const estimatedMs = Math.min(300000, (totalChars / 200) * 60000);
    signals.push({
      type: 'time_on_section',
      timestamp: userMessages[userMessages.length - 1].timestamp,
      data: {
        section: 'chatgpt-conversation',
        durationMs: estimatedMs,
      },
      pageUrl,
    });
  }

  // 6. Deep technical questions → scroll_depth proxy (depth of engagement)
  const deepCount = userMessages.filter((m) => DEEP_PATTERNS.test(m.text)).length;
  if (deepCount > 0) {
    signals.push({
      type: 'scroll_depth',
      timestamp: userMessages[userMessages.length - 1].timestamp,
      data: {
        depth: Math.min(1, deepCount * 0.3),
        maxDepth: Math.min(1, deepCount * 0.3),
      },
      pageUrl,
    });
  }

  // 7. Multiple distinct topics → page diversity via synthetic page_visits
  const topics = extractTopics(userMessages);
  for (let i = 0; i < topics.length; i++) {
    signals.push({
      type: 'page_visit',
      timestamp: userMessages[Math.min(i, userMessages.length - 1)].timestamp,
      data: {
        url: `${pageUrl}#topic-${i}`,
        referrer: 'chatgpt',
        title: topics[i],
      },
      pageUrl,
    });
  }

  return signals;
}

/**
 * Extract distinct topics from user messages using simple keyword clustering.
 * Groups messages by dominant noun phrases / question subjects.
 */
function extractTopics(messages: ParsedMessage[]): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];

  for (const msg of messages) {
    // Extract the first meaningful noun phrase or question subject
    const topic = extractTopicFromMessage(msg.text);
    if (topic && !seen.has(topic.toLowerCase())) {
      seen.add(topic.toLowerCase());
      topics.push(topic);
    }
  }

  return topics;
}

/**
 * Extract a topic label from a single message.
 * Uses simple heuristics: question words, "about X", first noun phrase.
 */
function extractTopicFromMessage(text: string): string | null {
  // "What is X", "How does X work", "Tell me about X"
  const questionMatch = text.match(
    /(?:what(?:'s| is| are)|how (?:does|do|to|can)|tell me about|explain|describe)\s+(.{3,50}?)(?:\?|$|\.|\band\b)/i,
  );
  if (questionMatch) return questionMatch[1].trim();

  // "I want to X", "I need X", "looking for X"
  const intentMatch = text.match(
    /(?:i (?:want|need|'m looking) (?:to |for )?|looking for\s+)(.{3,50}?)(?:\?|$|\.|\band\b)/i,
  );
  if (intentMatch) return intentMatch[1].trim();

  // Short messages (< 100 chars) are likely single-topic
  if (text.length < 100 && text.length > 5) {
    return text.replace(/[?.!]+$/, '').trim().slice(0, 50);
  }

  return null;
}

// ---------------------------------------------------------------------------
// High-level API
// ---------------------------------------------------------------------------

/**
 * Parse a full ChatGPT export file and convert all conversations
 * (or a specific one) into Glow signals.
 */
export function parseExport(
  data: ChatGPTConversation[] | ChatGPTExport,
  pageUrl: string,
  options?: { conversationId?: string; maxConversations?: number },
): Signal[] {
  const conversations = Array.isArray(data) ? data : data.conversations;
  const maxConvs = options?.maxConversations ?? 5;

  let filtered = conversations;
  if (options?.conversationId) {
    filtered = conversations.filter(
      (c) => c.conversation_id === options.conversationId,
    );
  }

  // Sort by most recent first, take top N
  filtered = filtered
    .sort((a, b) => b.update_time - a.update_time)
    .slice(0, maxConvs);

  const allSignals: Signal[] = [];
  for (const conv of filtered) {
    const messages = parseConversation(conv);
    const signals = conversationToSignals(messages, pageUrl);
    allSignals.push(...signals);
  }

  return allSignals;
}
