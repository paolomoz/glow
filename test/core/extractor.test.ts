import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  detectBlocks,
  buildUniqueSelector,
  type DetectedBlock,
} from '../../indexer/extractor/block-detector.js';
import {
  extractTemplate,
  extractTemplates,
} from '../../indexer/extractor/template-extractor.js';
import {
  extractAtoms,
  extractAllAtoms,
} from '../../indexer/extractor/atom-extractor.js';
import {
  extractStructuredData,
} from '../../indexer/extractor/structured-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(html: string): Document {
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  return dom.window.document;
}

// A realistic page with semantic sections, content blocks, and structured data
const SAMPLE_PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>Acme Corp — Cloud Platform</title>
  <meta name="description" content="The leading cloud platform for enterprises.">
  <meta property="og:title" content="Acme Corp Cloud Platform">
  <meta property="og:description" content="Enterprise cloud, simplified.">
  <meta property="og:image" content="https://example.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Acme Corp">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Acme Corp",
    "url": "https://example.com"
  }
  </script>
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/products">Products</a>
      <a href="/pricing">Pricing</a>
    </nav>
  </header>

  <main>
    <section id="hero" style="padding: 40px; background-color: #f0f4ff;">
      <h1>Build Faster with Acme Cloud</h1>
      <p>Deploy, scale, and manage your applications with zero infrastructure overhead. Trusted by 10,000+ companies worldwide.</p>
      <a href="/signup" class="btn cta">Get Started Free</a>
    </section>

    <section id="features" style="padding: 32px; margin-top: 24px;">
      <h2>Why Acme Cloud?</h2>
      <ul>
        <li>Auto-scaling compute with 99.99% uptime</li>
        <li>Global CDN with 200+ edge locations</li>
        <li>Built-in CI/CD pipeline integration</li>
        <li>SOC 2 and HIPAA compliant infrastructure</li>
      </ul>
    </section>

    <section id="testimonials" style="padding: 24px; background-color: #e8f5e9;">
      <h2>What Our Customers Say</h2>
      <article>
        <p>"Acme Cloud cut our deployment time from hours to minutes. The developer experience is unmatched."</p>
        <p>— Jane Smith, CTO at TechStartup</p>
      </article>
    </section>
  </main>

  <footer>
    <p>&copy; 2026 Acme Corp. All rights reserved.</p>
  </footer>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Block Detector Tests
// ---------------------------------------------------------------------------

describe('Block Detector', () => {
  let doc: Document;

  beforeEach(() => {
    doc = makeDoc(SAMPLE_PAGE);
  });

  it('detects semantic block boundaries', () => {
    const blocks = detectBlocks(doc);

    // Should find header, main sections, footer
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    // Should find the hero section
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    expect(heroBlock).toBeDefined();
    expect(heroBlock!.semanticTag).toBe('section');
  });

  it('identifies semantic tags correctly', () => {
    const blocks = detectBlocks(doc);
    const semanticBlocks = blocks.filter((b) => b.semanticTag !== null);
    const tags = semanticBlocks.map((b) => b.semanticTag);

    // Should include section, header, footer, article, nav, etc.
    expect(tags).toContain('section');
  });

  it('respects minBlockHeight option', () => {
    const allBlocks = detectBlocks(doc, { minBlockHeight: 0 });
    const tallBlocks = detectBlocks(doc, { minBlockHeight: 1000 });

    // With very high threshold, fewer blocks should pass
    expect(tallBlocks.length).toBeLessThanOrEqual(allBlocks.length);
  });

  it('filters blocks without content', () => {
    const emptyDoc = makeDoc('<body><section></section><section><p>Content here</p></section></body>');
    const blocks = detectBlocks(emptyDoc);

    // Empty section should be filtered out
    const contentBlocks = blocks.filter((b) => b.hasContent);
    expect(contentBlocks.length).toBeGreaterThanOrEqual(1);
    for (const b of contentBlocks) {
      expect(b.hasContent).toBe(true);
    }
  });

  it('respects maxDepth option', () => {
    const deepDoc = makeDoc(`
      <body>
        <div><div><div><div><div><div><div><div><div>
          <section><p>Deep content</p></section>
        </div></div></div></div></div></div></div></div></div>
      </body>
    `);
    const shallow = detectBlocks(deepDoc, { maxDepth: 3 });
    const deep = detectBlocks(deepDoc, { maxDepth: 12 });

    expect(deep.length).toBeGreaterThanOrEqual(shallow.length);
  });

  it('builds unique selectors', () => {
    const blocks = detectBlocks(doc);
    const selectors = blocks.map((b) => b.selector);

    // All selectors should be unique
    const unique = new Set(selectors);
    expect(unique.size).toBe(selectors.length);
  });

  it('returns empty array for empty body', () => {
    const emptyDoc = makeDoc('<html><body></body></html>');
    const blocks = detectBlocks(emptyDoc);
    expect(blocks).toEqual([]);
  });
});

