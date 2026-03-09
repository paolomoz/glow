// worker/storage/cerebras-proxy.ts — Cerebras API proxy with caching and fallback
// CC-4.1.6: Worker-side Cerebras proxy with KV response caching, timeout, Workers AI fallback

import type { GenerationModel } from '@glow/core';
import { CEREBRAS_BASE_URL, MODEL_IDS } from '@glow/core';
import type { Env } from '../env.js';

interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface CompletionParams {
  model: GenerationModel;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface CompletionResult {
  text: string;
  model: string;
  cached: boolean;
  fallback: boolean;
  latencyMs: number;
}

/**
 * Proxies Cerebras API calls from the Worker with:
 * - KV response caching for identical requests
 * - Timeout enforcement with AbortController
 * - Automatic fallback to Workers AI (Llama 3.3 8B)
 */
export class CerebrasProxy {
  private env: Env;
  private cacheKV: KVNamespace;

  constructor(env: Env) {
    this.env = env;
    this.cacheKV = env.CACHE_KV;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const start = Date.now();

    // 1. Check response cache
    const cacheKey = this.buildCacheKey(params);
    const cached = await this.cacheKV.get(cacheKey);
    if (cached) {
      return {
        text: cached,
        model: params.model,
        cached: true,
        fallback: false,
        latencyMs: Date.now() - start,
      };
    }

    // 2. Try Cerebras API
    try {
      const text = await this.callCerebras(params);

      // Cache the response (5 min TTL for identical requests)
      await this.cacheKV.put(cacheKey, text, { expirationTtl: 300 });

      return {
        text,
        model: params.model,
        cached: false,
        fallback: false,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      // 3. Fallback to Workers AI
      try {
        const text = await this.callWorkersAI(params);
        return {
          text,
          model: 'llama-3.3-8b',
          cached: false,
          fallback: true,
          latencyMs: Date.now() - start,
        };
      } catch {
        throw err; // Re-throw original Cerebras error
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cerebras API call
  // -------------------------------------------------------------------------

  private async callCerebras(params: CompletionParams): Promise<string> {
    const timeoutMs = params.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const modelId = MODEL_IDS[params.model] ?? params.model;
      const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.CEREBRAS_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: params.messages,
          max_tokens: params.maxTokens ?? 1024,
          temperature: params.temperature ?? 0.7,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Cerebras API error ${response.status}: ${errorBody}`,
        );
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
      };

      return data.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Workers AI fallback
  // -------------------------------------------------------------------------

  private async callWorkersAI(params: CompletionParams): Promise<string> {
    const result = await this.env.AI.run('@cf/meta/llama-3.3-8b-instruct', {
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: params.maxTokens ?? 1024,
    });

    return result.response ?? '';
  }

  // -------------------------------------------------------------------------
  // Cache key generation
  // -------------------------------------------------------------------------

  private buildCacheKey(params: CompletionParams): string {
    // Hash the model + messages for cache key
    const input = JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
    });

    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `cerebras-cache:${Math.abs(hash).toString(36)}`;
  }
}
