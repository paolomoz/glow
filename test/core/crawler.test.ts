import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSitemap, isSitemapIndex, parseTextSitemap } from '../../indexer/sitemap.js';
import { parseRobotsTxt, isPathAllowed } from '../../indexer/robots.js';
import { normalizeUrl, isSameOrigin, extractLinks, UrlSet } from '../../indexer/url-utils.js';
import { fetchPage, RateLimiter } from '../../indexer/fetcher.js';
import { crawlSite } from '../../indexer/crawler.js';

const FIXTURES = join(__dirname, '../fixtures/crawler');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

// =============================================================================
// Sitemap Parser
// =============================================================================

describe('Sitemap Parser', () => {
  it('should parse a standard XML sitemap', () => {
    const xml = readFixture('sitemap.xml');
    const entries = parseSitemap(xml);
    expect(entries).toHaveLength(4);
    expect(entries[0].url).toBe('https://example.com/');
    expect(entries[0].lastmod).toBe('2026-01-01');
    expect(entries[0].priority).toBe(1.0);
    expect(entries[1].url).toBe('https://example.com/about');
    expect(entries[3].url).toBe('https://example.com/contact');
    expect(entries[3].lastmod).toBeUndefined();
    expect(entries[3].priority).toBeUndefined();
  });

  it('should detect a sitemap index', () => {
    const xml = readFixture('sitemap-index.xml');
    expect(isSitemapIndex(xml)).toBe(true);
    expect(isSitemapIndex(readFixture('sitemap.xml'))).toBe(false);
  });

  it('should parse sitemap index and extract child sitemap URLs', () => {
    const xml = readFixture('sitemap-index.xml');
    const entries = parseSitemap(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0].url).toBe('https://example.com/sitemap-pages.xml');
    expect(entries[1].url).toBe('https://example.com/sitemap-blog.xml');
  });

  it('should parse a plain text sitemap', () => {
    const text = `
https://example.com/
https://example.com/about
# comment
https://example.com/products
not-a-url
    `;
    const entries = parseTextSitemap(text);
    expect(entries).toHaveLength(3);
    expect(entries[0].url).toBe('https://example.com/');
  });

  it('should decode XML entities in URLs', () => {
    const xml = `<urlset><url><loc>https://example.com/page?a=1&amp;b=2</loc></url></urlset>`;
    const entries = parseSitemap(xml);
    expect(entries[0].url).toBe('https://example.com/page?a=1&b=2');
  });
});

// =============================================================================
// Robots.txt Parser
// =============================================================================