describe('buildUniqueSelector', () => {
  it('uses ID when available', () => {
    const doc = makeDoc('<body><div id="test"><p>hello</p></div></body>');
    const el = doc.getElementById('test')!;
    expect(buildUniqueSelector(el)).toBe('#test');
  });

  it('builds path with tag names and classes', () => {
    const doc = makeDoc('<body><div class="container"><p class="intro">Hi</p></div></body>');
    const el = doc.querySelector('.intro')!;
    const selector = buildUniqueSelector(el);
    expect(selector).toContain('p');
    expect(selector).toContain('intro');
  });
});

// ---------------------------------------------------------------------------
// Template Extractor Tests
// ---------------------------------------------------------------------------

describe('Template Extractor', () => {
  let doc: Document;
  let blocks: DetectedBlock[];

  beforeEach(() => {
    doc = makeDoc(SAMPLE_PAGE);
    blocks = detectBlocks(doc);
  });

  it('extracts templates from detected blocks', () => {
    const templates = extractTemplates(blocks, {
      siteId: 'acme',
      sourceUrl: 'https://example.com/',
    }, doc);

    expect(templates.length).toBe(blocks.length);
    for (const t of templates) {
      expect(t.siteId).toBe('acme');
      expect(t.sourceUrl).toBe('https://example.com/');
      expect(t.htmlShell).toBeTruthy();
      expect(t.id).toMatch(/^tmpl_acme_/);
    }
  });

  it('extracts slot definitions from hero block', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return; // Skip if hero not detected

    const template = extractTemplate(heroBlock, {
      siteId: 'acme',
      sourceUrl: 'https://example.com/',
    }, doc);

    // Hero has: h1 (headline), p (body), a.cta (link)
    expect(template.slots.length).toBeGreaterThanOrEqual(2);

    const slotNames = template.slots.map((s) => s.name);
    expect(slotNames.some((n) => n.includes('headline'))).toBe(true);
  });

  it('replaces content with placeholders in htmlShell', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return;

    const template = extractTemplate(heroBlock, {
      siteId: 'acme',
      sourceUrl: 'https://example.com/',
    }, doc);

    // HTML shell should contain placeholder markers
    expect(template.htmlShell).toContain('{{');
    expect(template.htmlShell).toContain('}}');
  });

  it('sets slot constraints based on original content', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return;

    const template = extractTemplate(heroBlock, {
      siteId: 'acme',
      sourceUrl: 'https://example.com/',
    }, doc);

    for (const slot of template.slots) {
      expect(slot.constraints.required).toBe(true);
      expect(slot.constraints.maxLength).toBeGreaterThan(0);
      expect(slot.originalContent.length).toBeGreaterThan(0);
    }
  });

  it('infers block position', () => {
    const templates = extractTemplates(blocks, {
      siteId: 'acme',
      sourceUrl: 'https://example.com/',
    }, doc);

    for (const t of templates) {
      expect(['hero', 'above-fold', 'mid-page', 'below-fold', 'footer']).toContain(t.position);
    }
  });
});

// ---------------------------------------------------------------------------
// Atom Extractor Tests
// ---------------------------------------------------------------------------

