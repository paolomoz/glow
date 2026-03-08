// indexer/extractor/structured-data.ts — Extract structured data from pages
// SLICC-1.4.4: JSON-LD, OpenGraph, meta tags, schema.org markup extraction

/** Represents extracted structured data from a page. */
export interface StructuredData {
  /** JSON-LD objects found in the page */
  jsonLd: JsonLdObject[];
  /** OpenGraph tags */
  openGraph: Record<string, string>;
  /** Standard meta tags (name → content) */
  metaTags: Record<string, string>;
  /** Twitter card tags */
  twitterCard: Record<string, string>;
  /** Schema.org microdata attributes (itemtype → properties) */
  microdata: MicrodataItem[];
}

export interface JsonLdObject {
  '@type'?: string;
  '@context'?: string;
  [key: string]: unknown;
}

export interface MicrodataItem {
  type: string;
  properties: Record<string, string>;
}

/**
 * Extract all structured data from a document.
 */
export function extractStructuredData(doc: Document): StructuredData {
  return {
    jsonLd: extractJsonLd(doc),
    openGraph: extractOpenGraph(doc),
    metaTags: extractMetaTags(doc),
    twitterCard: extractTwitterCard(doc),
    microdata: extractMicrodata(doc),
  };
}

/** Extract and parse all JSON-LD script blocks. */
function extractJsonLd(doc: Document): JsonLdObject[] {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const results: JsonLdObject[] = [];

  scripts.forEach((script) => {
    const text = script.textContent?.trim();
    if (!text) return;

    try {
      const parsed: unknown = JSON.parse(text);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isJsonLdObject(item)) {
            results.push(item);
          }
        }
      } else if (isJsonLdObject(parsed)) {
        // Handle @graph containers
        if (
          '@graph' in parsed &&
          Array.isArray(parsed['@graph'])
        ) {
          for (const item of parsed['@graph']) {
            if (isJsonLdObject(item)) {
              results.push(item);
            }
          }
        } else {
          results.push(parsed);
        }
      }
    } catch {
      // Skip malformed JSON-LD
    }
  });

  return results;
}

function isJsonLdObject(val: unknown): val is JsonLdObject {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Extract OpenGraph meta tags (og:*). */
function extractOpenGraph(doc: Document): Record<string, string> {
  const tags: Record<string, string> = {};
  const metas = doc.querySelectorAll('meta[property^="og:"]');

  metas.forEach((meta) => {
    const property = meta.getAttribute('property');
    const content = meta.getAttribute('content');
    if (property && content) {
      tags[property] = content;
    }
  });

  return tags;
}

/** Extract standard meta tags (name → content). */
function extractMetaTags(doc: Document): Record<string, string> {
  const tags: Record<string, string> = {};
  const metas = doc.querySelectorAll('meta[name]');

  metas.forEach((meta) => {
    const name = meta.getAttribute('name');
    const content = meta.getAttribute('content');
    if (name && content) {
      // Skip og: and twitter: as they're handled separately
      if (!name.startsWith('og:') && !name.startsWith('twitter:')) {
        tags[name] = content;
      }
    }
  });

  // Also capture title
  const title = doc.querySelector('title');
  if (title?.textContent) {
    tags['title'] = title.textContent.trim();
  }

  // Canonical URL
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical) {
    const href = canonical.getAttribute('href');
    if (href) tags['canonical'] = href;
  }

  return tags;
}

/** Extract Twitter Card meta tags. */
function extractTwitterCard(doc: Document): Record<string, string> {
  const tags: Record<string, string> = {};
  const metas = doc.querySelectorAll(
    'meta[name^="twitter:"], meta[property^="twitter:"]',
  );

  metas.forEach((meta) => {
    const name =
      meta.getAttribute('name') ?? meta.getAttribute('property');
    const content = meta.getAttribute('content');
    if (name && content) {
      tags[name] = content;
    }
  });

  return tags;
}

/** Extract schema.org microdata from elements with itemscope/itemtype. */
function extractMicrodata(doc: Document): MicrodataItem[] {
  const items: MicrodataItem[] = [];
  const scopeEls = doc.querySelectorAll('[itemscope][itemtype]');

  scopeEls.forEach((el) => {
    const itemType = el.getAttribute('itemtype') ?? '';
    const properties: Record<string, string> = {};

    const propEls = el.querySelectorAll('[itemprop]');
    propEls.forEach((propEl) => {
      const propName = propEl.getAttribute('itemprop');
      if (!propName) return;

      // Value resolution order: content attr > href > src > text
      const value =
        propEl.getAttribute('content') ??
        propEl.getAttribute('href') ??
        propEl.getAttribute('src') ??
        propEl.textContent?.trim() ??
        '';

      if (value) {
        properties[propName] = value;
      }
    });

    if (Object.keys(properties).length > 0) {
      items.push({ type: itemType, properties });
    }
  });

  return items;
}
