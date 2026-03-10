// worker/routes/blocks.ts — GET /blocks endpoint
// CC-4.3.3: Cache-first block serving with on-demand generation fallback

import type {
  BlockReplacement,
  IntentVector,
  BrandProfile,
} from '@glow/core';
import {
  DefaultOrchestrator,
  DefaultIntentEngine,
  DefaultCerebrasClient,
  SPECULATIVE_CACHE_TTL_SECONDS,
} from '@glow/core';
import type { Env } from '../env.js';
import { json } from '../index.js';
import { KVStorageAdapter } from '../storage/kv-adapter.js';

export async function handleBlocks(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId') ??
    request.headers.get('X-Session-Id');
  const pageUrl = url.searchParams.get('pageUrl');
  const siteId = url.searchParams.get('siteId');

  if (!sessionId || !pageUrl || !siteId) {
    return json(
      { error: 'sessionId, pageUrl, and siteId required' },
      400,
    );
  }

  // 1. Check pre-generated cache first
  const cacheKey = buildCacheKey(sessionId, pageUrl);
  const cached = await env.CACHE_KV.get(cacheKey, { type: 'json' }) as {
    blocks: BlockReplacement[];
    intent: IntentVector;
  } | null;

  if (cached) {
    return json({
      blocks: cached.blocks,
      intent: cached.intent,
      totalTimeMs: 0,
      cacheHit: true,
    });
  }

  // 2. Get intent from Durable Object
  const doId = env.USER_SESSION.idFromName(sessionId);
  const stub = env.USER_SESSION.get(doId);

  const intentResponse = await stub.fetch(
    new Request(`https://session/blocks?pageUrl=${encodeURIComponent(pageUrl)}`),
  );
  const sessionState = (await intentResponse.json()) as {
    intent: IntentVector | null;
    pageHistory: string[];
    signalCount: number;
  };

  if (!sessionState.intent) {
    return json({
      blocks: [],
      intent: null,
      totalTimeMs: 0,
      cacheHit: false,
    });
  }

  // 3. On-demand generation via pipeline
  const storage = new KVStorageAdapter(env.BLOCKS_KV, env.CACHE_KV);
  const cerebrasClient = new DefaultCerebrasClient({
    apiKey: env.CEREBRAS_API_KEY,
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultTimeoutMs: 5000,
  });
  const intentEngine = new DefaultIntentEngine();

  const brandProfile = await storage.getBrandProfile(siteId);
  if (!brandProfile) {
    return json({
      blocks: [],
      intent: sessionState.intent,
      totalTimeMs: 0,
      cacheHit: false,
      error: 'Site not indexed',
    });
  }

  const orchestrator = new DefaultOrchestrator({
    intentEngine,
    storage,
    cerebrasClient,
    brandProfile,
  });

  const result = await orchestrator.process(
    siteId,
    sessionId,
    pageUrl,
    [], // Signals already ingested via /signals endpoint
  );

  // Store in cache for future requests
  if (result.blocks.length > 0) {
    await env.CACHE_KV.put(
      cacheKey,
      JSON.stringify({ blocks: result.blocks, intent: result.intent }),
      { expirationTtl: SPECULATIVE_CACHE_TTL_SECONDS },
    );
  }

  return json({
    blocks: result.blocks,
    intent: result.intent,
    totalTimeMs: result.totalTimeMs,
    cacheHit: false,
  });
}

function buildCacheKey(sessionId: string, pageUrl: string): string {
  return `blocks:${sessionId}:${pageUrl}`;
}