describe('Robots.txt Parser', () => {
  it('should parse robots.txt with specific user agent', () => {
    const content = readFixture('robots.txt');
    const rules = parseRobotsTxt(content, 'glow-crawler');
    expect(rules.disallowedPaths).toEqual(['/internal/']);
    expect(rules.crawlDelaySeconds).toBe(1);
    expect(rules.sitemapUrls).toContain('https://example.com/sitemap.xml');
    expect(rules.sitemapUrls).toContain('https://example.com/sitemap-blog.xml');
  });

  it('should fall back to wildcard rules', () => {
    const content = readFixture('robots.txt');
    const rules = parseRobotsTxt(content, 'some-other-bot');
    expect(rules.disallowedPaths).toEqual(['/admin/', '/private/']);
    expect(rules.crawlDelaySeconds).toBe(2);
  });

  it('should check path allowance', () => {
    const rules = parseRobotsTxt(readFixture('robots.txt'), 'glow-crawler');
    expect(isPathAllowed('/about', rules)).toBe(true);
    expect(isPathAllowed('/internal/secret', rules)).toBe(false);
    expect(isPathAllowed('/', rules)).toBe(true);
  });

  it('should handle empty robots.txt', () => {
    const rules = parseRobotsTxt('');
    expect(rules.disallowedPaths).toEqual([]);
    expect(rules.crawlDelaySeconds).toBe(1);
    expect(rules.sitemapUrls).toEqual([]);
  });

  it('should handle robots.txt with only sitemaps', () => {
    const rules = parseRobotsTxt('Sitemap: https://example.com/sitemap.xml');
    expect(rules.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
  });
});

// =============================================================================
// URL Utilities
// =============================================================================

describe('URL Normalization', () => {
  it('should normalize basic URLs', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/page')).toBe('https://example.com/page');
  });

  it('should remove fragments', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('should remove trailing slashes (except root)', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('should sort query parameters', () => {
    expect(normalizeUrl('https://example.com/page?b=2&a=1')).toBe(
      'https://example.com/page?a=1&b=2'
    );
  });

  it('should resolve relative URLs with a base', () => {
    expect(normalizeUrl('/about', 'https://example.com/page')).toBe(
      'https://example.com/about'
    );
  });

  it('should return null for non-http URLs', () => {
    expect(normalizeUrl('mailto:test@example.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('ftp://example.com')).toBeNull();
  });

  it('should return null for invalid URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('isSameOrigin', () => {
  it('should detect same origin', () => {
    expect(isSameOrigin('https://example.com/page', 'https://example.com/')).toBe(true);
  });

  it('should detect different origins', () => {
    expect(isSameOrigin('https://other.com/page', 'https://example.com/')).toBe(false);
    expect(isSameOrigin('http://example.com/page', 'https://example.com/')).toBe(false);
  });
});

describe('extractLinks', () => {
  it('should extract same-origin links from HTML', () => {
    const html = readFixture('page-home.html');
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toContain('https://example.com/about');
    expect(links).toContain('https://example.com/products');
    expect(links).toContain('https://example.com/products/widget-a');
    // External link should be excluded
    expect(links).not.toContain('https://external.com/partner');
  });
});

describe('UrlSet', () => {
  it('should track unique URLs', () => {
    const set = new UrlSet();
    expect(set.add('https://example.com/')).toBe(true);
    expect(set.add('https://example.com/')).toBe(false);
    expect(set.size).toBe(1);
    expect(set.has('https://example.com/')).toBe(true);
  });
});

// =============================================================================
// Fetcher
// =============================================================================

describe('Fetcher', () => {
  it('should fetch a page and return CrawlResult', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve('<html><body>Hello</body></html>'),
    });

    const result = await fetchPage('https://example.com/', { fetchFn: mockFetch });
    expect(result.statusCode).toBe(200);
    expect(result.html).toBe('<html><body>Hello</body></html>');
    expect(result.url).toBe('https://example.com/');
  });

  it('should return empty html for non-HTML content types', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/image.png',
      headers: new Headers({ 'content-type': 'image/png' }),
      text: () => Promise.resolve('binary data'),
    });

    const result = await fetchPage('https://example.com/image.png', { fetchFn: mockFetch });
    expect(result.html).toBe('');
  });

  it('should handle fetch errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await fetchPage('https://example.com/', { fetchFn: mockFetch });
    expect(result.statusCode).toBe(0);
    expect(result.html).toBe('');
  });
});