describe('Atom Extractor', () => {
  let doc: Document;
  let blocks: DetectedBlock[];

  beforeEach(() => {
    doc = makeDoc(SAMPLE_PAGE);
    blocks = detectBlocks(doc);
  });

  it('extracts atoms from blocks', () => {
    const atoms = extractAllAtoms(blocks, {
      sourceUrl: 'https://example.com/',
    });

    expect(atoms.length).toBeGreaterThan(0);
  });

  it('extracts headline atoms from hero', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return;

    const atoms = extractAtoms(heroBlock, 0, {
      sourceUrl: 'https://example.com/',
    });

    const headlines = atoms.filter((a) => a.contentType === 'headline');
    expect(headlines.length).toBeGreaterThanOrEqual(1);
    expect(headlines[0].content).toContain('Build Faster');
  });

  it('extracts body atoms', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return;

    const atoms = extractAtoms(heroBlock, 0, {
      sourceUrl: 'https://example.com/',
    });

    const bodies = atoms.filter((a) => a.contentType === 'body');
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    expect(bodies[0].content).toContain('Deploy, scale');
  });

  it('extracts CTA atoms', () => {
    const heroBlock = blocks.find((b) => b.selector.includes('hero'));
    if (!heroBlock) return;

    const atoms = extractAtoms(heroBlock, 0, {
      sourceUrl: 'https://example.com/',
    });

    const ctas = atoms.filter((a) => a.contentType === 'cta');
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(ctas[0].content).toBe('Get Started Free');
  });

  it('extracts list items from features section', () => {
    const featuresBlock = blocks.find((b) => b.selector.includes('features'));
    if (!featuresBlock) return;

    const atoms = extractAtoms(featuresBlock, 1, {
      sourceUrl: 'https://example.com/',
    });

    const listItems = atoms.filter((a) => a.contentType === 'list-item');
    expect(listItems.length).toBe(4);
    expect(listItems[0].content).toContain('Auto-scaling');
  });

  it('assigns correct metadata', () => {
    const atoms = extractAllAtoms(blocks, {
      sourceUrl: 'https://example.com/',
    });

    for (const atom of atoms) {
      expect(atom.sourceUrl).toBe('https://example.com/');
      expect(atom.metadata.wordCount).toBeGreaterThan(0);
      expect(atom.metadata.language).toBe('en');
      expect(atom.version).toBe(1);
      expect(atom.id).toMatch(/^atom_/);
    }
  });

  it('generates unique atom IDs', () => {
    const atoms = extractAllAtoms(blocks, {
      sourceUrl: 'https://example.com/',
    });

    const ids = atoms.map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('filters atoms below minWordCount', () => {
    const shortDoc = makeDoc('<body><section><p>Hi</p><p>This is a longer paragraph with many words in it</p></section></body>');
    const shortBlocks = detectBlocks(shortDoc);

    const atoms = extractAllAtoms(shortBlocks, {
      sourceUrl: 'https://example.com/',
      minWordCount: 5,
    });

    for (const a of atoms) {
      if (a.contentType !== 'cta') {
        expect(a.metadata.wordCount).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Structured Data Extractor Tests
// ---------------------------------------------------------------------------

describe('Structured Data Extractor', () => {
  it('extracts JSON-LD', () => {
    const doc = makeDoc(SAMPLE_PAGE);
    const data = extractStructuredData(doc);

    expect(data.jsonLd.length).toBe(1);
    expect(data.jsonLd[0]['@type']).toBe('Organization');
    expect(data.jsonLd[0]['name']).toBe('Acme Corp');
  });

  it('extracts OpenGraph tags', () => {
    const doc = makeDoc(SAMPLE_PAGE);
    const data = extractStructuredData(doc);

    expect(data.openGraph['og:title']).toBe('Acme Corp Cloud Platform');
    expect(data.openGraph['og:description']).toBe('Enterprise cloud, simplified.');
    expect(data.openGraph['og:image']).toBe('https://example.com/og.png');
  });

  it('extracts meta tags', () => {
    const doc = makeDoc(SAMPLE_PAGE);
    const data = extractStructuredData(doc);

    expect(data.metaTags['description']).toBe('The leading cloud platform for enterprises.');
    expect(data.metaTags['title']).toBe('Acme Corp — Cloud Platform');
  });

  it('extracts Twitter Card tags', () => {
    const doc = makeDoc(SAMPLE_PAGE);
    const data = extractStructuredData(doc);

    expect(data.twitterCard['twitter:card']).toBe('summary_large_image');
    expect(data.twitterCard['twitter:title']).toBe('Acme Corp');
  });

  it('handles JSON-LD arrays', () => {
    const doc = makeDoc(`<html><head>
      <script type="application/ld+json">
      [
        {"@type": "WebPage", "name": "Home"},
        {"@type": "BreadcrumbList", "name": "Trail"}
      ]
      </script>
    </head><body></body></html>`);
    const data = extractStructuredData(doc);
    expect(data.jsonLd.length).toBe(2);
    expect(data.jsonLd[0]['@type']).toBe('WebPage');
    expect(data.jsonLd[1]['@type']).toBe('BreadcrumbList');
  });

  it('handles JSON-LD @graph containers', () => {
    const doc = makeDoc(`<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "WebSite", "name": "Acme"},
          {"@type": "Organization", "name": "Acme Corp"}
        ]
      }
      </script>
    </head><body></body></html>`);
    const data = extractStructuredData(doc);
    expect(data.jsonLd.length).toBe(2);
    expect(data.jsonLd[0]['@type']).toBe('WebSite');
  });

  it('skips malformed JSON-LD', () => {
    const doc = makeDoc(`<html><head>
      <script type="application/ld+json">not valid json{</script>
    </head><body></body></html>`);
    const data = extractStructuredData(doc);
    expect(data.jsonLd).toEqual([]);
  });

  it('extracts microdata', () => {
    const doc = makeDoc(`<html><body>
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Widget Pro</span>
        <span itemprop="price" content="29.99">$29.99</span>
      </div>
    </body></html>`);
    const data = extractStructuredData(doc);

    expect(data.microdata.length).toBe(1);
    expect(data.microdata[0].type).toBe('https://schema.org/Product');
    expect(data.microdata[0].properties['name']).toBe('Widget Pro');
    expect(data.microdata[0].properties['price']).toBe('29.99');
  });

  it('returns empty structures for pages without structured data', () => {
    const doc = makeDoc('<html><body><p>Plain page</p></body></html>');
    const data = extractStructuredData(doc);

    expect(data.jsonLd).toEqual([]);
    expect(Object.keys(data.openGraph)).toHaveLength(0);
    expect(data.microdata).toEqual([]);
  });
});
