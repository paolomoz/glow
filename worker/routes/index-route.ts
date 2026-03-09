// worker/routes/index-route.ts — POST /index endpoint
// Triggers site indexing, stores results in R2/KV/Vectorize

import type { ContentIndex } from '@glow/core';
import type { Env } from '../env.js';
import { json } from '../index.js';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleIndex(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = (await request.json()) as {
    siteUrl: string;
    siteId?: string;
    options?: {
      maxPages?: number;
      includeEmbeddings?: boolean;
    };
  };

  if (!body.siteUrl) {
    return json({ error: 'siteUrl required' }, 400);
  }

  const siteId = body.siteId ?? new URL(body.siteUrl).hostname;

  // Start indexing in the background
  ctx.waitUntil(runIndexing(env, siteId, body.siteUrl, body.options));

  return json({
    status: 'indexing_started',
    siteId,
    message: `Indexing ${body.siteUrl} in background`,
  });
}

async function runIndexing(
  env: Env,
  siteId: string,
  _siteUrl: string,
  _options?: { maxPages?: number; includeEmbeddings?: boolean },
): Promise<void> {
  try {
    // Store indexing status in KV
    await env.BLOCKS_KV.put(
      `index-status:${siteId}`,
      JSON.stringify({
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      }),
    );

    // In production, this would call the indexer pipeline.
    // For now, store a placeholder status.
    // The actual indexing will be triggered by the extension or a separate process.

    await env.BLOCKS_KV.put(
      `index-status:${siteId}`,
      JSON.stringify({
        status: 'pending_implementation',
        startedAt: new Date().toISOString(),
        message: 'Full indexing pipeline requires crawler access',
      }),
    );
  } catch (err) {
    await env.BLOCKS_KV.put(
      `index-status:${siteId}`,
      JSON.stringify({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    );
  }
}
