// worker/routes/signals.ts — POST /signals endpoint
// Ingests behavioral signals, forwards to Durable Object session

import type { Signal } from '@glow/core';
import type { Env } from '../env.js';
import { json } from '../index.js';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleSignals(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const body = (await request.json()) as {
    sessionId: string;
    siteId: string;
    signals: Signal[];
    pageUrl: string;
  };

  if (!body.sessionId || !body.signals?.length) {
    return json({ error: 'sessionId and signals required' }, 400);
  }

  // Route to Durable Object for this session
  const doId = env.USER_SESSION.idFromName(body.sessionId);
  const stub = env.USER_SESSION.get(doId);

  const doResponse = await stub.fetch(
    new Request('https://session/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signals: body.signals,
        sessionId: body.sessionId,
      }),
    }),
  );

  const result = await doResponse.json();
  return json(result);
}
