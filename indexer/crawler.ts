/**
 * Site crawler — discovers pages via sitemap.xml + breadth-first link following.
 * Outputs CrawlResult[] for downstream processing.
 */

import type { CrawlResult } from '@glow/core';
import { DEFAULT_PAGE_CAP } from '@glow/core';
import { parseSitemap, isSitemapIndex, parseTextSitemap } from './sitemap.js';
import { fetchRobotsTxt, isPathAllowed, type RobotsRules } from './robots.js';
import { normalizeUrl, extractLinks, UrlSet } from './url-utils.js';
import { fetchPage, RateLimiter, type FetchOptions } from './fetcher.js';

export interface CrawlerConfig {
  /** Maximum number of pages to crawl. Default: 50 */
  maxPages?: number;
  /** Maximum BFS depth from seed URLs. Default: 3 */
  maxDepth?: number;
  /** Minimum delay between requests in ms. Overridden by robots.txt crawl-delay. */
  crawlDelayMs?: number;
  /** Custom fetch function (for testing). */
  fetchFn?: typeof fetch;
  /** Timeout per request in ms. Default: 15000 */
  requestTimeoutMs?: number;
  /** Callback fired after each page is crawled. */
  onPageCrawled?: (result: CrawlResult, progress: CrawlProgress) => void;
}

export interface CrawlProgress {
  crawled: number;
  queued: number;
  maxPages: number;
}

interface QueueEntry {
  url: string;
  depth: number;
}

/**
 * Crawl a website starting from the given URL.
 * Discovers pages via sitemap.xml and breadth-first link following.
 */
export async function crawlSite(
  startUrl: string,
  config: CrawlerConfig = {}
): Promise<CrawlResult[]> {
  const {
    maxPages = DEFAULT_PAGE_CAP,
    maxDepth = 3,
    crawlDelayMs = 1000,
    fetchFn = fetch,
    requestTimeoutMs,
    onPageCrawled,
  } = config;

  const fetchOptions: FetchOptions = { fetchFn, timeoutMs: requestTimeoutMs };
  const rateLimiter = new RateLimiter(crawlDelayMs);
  const visited = new UrlSet();
  const results: CrawlResult[] = [];

  // Normalize the start URL
  const normalizedStart = normalizeUrl(startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${startUrl}`);
  }

  const origin = new URL(normalizedStart).origin;

  // 1. Fetch and parse robots.txt
  const robotsRules = await fetchRobotsTxt(origin, fetchFn);
  if (robotsRules?.crawlDelaySeconds) {
    rateLimiter.setDelay(robotsRules.crawlDelaySeconds * 1000);
  }

  // 2. Discover seed URLs from sitemaps
  const seedUrls = await discoverSitemapUrls(
    origin,
    robotsRules,
    fetchFn
  );

  // 3. Build initial queue: sitemap URLs + start URL
  const queue: QueueEntry[] = [];

  // Add start URL first
  if (visited.add(normalizedStart)) {
    queue.push({ url: normalizedStart, depth: 0 });
  }

  // Add sitemap URLs
  for (const sitemapUrl of seedUrls) {
    const normalized = normalizeUrl(sitemapUrl);
    if (normalized && visited.add(normalized)) {
      queue.push({ url: normalized, depth: 0 });
    }
  }

  // 4. BFS crawl
  let queueIndex = 0;
  while (queueIndex < queue.length && results.length < maxPages) {
    const { url, depth } = queue[queueIndex++];

    // Check robots.txt
    if (robotsRules) {
      const urlPath = new URL(url).pathname;
      if (!isPathAllowed(urlPath, robotsRules)) {
        continue;
      }
    }

    // Rate limit
    await rateLimiter.wait();

    // Fetch
    const result = await fetchPage(url, fetchOptions);

    // Only keep successful HTML responses
    if (result.statusCode >= 200 && result.statusCode < 400 && result.html) {
      results.push(result);

      if (onPageCrawled) {
        onPageCrawled(result, {
          crawled: results.length,
          queued: queue.length - queueIndex,
          maxPages,
        });
      }

      // Extract and enqueue links if within depth limit
      if (depth < maxDepth) {
        const links = extractLinks(result.html, url);
        for (const link of links) {
          if (results.length + (queue.length - queueIndex) >= maxPages * 2) {
            break; // Don't queue too many beyond what we'll crawl
          }
          if (visited.add(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Discover page URLs from sitemaps.
 * Checks robots.txt for sitemap references, then falls back to /sitemap.xml.
 */
async function discoverSitemapUrls(
  origin: string,
  robotsRules: RobotsRules | null,
  fetchFn: typeof fetch
): Promise<string[]> {
  const sitemapLocations: string[] = [];

  // Sitemaps declared in robots.txt
  if (robotsRules?.sitemapUrls.length) {
    sitemapLocations.push(...robotsRules.sitemapUrls);
  }

  // Default sitemap location
  const defaultSitemap = `${origin}/sitemap.xml`;
  if (!sitemapLocations.includes(defaultSitemap)) {
    sitemapLocations.push(defaultSitemap);
  }

  const urls: string[] = [];

  const SITEMAP_TIMEOUT_MS = 10_000;

  for (const sitemapUrl of sitemapLocations) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SITEMAP_TIMEOUT_MS);
      const response = await fetchFn(sitemapUrl, {
        headers: { 'User-Agent': 'glow-crawler/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) continue;

      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/plain')) {
        const entries = parseTextSitemap(text);
        urls.push(...entries.map((e) => e.url));
      } else {
        if (isSitemapIndex(text)) {
          const childSitemaps = parseSitemap(text);
          for (const child of childSitemaps) {
            try {
              const childController = new AbortController();
              const childTimer = setTimeout(() => childController.abort(), SITEMAP_TIMEOUT_MS);
              const childResponse = await fetchFn(child.url, {
                headers: { 'User-Agent': 'glow-crawler/1.0' },
                signal: childController.signal,
              });
              clearTimeout(childTimer);
              if (childResponse.ok) {
                const childText = await childResponse.text();
                const childEntries = parseSitemap(childText);
                urls.push(...childEntries.map((e) => e.url));
              }
            } catch {
              // Skip unreachable child sitemaps
            }
          }
        } else {
          const entries = parseSitemap(text);
          urls.push(...entries.map((e) => e.url));
        }
      }
    } catch {
      // Skip unreachable sitemaps
    }
  }

  return urls;
}