describe('RateLimiter', () => {
  it('should enforce delay between requests', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
  });

  it('should allow updating the delay', async () => {
    const limiter = new RateLimiter(1000);
    limiter.setDelay(10);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// Crawler Integration
// =============================================================================

describe('Crawler', () => {
  function createMockFetch(pages: Record<string, { html: string; contentType?: string }>) {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      const page = pages[urlStr];
      if (page) {
        return {
          ok: true,
          status: 200,
          url: urlStr,
          headers: new Headers({
            'content-type': page.contentType ?? 'text/html; charset=utf-8',
          }),
          text: () => Promise.resolve(page.html),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        url: urlStr,
        headers: new Headers(),
        text: () => Promise.resolve(''),
      } as unknown as Response;
    });
  }

  it('should crawl a simple site following links', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': {
        html: '',
        contentType: 'text/plain',
      },
      'https://example.com/sitemap.xml': {
        html: '',
        contentType: 'application/xml',
      },
      'https://example.com/': {
        html: `<html><body>
          <a href="/about">About</a>
          <a href="/products">Products</a>
        </body></html>`,
      },
      'https://example.com/about': {
        html: `<html><body><h1>About</h1><a href="/team">Team</a></body></html>`,
      },
      'https://example.com/products': {
        html: `<html><body><h1>Products</h1></body></html>`,
      },
      'https://example.com/team': {
        html: `<html><body><h1>Team</h1></body></html>`,
      },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 10,
      maxDepth: 2,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    expect(results.length).toBeGreaterThanOrEqual(3);
    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/products');
  });

  it('should respect maxPages limit', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': { html: '', contentType: 'text/plain' },
      'https://example.com/sitemap.xml': { html: '', contentType: 'application/xml' },
      'https://example.com/': {
        html: `<html><body>
          <a href="/p1">P1</a><a href="/p2">P2</a>
          <a href="/p3">P3</a><a href="/p4">P4</a>
        </body></html>`,
      },
      'https://example.com/p1': { html: '<html><body>P1</body></html>' },
      'https://example.com/p2': { html: '<html><body>P2</body></html>' },
      'https://example.com/p3': { html: '<html><body>P3</body></html>' },
      'https://example.com/p4': { html: '<html><body>P4</body></html>' },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 2,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    expect(results).toHaveLength(2);
  });

  it('should respect maxDepth limit', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': { html: '', contentType: 'text/plain' },
      'https://example.com/sitemap.xml': { html: '', contentType: 'application/xml' },
      'https://example.com/': {
        html: `<html><body><a href="/level1">L1</a></body></html>`,
      },
      'https://example.com/level1': {
        html: `<html><body><a href="/level2">L2</a></body></html>`,
      },
      'https://example.com/level2': {
        html: `<html><body><a href="/level3">L3</a></body></html>`,
      },
      'https://example.com/level3': {
        html: `<html><body>Leaf</body></html>`,
      },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 10,
      maxDepth: 1,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/level1');
    // level2 found via link extraction from level1 (depth 1 → link depth 2, exceeds maxDepth=1)
    // But level1 is at depth 1 which equals maxDepth, so its links are NOT followed
    expect(urls).not.toContain('https://example.com/level2');
  });

  it('should respect robots.txt disallow rules', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': {
        html: 'User-agent: *\nDisallow: /private/',
        contentType: 'text/plain',
      },
      'https://example.com/sitemap.xml': { html: '', contentType: 'application/xml' },
      'https://example.com/': {
        html: `<html><body>
          <a href="/about">About</a>
          <a href="/private/secret">Secret</a>
        </body></html>`,
      },
      'https://example.com/about': { html: '<html><body>About</body></html>' },
      'https://example.com/private/secret': { html: '<html><body>Secret</body></html>' },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 10,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://example.com/about');
    expect(urls).not.toContain('https://example.com/private/secret');
  });

  it('should use sitemap URLs as seeds', async () => {
    const sitemapXml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/hidden-page</loc></url>
      </urlset>`;

    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': { html: '', contentType: 'text/plain' },
      'https://example.com/sitemap.xml': { html: sitemapXml, contentType: 'application/xml' },
      'https://example.com/': { html: '<html><body>Home</body></html>' },
      'https://example.com/hidden-page': { html: '<html><body>Hidden</body></html>' },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 10,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://example.com/hidden-page');
  });

  it('should deduplicate URLs', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': { html: '', contentType: 'text/plain' },
      'https://example.com/sitemap.xml': { html: '', contentType: 'application/xml' },
      'https://example.com/': {
        html: `<html><body>
          <a href="/">Home</a>
          <a href="/">Home Again</a>
          <a href="/about">About</a>
          <a href="/about#section">About Section</a>
        </body></html>`,
      },
      'https://example.com/about': { html: '<html><body>About</body></html>' },
    });

    const results = await crawlSite('https://example.com/', {
      maxPages: 10,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
    });

    const urls = results.map((r) => r.url);
    // No duplicates
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('should call onPageCrawled callback', async () => {
    const mockFetch = createMockFetch({
      'https://example.com/robots.txt': { html: '', contentType: 'text/plain' },
      'https://example.com/sitemap.xml': { html: '', contentType: 'application/xml' },
      'https://example.com/': { html: '<html><body>Home</body></html>' },
    });

    const onPageCrawled = vi.fn();
    await crawlSite('https://example.com/', {
      maxPages: 5,
      crawlDelayMs: 0,
      fetchFn: mockFetch,
      onPageCrawled,
    });

    expect(onPageCrawled).toHaveBeenCalledTimes(1);
    expect(onPageCrawled).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/', statusCode: 200 }),
      expect.objectContaining({ crawled: 1, maxPages: 5 })
    );
  });

  it('should throw on invalid start URL', async () => {
    await expect(crawlSite('not-a-url')).rejects.toThrow('Invalid start URL');
  });
});
