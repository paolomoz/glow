/**
 * Sitemap parser — handles XML sitemaps, sitemap indexes, and plain text sitemaps.
 */

export interface SitemapEntry {
  url: string;
  lastmod?: string;
  priority?: number;
}

/** Parse an XML sitemap or sitemap index, returning page URLs. */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  // Check if this is a sitemap index (contains <sitemapindex>)
  if (xml.includes('<sitemapindex')) {
    // Extract child sitemap URLs — these need to be fetched separately
    const locRegex = /<sitemap>\s*<loc>([^<]+)<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = locRegex.exec(xml)) !== null) {
      entries.push({ url: decodeXmlEntities(match[1].trim()) });
    }
    return entries;
  }

  // Standard sitemap — extract <url> entries
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/gi;
  let block: RegExpExecArray | null;
  while ((block = urlBlockRegex.exec(xml)) !== null) {
    const content = block[1];
    const loc = extractTag(content, 'loc');
    if (!loc) continue;

    const entry: SitemapEntry = { url: decodeXmlEntities(loc) };
    const lastmod = extractTag(content, 'lastmod');
    if (lastmod) entry.lastmod = lastmod;
    const priority = extractTag(content, 'priority');
    if (priority) entry.priority = parseFloat(priority);

    entries.push(entry);
  }

  return entries;
}

/** Detect whether an XML string is a sitemap index (vs a regular sitemap). */
export function isSitemapIndex(xml: string): boolean {
  return xml.includes('<sitemapindex');
}

/** Parse a plain text sitemap (one URL per line). */
export function parseTextSitemap(text: string): SitemapEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => {
      try {
        new URL(line);
        return true;
      } catch {
        return false;
      }
    })
    .map((url) => ({ url }));
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
