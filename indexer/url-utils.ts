/**
 * URL normalization and deduplication utilities.
 */

/** Normalize a URL by removing fragments, sorting query params, and lowercasing the host. */
export function normalizeUrl(raw: string, baseUrl?: string): string | null {
  try {
    const url = new URL(raw, baseUrl);

    // Only handle http(s)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Remove fragment
    url.hash = '';

    // Lowercase host
    url.hostname = url.hostname.toLowerCase();

    // Sort query params for consistent dedup
    const params = new URLSearchParams(url.searchParams);
    const sorted = new URLSearchParams([...params.entries()].sort());
    url.search = sorted.toString() ? `?${sorted.toString()}` : '';

    // Remove trailing slash from path (except root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return null;
  }
}

/** Check if a URL belongs to the same origin as the base. */
export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

/** Extract all href links from an HTML string. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  // Match href="..." or href='...' in anchor tags
  const hrefRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const normalized = normalizeUrl(match[1], baseUrl);
    if (normalized && isSameOrigin(normalized, baseUrl)) {
      links.push(normalized);
    }
  }
  return links;
}

/** URL set for deduplication. */
export class UrlSet {
  private seen = new Set<string>();

  has(url: string): boolean {
    return this.seen.has(url);
  }

  add(url: string): boolean {
    if (this.seen.has(url)) return false;
    this.seen.add(url);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
