import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentAtom, ContentMetadata } from '../../core/types.js';
import {
  chunkAtoms,
  estimateTokens,
  type ContentChunk,
} from '../../indexer/chunker.js';
import {
  applyEmbeddingsToAtoms,
  type EmbeddingResult,
} from '../../indexer/embedder.js';
import {
  buildFallbackProfile,
} from '../../indexer/profiler.js';
import {
  classifySiteType,
  type ClassificationResult,
} from '../../core/skills/classifier.js';
import {
  getSkillConfigName,
  getAvailableSkillNames,
  loadDefaultSkillConfig,
  DEFAULT_SKILL_CONFIGS,
} from '../../core/skills/loader.js';
import {
  buildIndexMetadata,
  writeContentIndex,
  InMemoryIndexWriter,
} from '../../indexer/storage-writers.js';
import type { ContentIndex, BrandProfile, BlockTemplate } from '../../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAtom(
  id: string,
  content: string,
  contentType: ContentAtom['contentType'] = 'body',
): ContentAtom {
  return {
    id,
    content,
    sourceUrl: 'https://example.com/',
    blockPosition: 0,
    contentType,
    metadata: {
      topics: [],
      audienceDepth: 'novice',
      purpose: 'inform',
      emotionalRegister: 'rational',
      wordCount: content.split(/\s+/).length,
      language: 'en',
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeLongText(words: number): string {
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  const wordsPerSentence = 9;
  const repeats = Math.ceil(words / wordsPerSentence);
  return sentence.repeat(repeats).trim();
}

// ---------------------------------------------------------------------------
// Chunker Tests (CC-1.5.1)
// ---------------------------------------------------------------------------

describe('Content Chunker', () => {
  it('estimates token count from text length', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars / 4 = 1.25 → ceil = 2
    expect(estimateTokens('a'.repeat(100))).toBe(25); // 100/4
    expect(estimateTokens('')).toBe(0);
  });

  it('keeps small atoms as single chunks', () => {
    const atom = makeAtom('a1', 'Short paragraph of text.');
    const chunks = chunkAtoms([atom]);

    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe(atom.content);
    expect(chunks[0].sourceAtomIds).toEqual(['a1']);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(1);
  });

  it('splits large atoms at sentence boundaries', () => {
    // Create an atom with ~600 tokens (2400+ chars)
    const longText = makeLongText(600);
    const atom = makeAtom('a1', longText);
    const chunks = chunkAtoms([atom], { maxTokens: 512, minTokens: 256 });

    expect(chunks.length).toBeGreaterThan(1);

    // All chunks should reference the source atom
    for (const chunk of chunks) {
      expect(chunk.sourceAtomIds).toContain('a1');
      expect(chunk.tokenCount).toBeLessThanOrEqual(512);
    }

    // Reconstruct: all text should be present
    const reconstructed = chunks.map((c) => c.text).join(' ');
    // Allow minor whitespace differences
    expect(reconstructed.replace(/\s+/g, ' ').length).toBeGreaterThan(0);
  });

  it('merges small adjacent atoms when mergeSmall is true', () => {
    const atoms = [
      makeAtom('a1', 'Small text one.', 'headline'),
      makeAtom('a2', 'Small text two.', 'body'),
      makeAtom('a3', 'Small text three.', 'cta'),
    ];

    const chunks = chunkAtoms(atoms, { mergeSmall: true, maxTokens: 512, minTokens: 256 });

    // All three small atoms should be merged into one chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].sourceAtomIds).toEqual(['a1', 'a2', 'a3']);
    expect(chunks[0].text).toContain('Small text one');
    expect(chunks[0].text).toContain('Small text three');
  });

  it('does not merge when mergeSmall is false', () => {
    const atoms = [
      makeAtom('a1', 'Small text one.', 'headline'),
      makeAtom('a2', 'Small text two.', 'body'),
    ];

    const chunks = chunkAtoms(atoms, { mergeSmall: false });
    expect(chunks.length).toBe(2);
    expect(chunks[0].sourceAtomIds).toEqual(['a1']);
    expect(chunks[1].sourceAtomIds).toEqual(['a2']);
  });

  it('preserves metadata linkage', () => {
    const atom = makeAtom('a1', 'Test content here.');
    atom.metadata.topics = ['cloud', 'deploy'];

    const chunks = chunkAtoms([atom]);
    expect(chunks[0].metadata.topics).toEqual(['cloud', 'deploy']);
  });

  it('generates unique chunk IDs', () => {
    const atoms = [
      makeAtom('a1', makeLongText(600)),
      makeAtom('a2', makeLongText(600)),
    ];
    const chunks = chunkAtoms(atoms, { mergeSmall: false, maxTokens: 512 });

    const ids = chunks.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Embedder Tests (CC-1.5.2)
// ---------------------------------------------------------------------------

describe('Embedding Applicator', () => {
  it('applies embeddings to atoms by source ID', () => {
    const atoms = [
      makeAtom('a1', 'First atom'),
      makeAtom('a2', 'Second atom'),
      makeAtom('a3', 'Third atom'),
    ];

    const embeddings: EmbeddingResult[] = [
      { chunkId: 'a1_c0', embedding: [0.1, 0.2], sourceAtomIds: ['a1'] },
      { chunkId: 'a2_c0', embedding: [0.3, 0.4], sourceAtomIds: ['a2'] },
    ];

    const result = applyEmbeddingsToAtoms(atoms, embeddings);

    expect(result[0].embedding).toEqual([0.1, 0.2]);
    expect(result[1].embedding).toEqual([0.3, 0.4]);
    expect(result[2].embedding).toBeUndefined(); // No embedding for a3
  });

  it('uses first chunk embedding for multi-chunk atoms', () => {
    const atoms = [makeAtom('a1', 'Content')];
    const embeddings: EmbeddingResult[] = [
      { chunkId: 'a1_c0', embedding: [0.1, 0.2], sourceAtomIds: ['a1'] },
      { chunkId: 'a1_c1', embedding: [0.5, 0.6], sourceAtomIds: ['a1'] },
    ];

    const result = applyEmbeddingsToAtoms(atoms, embeddings);
    // First chunk wins
    expect(result[0].embedding).toEqual([0.1, 0.2]);
  });

  it('handles merged chunks referencing multiple atoms', () => {
    const atoms = [
      makeAtom('a1', 'First'),
      makeAtom('a2', 'Second'),
    ];
    const embeddings: EmbeddingResult[] = [
      { chunkId: 'merged_c0', embedding: [0.7, 0.8], sourceAtomIds: ['a1', 'a2'] },
    ];

    const result = applyEmbeddingsToAtoms(atoms, embeddings);
    expect(result[0].embedding).toEqual([0.7, 0.8]);
    expect(result[1].embedding).toEqual([0.7, 0.8]);
  });
});

// ---------------------------------------------------------------------------
// Site Type Classifier Tests (CC-1.5.4)
// ---------------------------------------------------------------------------

describe('Site Type Classifier', () => {
  it('classifies pharma sites', () => {
    const result = classifySiteType(
      ['https://example.com/prescribing-info', 'https://example.com/patient'],
      ['Important Safety Information. Consult your healthcare provider. FDA-approved indication.'],
      [{ '@type': 'Drug' }],
    );

    expect(result.siteType).toBe('pharma');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.indicators.length).toBeGreaterThan(0);
  });

  it('classifies ecommerce sites', () => {
    const result = classifySiteType(
      ['https://example.com/products/widget', 'https://example.com/shop/shoes'],
      ['Add to cart. Free shipping on orders over $50. $29.99. Product reviews.'],
      [{ '@type': 'Product' }],
    );

    expect(result.siteType).toBe('ecommerce');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies SaaS sites', () => {
    const result = classifySiteType(
      ['https://example.com/pricing', 'https://example.com/features', 'https://example.com/docs/api'],
      ['Free trial. Get started. $49 per month. Enterprise plan. API key. SDK integration. 99.9% uptime SLA.'],
    );

    expect(result.siteType).toBe('saas');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies media sites', () => {
    const result = classifySiteType(
      ['https://example.com/2024/01/article/breaking', 'https://example.com/news/politics'],
      ['Published on January 5. by John Smith. Read more related articles. 5 minutes read.'],
      [{ '@type': 'NewsArticle' }],
    );

    expect(result.siteType).toBe('media');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies corporate sites', () => {
    const result = classifySiteType(
      ['https://example.com/about-us', 'https://example.com/careers', 'https://example.com/investor'],
      ['Our mission and values. Investor relations. Board of directors. Founded in 2005.'],
      [{ '@type': 'Organization' }],
    );

    expect(result.siteType).toBe('corporate');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('falls back to other for unrecognized sites', () => {
    const result = classifySiteType(
      ['https://example.com/'],
      ['Hello world.'],
    );

    expect(result.siteType).toBe('other');
    expect(result.confidence).toBe(0);
  });

  it('returns indicators explaining the classification', () => {
    const result = classifySiteType(
      ['https://example.com/shop/'],
      ['Add to cart. Buy now.'],
      [{ '@type': 'Product' }],
    );

    expect(result.indicators.length).toBeGreaterThan(0);
    expect(result.indicators.some((i) => i.startsWith('content:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skill Loader Tests (CC-1.5.5)
// ---------------------------------------------------------------------------

describe('Skill Loader', () => {
  it('maps site types to skill config names', () => {
    expect(getSkillConfigName('pharma')).toBe('pharma');
    expect(getSkillConfigName('ecommerce')).toBe('ecommerce');
    expect(getSkillConfigName('saas')).toBe('saas');
    expect(getSkillConfigName('other')).toBe('generic');
  });

  it('lists available skill names', () => {
    const names = getAvailableSkillNames();
    expect(names).toContain('pharma');
    expect(names).toContain('ecommerce');
    expect(names).toContain('generic');
  });

  it('loads default skill config for each type', () => {
    for (const name of getAvailableSkillNames()) {
      const config = loadDefaultSkillConfig(name);
      expect(config).not.toBeNull();
      expect(config!.siteType).toBeTruthy();
    }
  });

  it('pharma skill has strict guardrails', () => {
    const config = DEFAULT_SKILL_CONFIGS['pharma'];
    expect(config.generationConstraints.maxBlocksPerPage).toBe(1);
    expect(config.generationConstraints.requiredDisclaimers.length).toBeGreaterThan(0);
    expect(config.generationConstraints.forbiddenTopics).toContain('off-label use');
  });

  it('returns generic config for unknown types', () => {
    const config = loadDefaultSkillConfig('unknown');
    expect(config).not.toBeNull();
    expect(config!.siteType).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// Brand Profiler Fallback Tests (CC-1.5.3)
// ---------------------------------------------------------------------------

describe('Brand Profiler (fallback)', () => {
  it('builds a fallback profile without LLM', () => {
    const atoms = [
      makeAtom('a1', "We're building the future of cloud computing. You'll love it."),
      makeAtom('a2', "Don't worry — we've got you covered with 24/7 support."),
    ];

    const profile = buildFallbackProfile(
      'test-site',
      atoms,
      [],
      'saas',
      'saas',
    );

    expect(profile.siteId).toBe('test-site');
    expect(profile.siteType).toBe('saas');
    expect(profile.skillConfig).toBe('saas');
    expect(profile.voice.formality).toBe('balanced'); // some contractions, but not enough for casual
    expect(profile.voice.personPerspective).toBe('second'); // "you" appears more than "we"
  });

  it('detects formal voice', () => {
    const atoms = [
      makeAtom('a1', 'The organization has demonstrated sustained growth in fiscal year 2024.'),
      makeAtom('a2', 'Shareholders are invited to review the annual report for comprehensive details.'),
    ];

    const profile = buildFallbackProfile('corp', atoms, [], 'corporate', 'corporate');
    expect(profile.voice.formality).toBe('formal');
  });

  it('infers pharma guardrails', () => {
    const profile = buildFallbackProfile('pharma-site', [], [], 'pharma', 'pharma');
    expect(profile.guardrails.approvalRequired).toBe(true);
    expect(profile.guardrails.maxGeneratedBlocksPerPage).toBe(1);
    expect(profile.guardrails.forbiddenTerms).toContain('cure');
  });
});

// ---------------------------------------------------------------------------
// Storage Writers Tests (CC-1.5.7)
// ---------------------------------------------------------------------------

describe('Storage Writers', () => {
  const mockProfile: BrandProfile = {
    siteId: 'test',
    voice: {
      tone: ['professional'],
      formality: 'balanced',
      personPerspective: 'second',
      characteristicPhrases: [],
    },
    visual: { primaryColors: [], fontFamilies: [], spacingScale: [] },
    guardrails: {
      forbiddenTerms: [],
      requiredDisclaimers: [],
      approvalRequired: false,
      maxGeneratedBlocksPerPage: 3,
    },
    siteType: 'saas',
    skillConfig: 'saas',
  };

  const mockIndex: ContentIndex = {
    siteId: 'test',
    atoms: [makeAtom('a1', 'Test content')],
    templates: [],
    brandProfile: mockProfile,
    crawledAt: '2026-03-08T00:00:00Z',
    pageCount: 5,
  };

  it('builds index metadata correctly', () => {
    const meta = buildIndexMetadata(mockIndex, 'https://example.com/');
    expect(meta.siteId).toBe('test');
    expect(meta.atomCount).toBe(1);
    expect(meta.templateCount).toBe(0);
    expect(meta.pageCount).toBe(5);
    expect(meta.siteType).toBe('saas');
    expect(meta.seedUrl).toBe('https://example.com/');
    expect(meta.version).toBe(1);
  });

  it('writes index to in-memory writer', async () => {
    const writer = new InMemoryIndexWriter();
    await writeContentIndex(mockIndex, writer, 'https://example.com/');

    expect(writer.atoms.get('test')?.length).toBe(1);
    expect(writer.templates.get('test')?.length).toBe(0);
    expect(writer.profiles.get('test')?.siteType).toBe('saas');
    expect(writer.snapshots.get('test')).toBe(mockIndex);
    expect(writer.metadata.get('test')?.atomCount).toBe(1);
  });

  it('InMemoryIndexWriter starts empty', () => {
    const writer = new InMemoryIndexWriter();
    expect(writer.atoms.size).toBe(0);
    expect(writer.templates.size).toBe(0);
    expect(writer.profiles.size).toBe(0);
  });
});
