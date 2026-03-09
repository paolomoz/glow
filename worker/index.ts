// worker/index.ts — Main Worker entry point
// CC-4.1.1: Route handler for /signals, /blocks, /index, /analytics

import type { Env } from './env.js';
import { handleSignals } from './routes/signals.js';
import { handleBlocks } from './routes/blocks.js';
import { handleIndex } from './routes/index-route.js';
import { handleAnalytics } from './routes/analytics.js';
export { UserSession } from './session/durable-object.js';

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response: Response;

      switch (url.pathname) {
        case '/signals':
          response = await handleSignals(request, env, ctx);
          break;
        case '/blocks':
          response = await handleBlocks(request, env);
          break;
        case '/index':
          response = await handleIndex(request, env, ctx);
          break;
        case '/analytics':
          response = await handleAnalytics(request, env, ctx);
          break;
        case '/health':
          response = json({ status: 'ok', version: '0.1.0' });
          break;
        default:
          response = json({ error: 'Not found' }, 404);
      }

      // Apply CORS headers
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }

      return response;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Internal server error';
      return json({ error: message }, 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getCorsHeaders(
  request: Request,
  env: Env,
): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '*';
  const allowed = env.ALLOWED_ORIGINS?.split(',') ?? [];

  const allowedOrigin =
    allowed.length === 0 || allowed.includes(origin) ? origin : allowed[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
    'Access-Control-Max-Age': '86400',
  };
}
