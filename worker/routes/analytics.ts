// worker/routes/analytics.ts — POST /analytics endpoint
// Ingests engagement events, stores in R2 for batch processing

import type { AnalyticsEvent } from '@glow/core';
import type { Env } from '../env.js';
import { json } from '../index.js';
import { R2StorageAdapter } from '../storage/r2-adapter.js';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleAnalytics(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = (await request.json()) as {
    events: AnalyticsEvent[];
  };

  if (!body.events?.length) {
    return json({ error: 'events array required' }, 400);
  }

  // Store events asynchronously
  const r2 = new R2StorageAdapter(env.CONTENT_R2);
  ctx.waitUntil(r2.storeEvents(body.events));

  return json({ accepted: body.events.length });
}
