// worker/storage/cache-strategy.ts — Speculative pre-generation + TTL management
// CC-4.3: Cache-first serving, background pre-gen, cache invalidation

import type {
  IntentVector,
  BlockReplacement,
} from '@glow/core';
import {
  SPECULATIVE_CACHE_TTL_SECONDS,
  HIGH_CONFIDENCE_THRESHOLD,
} from '@glow/core';

interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CachedBlocks {
  blocks: BlockReplacement[];
  intent: IntentVector;
  generatedAt: number;
}

/**
 * Manages speculative pre-generation cache.
 */
export class CacheStrategy {
  constructor(private cacheKV: KVNamespace) {}

  /**
   * Check cache for pre-generated blocks.
   * Returns null on miss or if intent has shifted significantly.
   */
  async getCached(
    sessionId: string,
    pageUrl: string,
    currentIntent: IntentVector | null,
  ): Promise<CachedBlocks | null> {
    const key = this.buildKey(sessionId, pageUrl);
    const cached = (await this.cacheKV.get(key, { type: 'json' })) as CachedBlocks | null;

    if (!cached) return null;

    // CC-4.3.4: Invalidate if intent has shifted significantly
    if (currentIntent && this.hasIntentShifted(cached.intent, currentIntent)) {
      await this.cacheKV.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Store pre-generated blocks in cache.
   */
  async setCached(
    sessionId: string,
    pageUrl: string,
    blocks: BlockReplacement[],
    intent: IntentVector,
  ): Promise<void> {
    const key = this.buildKey(sessionId, pageUrl);
    const entry: CachedBlocks = {
      blocks,
      intent,
      generatedAt: Date.now(),
    };
    await this.cacheKV.put(key, JSON.stringify(entry), {
      expirationTtl: SPECULATIVE_CACHE_TTL_SECONDS,
    });
  }

  /**
   * Invalidate cache for a session (e.g., on significant intent shift).
   */
  async invalidateSession(sessionId: string, pageUrls: string[]): Promise<void> {
    await Promise.all(
      pageUrls.map((url) => this.cacheKV.delete(this.buildKey(sessionId, url))),
    );
  }

  /**
   * CC-4.3.1: Predict top 3 likely next pages based on session history.
   */
  predictNextPages(
    pageHistory: string[],
    currentUrl: string,
    siteLinks: string[],
  ): string[] {
    if (siteLinks.length === 0) return [];

    const scores = new Map<string, number>();

    for (const link of siteLinks) {
      if (link === currentUrl) continue;
      if (pageHistory.includes(link)) continue; // Already visited

      let score = 0;

      // Navigation pattern analysis
      if (pageHistory.length >= 2) {
        const lastPages = pageHistory.slice(-3);
        const pattern = detectPattern(lastPages);

        if (pattern === 'linear') {
          // Predict next in sequence — prefer links that follow URL structure
          const currentPath = new URL(currentUrl).pathname;
          const linkPath = new URL(link).pathname;
          if (isSequentialPath(currentPath, linkPath)) {
            score += 3;
          }
        } else if (pattern === 'branching') {
          // Predict siblings — pages at the same depth
          const currentDepth = new URL(currentUrl).pathname.split('/').length;
          const linkDepth = new URL(link).pathname.split('/').length;
          if (linkDepth === currentDepth) {
            score += 2;
          }
        }
      }

      // Prefer links that share path prefix with current page
      try {
        const currentParts = new URL(currentUrl).pathname.split('/');
        const linkParts = new URL(link).pathname.split('/');
        let shared = 0;
        for (let i = 0; i < Math.min(currentParts.length, linkParts.length); i++) {
          if (currentParts[i] === linkParts[i]) shared++;
          else break;
        }
        score += shared * 0.5;
      } catch {
        // Invalid URL, skip
      }

      scores.set(link, score);
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([url]) => url);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildKey(sessionId: string, pageUrl: string): string {
    return `pregen:${sessionId}:${pageUrl}`;
  }

  /**
   * Detect significant intent shifts that invalidate cached blocks.
   */
  private hasIntentShifted(
    cached: IntentVector,
    current: IntentVector,
  ): boolean {
    // Archetype changed
    if (cached.archetype !== current.archetype) return true;

    // Confidence dropped significantly
    if (current.confidence < cached.confidence - 0.3) return true;

    // Content depth shifted
    if (cached.contentDepth !== current.contentDepth) return true;

    return false;
  }
}

// ---------------------------------------------------------------------------
// Navigation pattern detection
// ---------------------------------------------------------------------------

function detectPattern(pages: string[]): 'linear' | 'branching' | 'unknown' {
  if (pages.length < 2) return 'unknown';

  try {
    const depths = pages.map((p) => new URL(p).pathname.split('/').length);
    const allSameDepth = depths.every((d) => d === depths[0]);

    if (allSameDepth) return 'branching';

    // Check if depths are monotonically increasing
    const increasing = depths.every(
      (d, i) => i === 0 || d >= depths[i - 1],
    );
    if (increasing) return 'linear';
  } catch {
    // Invalid URLs
  }

  return 'unknown';
}

function isSequentialPath(current: string, candidate: string): boolean {
  // Check if paths suggest a sequence (e.g., /docs/chapter-1 → /docs/chapter-2)
  const currentParts = current.split('/');
  const candidateParts = candidate.split('/');

  if (currentParts.length !== candidateParts.length) return false;

  // All parts must match except the last
  for (let i = 0; i < currentParts.length - 1; i++) {
    if (currentParts[i] !== candidateParts[i]) return false;
  }

  // Last parts should differ
  return currentParts[currentParts.length - 1] !== candidateParts[candidateParts.length - 1];
}
