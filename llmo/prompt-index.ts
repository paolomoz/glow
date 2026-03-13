// llmo/prompt-index.ts — LLMO prompt index for verified ChatGPT prompts
// Parses lovesac-prompts.json and provides URL→prompts lookup + intent mapping

import type { IntentArchetype } from '@glow/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMOPrompt {
  prompt: string;
  topic: string;
  category: string;
  intent: string;
  type: string; // 'branded' | 'unbranded'
  url: string;
  referral: string;
}

export interface LLMOPromptIndex {
  byUrl: Map<string, LLMOPrompt[]>;
  all: LLMOPrompt[];
}

// ---------------------------------------------------------------------------
// URL normalization for fuzzy matching
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove trailing slash, lowercase, strip www prefix
    let host = u.hostname.replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

export function buildPromptIndex(prompts: LLMOPrompt[]): LLMOPromptIndex {
  const byUrl = new Map<string, LLMOPrompt[]>();

  for (const p of prompts) {
    const key = normalizeUrl(p.url);
    const existing = byUrl.get(key) ?? [];
    existing.push(p);
    byUrl.set(key, existing);
  }

  return { byUrl, all: prompts };
}

/**
 * Look up prompts matching a page URL (fuzzy: ignores www, trailing slashes).
 */
export function lookupPromptsByUrl(
  index: LLMOPromptIndex,
  pageUrl: string,
): LLMOPrompt[] {
  const key = normalizeUrl(pageUrl);

  // Exact match first
  const exact = index.byUrl.get(key);
  if (exact) return exact;

  // Partial path match — find URLs where the page URL starts with an indexed URL
  for (const [indexedKey, prompts] of index.byUrl) {
    if (key.startsWith(indexedKey) || indexedKey.startsWith(key)) {
      return prompts;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Intent mapping: LLMO intent → Glow archetype
// ---------------------------------------------------------------------------

const INTENT_MAP: Record<string, { archetype: IntentArchetype; confidence: number }> = {
  informational: { archetype: 'explore', confidence: 0.7 },
  comparative:   { archetype: 'compare', confidence: 0.8 },
  transactional: { archetype: 'seek_action', confidence: 0.8 },
  instructional: { archetype: 'dive_deep', confidence: 0.7 },
  planning:      { archetype: 'explore', confidence: 0.6 },
};

export function llmoIntentToArchetype(
  intent: string,
): { archetype: IntentArchetype; confidence: number } {
  return INTENT_MAP[intent.toLowerCase()] ?? { archetype: 'explore', confidence: 0.5 };
}
