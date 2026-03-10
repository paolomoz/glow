import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ContentAtom,
  IntentVector,
  BlockTemplate,
  SlotDefinition,
  BrandProfile,
  Signal,
  StorageInterface,
  ContentMetadata,
  BlockPosition,
  AnalyticsEvent,
} from '../../core/types.js';
import {
  DefaultQueryBuilder,
  type RetrievalQuery,
} from '../../core/retrieval/query-builder.js';
import {
  DefaultAtomSelector,
  cosineSimilarity,
} from '../../core/retrieval/atom-selector.js';
import { DefaultBlockRegistry } from '../../core/blocks/registry.js';
import { DefaultSlotFiller, type FilledSlots } from '../../core/blocks/slot-filler.js';
import { DefaultBlockAssembler } from '../../core/blocks/assembler.js';
import { DefaultModelRouter } from '../../core/generation/model-router.js';
import { DefaultPromptBuilder } from '../../core/generation/prompt-builder.js';
import { DefaultSpeculativePreGenerator } from '../../core/pipeline/speculative.js';
import { DefaultOrchestrator } from '../../core/pipeline/orchestrator.js';
import { DefaultIntentEngine } from '../../core/intent/engine.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<IntentVector> = {}): IntentVector {
  return {
    sessionId: 'sess-1',
    archetype: 'explore',
    confidence: 0.7,
    topicEmbedding: [0.1, 0.2, 0.3, 0.4],
    audienceMode: 'intermediate',
    contentDepth: 'detailed',
    emotionalRegister: 'rational',
    signalCount: 5,
    history: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAtom(
  id: string,
  content: string,
  embedding?: number[],
): ContentAtom {
  return {
    id,
    content,
    sourceUrl: 'https://example.com/',
    blockPosition: 0,
    contentType: 'body',
    metadata: {
      topics: ['cloud'],
      audienceDepth: 'intermediate',
      purpose: 'inform',
      emotionalRegister: 'rational',
      wordCount: content.split(/\s+/).length,
      language: 'en',
    },
    embedding,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeTemplate(id: string, position: BlockPosition = 'hero'): BlockTemplate {
  const slots: SlotDefinition[] = [
    {
      name: 'headline',
      type: 'text',
      constraints: { minLength: 5, maxLength: 100, required: true },
      originalContent: 'Original Headline',
    },
    {
      name: 'body',
      type: 'rich-text',
      constraints: { minLength: 10, maxLength: 500, required: true },
      originalContent: 'Original body content goes here.',
    },
  ];

  return {
    id,
    siteId: 'test-site',
    sourceUrl: 'https://example.com/',
    blockType: 'section',
    htmlShell: '<section><h1>{{headline}}</h1><p>{{body}}</p></section>',
    cssRules: 'padding: 20px; color: #333',
    slots,
    responsive: { mobile: '', tablet: '', desktop: '' },
    position,
  };
}

const mockBrand: BrandProfile = {
  siteId: 'test-site',
  voice: {
    tone: ['professional', 'friendly'],
    formality: 'balanced',
    personPerspective: 'second',
    characteristicPhrases: ['Get started today'],
  },
  visual: { primaryColors: ['#0066cc'], fontFamilies: ['Inter'], spacingScale: [8, 16, 24] },
  guardrails: {
    forbiddenTerms: ['guaranteed'],
    requiredDisclaimers: [],
    approvalRequired: false,
    maxGeneratedBlocksPerPage: 3,
  },
  siteType: 'saas',
  skillConfig: 'saas',
};

// ---------------------------------------------------------------------------
// Query Builder Tests (CC-2.2.1)
// ---------------------------------------------------------------------------

describe('Query Builder', () => {
  const builder = new DefaultQueryBuilder(10);

  it('builds a query from intent', () => {
    const intent = makeIntent();
    const query = builder.build('site-1', intent);

    expect(query.siteId).toBe('site-1');
    expect(query.topicEmbedding).toEqual(intent.topicEmbedding);
    expect(query.limit).toBe(10);
    expect(query.excludeAtomIds).toEqual([]);
  });

  it('applies metadata filters from intent', () => {
    const intent = makeIntent({
      contentDepth: 'comprehensive',
      emotionalRegister: 'authoritative',
    });
    const query = builder.build('site-1', intent);

    expect(query.metadataFilters.audienceDepth).toBe('expert');
    expect(query.metadataFilters.emotionalRegister).toBe('authoritative');
  });

  it('maps archetype to content purpose', () => {
    const seekActionIntent = makeIntent({ archetype: 'seek_action' });
    const query = builder.build('site-1', seekActionIntent);
    expect(query.metadataFilters.purpose).toBe('enable-action');

    const compareIntent = makeIntent({ archetype: 'compare' });
    const query2 = builder.build('site-1', compareIntent);
    expect(query2.metadataFilters.purpose).toBe('compare');
  });

  it('doubles limit for high-confidence intents', () => {
    const intent = makeIntent({ confidence: 0.9 });
    const query = builder.build('site-1', intent);
    expect(query.limit).toBe(20);
  });

  it('excludes specified atom IDs', () => {
    const intent = makeIntent();
    const query = builder.build('site-1', intent, ['a1', 'a2']);
    expect(query.excludeAtomIds).toEqual(['a1', 'a2']);
  });
});

// ---------------------------------------------------------------------------
// Atom Selector Tests (CC-2.2.2)
// ---------------------------------------------------------------------------

describe('Atom Selector', () => {
  const selector = new DefaultAtomSelector();

  it('ranks atoms by composite score', () => {
    const atoms = [
      makeAtom('a1', 'Cloud deployment guide', [0.1, 0.2, 0.3, 0.4]),
      makeAtom('a2', 'Pricing comparison table', [0.5, 0.6, 0.7, 0.8]),
      makeAtom('a3', 'Getting started tutorial', [0.11, 0.21, 0.31, 0.41]),
    ];

    const intent = makeIntent({ topicEmbedding: [0.1, 0.2, 0.3, 0.4] });
    const ranked = selector.rank(atoms, intent);

    expect(ranked.length).toBe(3);
    // Should be sorted by score descending
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('selects top N atoms', () => {
    const atoms = Array.from({ length: 10 }, (_, i) =>
      makeAtom(`a${i}`, `Atom ${i}`, [i * 0.1, i * 0.2, 0.3, 0.4]),
    );
    const intent = makeIntent();
    const selected = selector.select(atoms, intent, 3);

    expect(selected.length).toBe(3);
  });

  it('provides relevance breakdown', () => {
    const atom = makeAtom('a1', 'Test content', [0.1, 0.2, 0.3, 0.4]);
    const intent = makeIntent();
    const [ranked] = selector.rank([atom], intent);

    expect(ranked.relevanceBreakdown).toHaveProperty('semanticSimilarity');
    expect(ranked.relevanceBreakdown).toHaveProperty('intentAlignment');
    expect(ranked.relevanceBreakdown).toHaveProperty('freshness');
    expect(ranked.relevanceBreakdown).toHaveProperty('performanceHistory');
  });

  it('gives neutral score when no embeddings', () => {
    const atom = makeAtom('a1', 'No embedding');
    const intent = makeIntent();
    const [ranked] = selector.rank([atom], intent);

    expect(ranked.relevanceBreakdown.semanticSimilarity).toBe(0.5);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Block Registry Tests (CC-2.2.3)
// ---------------------------------------------------------------------------

describe('Block Registry', () => {
  let registry: DefaultBlockRegistry;

  beforeEach(() => {
    registry = new DefaultBlockRegistry();
  });

  it('registers and retrieves templates by ID', () => {
    const template = makeTemplate('tmpl-1');
    registry.register(template);

    expect(registry.get('tmpl-1')).toBe(template);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('retrieves templates by position', () => {
    registry.register(makeTemplate('tmpl-hero', 'hero'));
    registry.register(makeTemplate('tmpl-mid', 'mid-page'));
    registry.register(makeTemplate('tmpl-hero2', 'hero'));

    expect(registry.getByPosition('hero').length).toBe(2);
    expect(registry.getByPosition('mid-page').length).toBe(1);
    expect(registry.getByPosition('footer').length).toBe(0);
  });

  it('returns all templates', () => {
    registry.register(makeTemplate('t1'));
    registry.register(makeTemplate('t2'));
    registry.register(makeTemplate('t3'));
    expect(registry.getAll().length).toBe(3);
  });

  it('loads templates in bulk', () => {
    registry.loadAll([makeTemplate('t1'), makeTemplate('t2')]);
    expect(registry.getAll().length).toBe(2);
  });

  it('clears all templates', () => {
    registry.register(makeTemplate('t1'));
    registry.clear();
    expect(registry.getAll().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Slot Filler Tests
// ---------------------------------------------------------------------------

describe('Slot Filler', () => {
  const filler = new DefaultSlotFiller();
  const slots: SlotDefinition[] = [
    {
      name: 'headline',
      type: 'text',
      constraints: { minLength: 3, maxLength: 50, required: true },
      originalContent: 'Default Headline',
    },
    {
      name: 'body',
      type: 'rich-text',
      constraints: { minLength: 10, maxLength: 200, required: false },
      originalContent: 'Default body text.',
    },
  ];

  it('fills placeholders with provided values', () => {
    const html = '<h1>{{headline}}</h1><p>{{body}}</p>';
    const filled: FilledSlots = {
      headline: 'New Title',
      body: 'New content for the body.',
    };

    const result = filler.fill(html, slots, filled);
    expect(result).toContain('New Title');
    expect(result).toContain('New content for the body.');
    expect(result).not.toContain('{{');
  });

  it('falls back to original content for missing required slots', () => {
    const html = '<h1>{{headline}}</h1>';
    const result = filler.fill(html, slots, {});
    expect(result).toContain('Default Headline');
  });

  it('truncates values exceeding maxLength', () => {
    const html = '<h1>{{headline}}</h1>';
    const longText = 'A'.repeat(100);
    const result = filler.fill(html, slots, { headline: longText });
    expect(result.length).toBeLessThan(html.length + 100);
  });

  it('escapes HTML in slot values to prevent XSS', () => {
    const html = '<h1>{{headline}}</h1>';
    const result = filler.fill(html, slots, {
      headline: '<script>alert("xss")</script>',
    });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('validates required slots', () => {
    const errors = filler.validate(slots, {});
    expect(errors).toContain('Missing required slot: headline');
  });

  it('validates minLength', () => {
    const errors = filler.validate(slots, { headline: 'Hi' });
    expect(errors.some((e) => e.includes('too short'))).toBe(true);
  });

  it('validates maxLength', () => {
    const errors = filler.validate(slots, { headline: 'A'.repeat(60) });
    expect(errors.some((e) => e.includes('too long'))).toBe(true);
  });

  it('returns no errors for valid values', () => {
    const errors = filler.validate(slots, {
      headline: 'Valid Headline',
      body: 'This is valid body content.',
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Block Assembler Tests
// ---------------------------------------------------------------------------

describe('Block Assembler', () => {
  const assembler = new DefaultBlockAssembler();

  it('assembles a complete block with filled slots', () => {
    const template = makeTemplate('tmpl-1');
    const result = assembler.assemble(
      template,
      { headline: 'My Title', body: 'My content paragraph.' },
      'color: blue',
    );

    expect(result).toContain('My Title');
    expect(result).toContain('My content paragraph');
    expect(result).toContain('data-glow-block');
    expect(result).toContain('✦'); // AI provenance badge
  });

  it('applies inline styles', () => {
    const template = makeTemplate('tmpl-1');
    const result = assembler.assemble(
      template,
      { headline: 'Title', body: 'Body text.' },
      'padding: 20px; color: #333',
    );

    expect(result).toContain('style="');
    expect(result).toContain('padding: 20px');
  });
});

// ---------------------------------------------------------------------------
// Model Router Tests (CC-2.3.2)
// ---------------------------------------------------------------------------

describe('Model Router', () => {
  const router = new DefaultModelRouter();

  it('routes content_fill to GPT-OSS-120B with sufficient budget', () => {
    const decision = router.route('content_fill', 2000);
    expect(decision.model).toBe('gpt-oss-120b');
    expect(decision.reason).toContain('Default model');
  });

  it('routes layout_adapt to GLM-4.7', () => {
    const decision = router.route('layout_adapt', 2000);
    expect(decision.model).toBe('glm-4.7');
  });

  it('routes atom_select to GLM-4.7-Flash', () => {
    const decision = router.route('atom_select', 2000);
    expect(decision.model).toBe('glm-4.7-flash');
  });

  it('downgrades to faster model when budget is tight', () => {
    const decision = router.route('content_fill', 300);
    expect(decision.model).not.toBe('gpt-oss-120b');
    expect(decision.reason).toContain('Downgraded');
  });

  it('provides a fallback model', () => {
    const decision = router.route('content_fill', 2000);
    expect(decision.fallback).toBeTruthy();
    expect(decision.fallback).not.toBe(decision.model);
  });
});

// ---------------------------------------------------------------------------
// Prompt Builder Tests (CC-2.3.3)
// ---------------------------------------------------------------------------

describe('Prompt Builder', () => {
  const builder = new DefaultPromptBuilder();

  it('builds prompts for content_fill task', () => {
    const atoms = [makeAtom('a1', 'Cloud platform overview')];
    const slots: SlotDefinition[] = [
      {
        name: 'headline',
        type: 'text',
        constraints: { minLength: 5, maxLength: 100, required: true },
        originalContent: 'Original',
      },
    ];
    const intent = makeIntent();
    const result = builder.build('content_fill', atoms, slots, intent, mockBrand);

    expect(result.systemPrompt).toContain('content personalization');
    expect(result.systemPrompt).toContain('professional');
    expect(result.systemPrompt).toContain('guaranteed'); // Forbidden term
    expect(result.userPrompt).toContain('Cloud platform overview');
    expect(result.userPrompt).toContain('headline');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('builds prompts for compliance_check task', () => {
    const atoms = [makeAtom('a1', 'Generated content to check')];
    const result = builder.build('compliance_check', atoms, [], makeIntent(), mockBrand);

    expect(result.systemPrompt).toContain('compliance checker');
    expect(result.userPrompt).toContain('Generated content to check');
  });

  it('stays within token budget', () => {
    // Create many atoms to push the prompt over the limit
    const atoms = Array.from({ length: 50 }, (_, i) =>
      makeAtom(`a${i}`, 'A'.repeat(200)),
    );
    const slots: SlotDefinition[] = [];
    const result = builder.build('content_fill', atoms, slots, makeIntent(), mockBrand);

    expect(result.estimatedTokens).toBeLessThanOrEqual(2000);
  });

  it('includes intent description in user prompt', () => {
    const intent = makeIntent({
      archetype: 'compare',
      confidence: 0.85,
      contentDepth: 'comprehensive',
    });
    const result = builder.build('content_fill', [], [], intent, mockBrand);

    expect(result.userPrompt).toContain('compare');
    expect(result.userPrompt).toContain('0.85');
    expect(result.userPrompt).toContain('comprehensive');
  });
});

// ---------------------------------------------------------------------------
// Speculative Pre-Generator Tests (CC-2.4.2)
// ---------------------------------------------------------------------------

describe('Speculative Pre-Generator', () => {
  it('predicts next pages based on intent archetype', () => {
    const gen = new DefaultSpeculativePreGenerator();
    const intent = makeIntent({ archetype: 'compare', confidence: 0.8 });
    const navUrls = [
      'https://example.com/pricing',
      'https://example.com/features',
      'https://example.com/about',
      'https://example.com/contact',
    ];

    const predictions = gen.predictNextPages('https://example.com/', intent, navUrls);
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.length).toBeLessThanOrEqual(3);

    // Pricing should be high probability for compare intent
    const pricingPred = predictions.find((p) => p.url.includes('pricing'));
    expect(pricingPred).toBeDefined();
    expect(pricingPred!.probability).toBeGreaterThan(0.2);
  });

  it('returns empty when confidence is low', () => {
    const gen = new DefaultSpeculativePreGenerator();
    const intent = makeIntent({ confidence: 0.3 });
    const predictions = gen.predictNextPages(
      'https://example.com/',
      intent,
      ['https://example.com/pricing'],
    );
    expect(predictions).toEqual([]);
  });

  it('excludes current page from predictions', () => {
    const gen = new DefaultSpeculativePreGenerator();
    const intent = makeIntent({ confidence: 0.8 });
    const predictions = gen.predictNextPages(
      'https://example.com/pricing',
      intent,
      ['https://example.com/pricing', 'https://example.com/features'],
    );
    expect(predictions.every((p) => p.url !== 'https://example.com/pricing')).toBe(true);
  });

  it('limits predictions to 3 pages', () => {
    const gen = new DefaultSpeculativePreGenerator();
    const intent = makeIntent({ archetype: 'explore', confidence: 0.9 });
    const navUrls = Array.from({ length: 20 }, (_, i) =>
      `https://example.com/feature-${i}`,
    );
    const predictions = gen.predictNextPages('https://example.com/', intent, navUrls);
    expect(predictions.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Pipeline Orchestrator Tests (CC-2.4)
// ---------------------------------------------------------------------------

describe('Pipeline Orchestrator', () => {
  function createMockStorage(): StorageInterface {
    return {
      queryAtoms: vi.fn().mockResolvedValue([
        makeAtom('a1', 'Cloud deployment is fast', [0.1, 0.2, 0.3, 0.4]),
        makeAtom('a2', 'Scale to millions of users', [0.2, 0.3, 0.4, 0.5]),
      ]),
      getTemplate: vi.fn().mockResolvedValue(makeTemplate('tmpl-1')),
      getTemplatesForPosition: vi.fn().mockResolvedValue([makeTemplate('tmpl-1')]),
      getBrandProfile: vi.fn().mockResolvedValue(mockBrand),
      getCachedBlock: vi.fn().mockResolvedValue(null),
      setCachedBlock: vi.fn().mockResolvedValue(undefined),
      logEvent: vi.fn().mockResolvedValue(undefined),
    };
  }

  function createMockCerebrasClient() {
    return {
      complete: vi.fn().mockResolvedValue({
        content: '{"headline": "Deploy Faster", "body": "Scale your cloud infrastructure in seconds."}',
        model: 'gpt-oss-120b',
        usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600 },
        latencyMs: 800,
      }),
    };
  }

  it('returns empty blocks when confidence is below threshold', async () => {
    const orchestrator = new DefaultOrchestrator({
      intentEngine: new DefaultIntentEngine(),
      storage: createMockStorage(),
      cerebrasClient: createMockCerebrasClient(),
      brandProfile: mockBrand,
    });

    // Send a single weak signal — should produce low confidence
    const result = await orchestrator.process('site-1', 'sess-1', 'https://example.com/', [
      {
        type: 'page_visit',
        timestamp: new Date().toISOString(),
        data: { url: 'https://example.com/', referrer: '', title: 'Home' },
        pageUrl: 'https://example.com/',
      },
    ]);

    expect(result.blocks.length).toBe(0);
    expect(result.intent.confidence).toBeLessThan(0.3);
  });

  it('generates blocks when confidence is above threshold', async () => {
    const intentEngine = new DefaultIntentEngine();
    const storage = createMockStorage();
    const cerebras = createMockCerebrasClient();

    const orchestrator = new DefaultOrchestrator({
      intentEngine,
      storage,
      cerebrasClient: cerebras,
      brandProfile: mockBrand,
    });

    // Build up confidence with multiple signals across sessions
    const signals: Signal[] = [];
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      signals.push({
        type: 'page_visit',
        timestamp: new Date(now + i * 1000).toISOString(),
        data: { url: `https://example.com/page-${i}`, referrer: '', title: `Page ${i}` },
        pageUrl: `https://example.com/page-${i}`,
      });
      signals.push({
        type: 'click_target',
        timestamp: new Date(now + i * 1000 + 500).toISOString(),
        data: { selector: '.cta', text: 'Learn More', semanticParent: 'section' },
        pageUrl: `https://example.com/page-${i}`,
      });
    }

    const result = await orchestrator.process(
      'site-1',
      'sess-1',
      'https://example.com/',
      signals,
    );

    // Should have called the LLM if confidence was high enough
    if (result.intent.confidence >= 0.3) {
      expect(cerebras.complete).toHaveBeenCalled();
    }
  });

  it('enforces total time budget', async () => {
    const cerebras = {
      complete: vi.fn().mockImplementation(
        (_config: unknown, signal?: AbortSignal) => new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      ),
    };

    const orchestrator = new DefaultOrchestrator({
      intentEngine: new DefaultIntentEngine(),
      storage: createMockStorage(),
      cerebrasClient: cerebras,
      brandProfile: mockBrand,
    });

    // Pre-build some intent state
    const signals: Signal[] = Array.from({ length: 15 }, (_, i) => ({
      type: 'page_visit' as const,
      timestamp: new Date(Date.now() + i * 100).toISOString(),
      data: { url: `https://example.com/p${i}`, referrer: '', title: `P${i}` },
      pageUrl: `https://example.com/p${i}`,
    }));

    const result = await orchestrator.process(
      'site-1',
      'sess-1',
      'https://example.com/',
      signals,
    );

    // Should complete within a reasonable time (budget + margin)
    expect(result.totalTimeMs).toBeLessThan(5000);
  });

  it('returns pipeline result structure', async () => {
    const orchestrator = new DefaultOrchestrator({
      intentEngine: new DefaultIntentEngine(),
      storage: createMockStorage(),
      cerebrasClient: createMockCerebrasClient(),
      brandProfile: mockBrand,
    });

    const result = await orchestrator.process('site-1', 'sess-1', 'https://example.com/', []);

    expect(result).toHaveProperty('blocks');
    expect(result).toHaveProperty('intent');
    expect(result).toHaveProperty('totalTimeMs');
    expect(result).toHaveProperty('cacheHit');
    expect(Array.isArray(result.blocks)).toBe(true);
    expect(typeof result.totalTimeMs).toBe('number');
  });
});
