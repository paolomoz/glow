/**
 * robots.txt parser — extracts disallowed paths, crawl-delay, and sitemap URLs.
 */

export interface RobotsRules {
  disallowedPaths: string[];
  crawlDelaySeconds: number;
  sitemapUrls: string[];
}

const DEFAULT_CRAWL_DELAY = 1;

/** Parse robots.txt content for a given user agent. */
export function parseRobotsTxt(
  content: string,
  userAgent = 'glow-crawler'
): RobotsRules {
  const lines = content.split('\n').map((l) => l.trim());
  const rules: RobotsRules = {
    disallowedPaths: [],
    crawlDelaySeconds: DEFAULT_CRAWL_DELAY,
    sitemapUrls: [],
  };

  let activeSection: 'match' | 'wildcard' | 'none' = 'none';
  const matchedDisallow: string[] = [];
  const wildcardDisallow: string[] = [];
  let matchedDelay: number | null = null;
  let wildcardDelay: number | null = null;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line === '') continue;

    // Sitemap directives are global
    const sitemapMatch = line.match(/^sitemap:\s*(.+)$/i);
    if (sitemapMatch) {
      rules.sitemapUrls.push(sitemapMatch[1].trim());
      continue;
    }

    const uaMatch = line.match(/^user-agent:\s*(.+)$/i);
    if (uaMatch) {
      const ua = uaMatch[1].trim().toLowerCase();
      if (ua === userAgent.toLowerCase()) {
        activeSection = 'match';
      } else if (ua === '*') {
        activeSection = 'wildcard';
      } else {
        activeSection = 'none';
      }
      continue;
    }

    if (activeSection === 'none') continue;

    const disallowMatch = line.match(/^disallow:\s*(.+)$/i);
    if (disallowMatch) {
      const path = disallowMatch[1].trim();
      if (path) {
        if (activeSection === 'match') {
          matchedDisallow.push(path);
        } else {
          wildcardDisallow.push(path);
        }
      }
      continue;
    }

    const delayMatch = line.match(/^crawl-delay:\s*(\d+(?:\.\d+)?)$/i);
    if (delayMatch) {
      const delay = parseFloat(delayMatch[1]);
      if (activeSection === 'match') {
        matchedDelay = delay;
      } else {
        wildcardDelay = delay;
      }
    }
  }

  // Prefer specific user-agent rules over wildcard
  rules.disallowedPaths =
    matchedDisallow.length > 0 ? matchedDisallow : wildcardDisallow;
  rules.crawlDelaySeconds =
    matchedDelay ?? wildcardDelay ?? DEFAULT_CRAWL_DELAY;

  return rules;
}

/** Check if a URL path is allowed by the robots rules. */
export function isPathAllowed(urlPath: string, rules: RobotsRules): boolean {
  for (const disallowed of rules.disallowedPaths) {
    if (urlPath.startsWith(disallowed)) {
      return false;
    }
  }
  return true;
}

/** Fetch and parse robots.txt for a given origin. Returns null on failure. */
export async function fetchRobotsTxt(
  origin: string,
  fetchFn: typeof fetch = fetch
): Promise<RobotsRules | null> {
  try {
    const url = `${origin}/robots.txt`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetchFn(url, {
      headers: { 'User-Agent': 'glow-crawler/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = await response.text();
    return parseRobotsTxt(text);
  } catch {
    return null;
  }
}
