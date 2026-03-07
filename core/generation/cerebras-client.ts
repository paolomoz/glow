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
