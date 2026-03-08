/**
 * HTML fetcher with rate limiting, redirect following, and error handling.
 */

import type { CrawlResult } from '@glow/core';

const USER_AGENT = 'glow-crawler/1.0 (+https://github.com/glow)';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export interface FetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchFn?: typeof fetch;
}

/** Fetch a single URL and return a CrawlResult. */
export async function fetchPage(
  url: string,
  options: FetchOptions = {}
): Promise<CrawlResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = MAX_RESPONSE_BYTES,
    fetchFn = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return {
        url,
        html: '',
        statusCode: response.status,
        headers: headersToRecord(response.headers),
      };
    }

    const html = await readResponseBody(response, maxResponseBytes);
    return {
      url: response.url || url, // Use final URL after redirects
      html,
      statusCode: response.status,
      headers: headersToRecord(response.headers),
    };
  } catch (error) {
    const isAbort =
      error instanceof DOMException && error.name === 'AbortError';
    return {
      url,
      html: '',
      statusCode: isAbort ? 408 : 0,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBody(
  response: Response,
  maxBytes: number
): Promise<string> {
  // If content-length is available and exceeds limit, skip
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return '';
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    return text.slice(0, maxBytes);
  }
  return text;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Rate limiter that enforces a minimum delay between requests.
 */
export class RateLimiter {
  private lastRequestTime = 0;

  constructor(private delayMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.delayMs) {
      await sleep(this.delayMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  setDelay(delayMs: number): void {
    this.delayMs = delayMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
