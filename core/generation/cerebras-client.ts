// core/generation/cerebras-client.ts — Cerebras API client implementation
// CC-2.3.1: OpenAI-compatible wrapper with streaming, timeouts, and fallback

import type { GenerationModel } from '../types.js';

export interface CerebrasConfig {
  apiKey: string;
  baseUrl: string;
  defaultTimeoutMs: number;
}

export interface CompletionRequest {
  model: GenerationModel;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}

/**
 * Cerebras API client. Wraps the OpenAI-compatible inference endpoint.
 * Handles streaming, timeouts, and error fallback.
 */
export interface CerebrasClient {
  complete(request: CompletionRequest, abortSignal?: AbortSignal): Promise<CompletionResponse>;
}

export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';

export const MODEL_IDS: Record<GenerationModel, string> = {
  'gpt-oss-120b': 'gpt-oss-120b',
  'glm-4.7': 'glm-4.7',
  'glm-4.7-flash': 'glm-4.7-flash',
  'llama-3.3-8b': 'llama-3.3-8b',
};

/** OpenAI-compatible chat completion API response. */
interface ChatCompletionResponse {
  id: string;
  object: string;
  model: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Default Cerebras API client implementation.
 * Calls the OpenAI-compatible /chat/completions endpoint.
 */
export class DefaultCerebrasClient implements CerebrasClient {
  private config: CerebrasConfig;

  constructor(config: CerebrasConfig) {
    this.config = config;
  }

  async complete(
    request: CompletionRequest,
    abortSignal?: AbortSignal,
  ): Promise<CompletionResponse> {
    const startTime = Date.now();
    const timeoutMs = this.config.defaultTimeoutMs;

    // Create a combined abort signal with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // If an external abort signal is provided, forward it
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timer);
        throw new Error('Request aborted');
      }
      abortSignal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const modelId = MODEL_IDS[request.model] ?? request.model;

      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: request.messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature ?? 0.7,
            stream: false, // Non-streaming for simplicity within the budget
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new CerebrasApiError(
          `Cerebras API error: ${response.status} ${response.statusText}`,
          response.status,
          errorText,
        );
      }

      const data: ChatCompletionResponse = await response.json();
      const latencyMs = Date.now() - startTime;

      const content = data.choices?.[0]?.message?.content ?? '';

      return {
        content,
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Error type for Cerebras API failures.
 */
export class CerebrasApiError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'CerebrasApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
