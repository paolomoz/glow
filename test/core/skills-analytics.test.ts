// test/core/skills-analytics.test.ts — Tests for skills validation, hot-loading, and analytics

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSkillConfig } from '../../core/skills/validator.js';
import { SkillHotLoader } from '../../core/skills/hot-loader.js';
import { loadDefaultSkillConfig, DEFAULT_SKILL_CONFIGS } from '../../core/skills/loader.js';
import { DefaultEngagementTracker } from '../../core/analytics/tracker.js';
import { DefaultAtomScorer } from '../../core/analytics/scorer.js';
import { DefaultGapAnalyzer } from '../../core/analytics/gaps.js';
import type {
  SkillConfig,
  ContentAtom,
  BlockTemplate,
  AnalyticsEvent,
  StorageInterface,
} from '@glow/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAtom(overrides: Partial<ContentAtom> = {}): ContentAtom {
  return {
    id: `atom-${Math.random().toString(36).slice(2, 6)}`,
    content: 'Test content',
    sourceUrl: 'https://example.com',
    blockPosition: 0,
    contentType: 'body',
    metadata: {
      topics: ['test'],
      audienceDepth: 'intermediate',
      purpose: 'inform',
      emotionalRegister: 'rational',
      wordCount: 50,
      language: 'en',
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    type: 'impression',
    sessionId: 'sess-1',
    pageUrl: 'https://example.com',
    blockId: 'block-1',
    atomIds: ['atom-1'],
    isGenerative: true,
    timestamp: new Date().toISOString(),
    data: {},
    ...overrides,
  };
}

function makeMockStorage(): StorageInterface {
  return {
    queryAtoms: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn().mockResolvedValue(null),
    getTemplatesForPosition: vi.fn().mockResolvedValue([]),
    getBrandProfile: vi.fn().mockResolvedValue(null),
    getCachedBlock: vi.fn().mockResolvedValue(null),
    setCachedBlock: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Skill Config Validator
// ---------------------------------------------------------------------------

describe('validateSkillConfig', () => {
  it('validates a valid pharma config', () => {
    const result = validateSkillConfig(DEFAULT_SKILL_CONFIGS.pharma);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates all built-in configs', () => {
    for (const [name, config] of Object.entries(DEFAULT_SKILL_CONFIGS)) {
      const result = validateSkillConfig(config);
      expect(result.valid).toBe(true);
    }
  });

  it('rejects null config', () => {
    const result = validateSkillConfig(null);
    expect(result.valid).toBe(false);
  });

  it('rejects config with invalid siteType', () => {
    const result = validateSkillConfig({ siteType: 'invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('siteType'))).toBe(true);
  });

  it('rejects config with invalid signal weights', () => {
    const result = validateSkillConfig({
      siteType: 'pharma',
      signalWeights: { invalid_signal: 1.0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid signal type'))).toBe(true);
  });

  it('rejects signal weights out of range', () => {
    const result = validateSkillConfig({
      siteType: 'pharma',
      signalWeights: { click_target: 10 },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid archetype indicators', () => {
    const result = validateSkillConfig({
      siteType: 'pharma',
      intentOverrides: {
        archetypeIndicators: { nonexistent: ['test'] },
        confidenceBoosts: {},
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid archetype'))).toBe(true);
  });

  it('rejects maxBlocksPerPage out of range', () => {
    const result = validateSkillConfig({
      siteType: 'pharma',
      generationConstraints: { maxBlocksPerPage: 20 },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects disclaimers missing required fields', () => {
    const result = validateSkillConfig({
      siteType: 'pharma',
      generationConstraints: {
        requiredDisclaimers: [{ trigger: 'test' }], // missing text
      },
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Skill Hot Loader
// ---------------------------------------------------------------------------

describe('SkillHotLoader', () => {
  it('loads built-in configs when no external loader', async () => {
    const loader = new SkillHotLoader();
    const config = await loader.load('pharma');
    expect(config.siteType).toBe('pharma');
    expect(config.generationConstraints.maxBlocksPerPage).toBe(1);
  });

  it('caches loaded configs', async () => {
    const loader = new SkillHotLoader();
    const c1 = await loader.load('pharma');
    const c2 = await loader.load('pharma');
    expect(c1).toBe(c2); // same reference
  });

  it('falls back to generic for unknown types', async () => {
    const loader = new SkillHotLoader();
    const config = await loader.load('nonexistent');
    expect(config.siteType).toBe('other');
  });

  it('loads from external source when available', async () => {
    const customConfig: SkillConfig = {
      ...DEFAULT_SKILL_CONFIGS.pharma,
      generationConstraints: {
        ...DEFAULT_SKILL_CONFIGS.pharma.generationConstraints,
        maxBlocksPerPage: 5,
      },
    };

    const externalLoader = {
      load: vi.fn().mockResolvedValue(customConfig),
    };

    const loader = new SkillHotLoader({ externalLoader });
    const config = await loader.load('pharma');

    expect(config.generationConstraints.maxBlocksPerPage).toBe(5);
    expect(externalLoader.load).toHaveBeenCalledWith('pharma');
  });

  it('falls back to builtin when external fails', async () => {
    const externalLoader = {
      load: vi.fn().mockRejectedValue(new Error('network error')),
    };

    const loader = new SkillHotLoader({ externalLoader });
    const config = await loader.load('pharma');

    expect(config.siteType).toBe('pharma');
    expect(config.generationConstraints.maxBlocksPerPage).toBe(1);
  });

  it('falls back to builtin when external returns invalid config', async () => {
    const externalLoader = {
      load: vi.fn().mockResolvedValue({ siteType: 'invalid' }),
    };

    const loader = new SkillHotLoader({ externalLoader });
    const config = await loader.load('pharma');
    expect(config.siteType).toBe('pharma'); // fell back to builtin
  });

  it('invalidates cache', async () => {
    const loader = new SkillHotLoader();
    const c1 = await loader.load('pharma');

    loader.setConfig('pharma', {
      ...DEFAULT_SKILL_CONFIGS.pharma,
      generationConstraints: {
        ...DEFAULT_SKILL_CONFIGS.pharma.generationConstraints,
        maxBlocksPerPage: 10,
      },
    });

    const c2 = await loader.load('pharma');
    expect(c2.generationConstraints.maxBlocksPerPage).toBe(10);

    loader.invalidate('pharma');
    const c3 = await loader.load('pharma');
    expect(c3.generationConstraints.maxBlocksPerPage).toBe(1); // back to builtin
  });
});

// ---------------------------------------------------------------------------
// Engagement Tracker
// ---------------------------------------------------------------------------

describe('DefaultEngagementTracker', () => {
  let storage: StorageInterface;
  let tracker: DefaultEngagementTracker;

  beforeEach(() => {
    storage = makeMockStorage();
    tracker = new DefaultEngagementTracker(storage, { flushSize: 5 });
  });

  it('buffers events', () => {
    tracker.trackImpression(makeEvent());
    tracker.trackInteraction(makeEvent());
    expect(tracker.pendingCount).toBe(2);
  });

  it('flushes events to storage', async () => {
    tracker.trackImpression(makeEvent());
    tracker.trackInteraction(makeEvent());
    tracker.trackDwell(makeEvent());

    await tracker.flush();

    expect(storage.logEvent).toHaveBeenCalledTimes(3);
    expect(tracker.pendingCount).toBe(0);
  });

  it('sets correct event types', async () => {
    tracker.trackImpression(makeEvent());
    tracker.trackConversion(makeEvent());

    await tracker.flush();

    const calls = (storage.logEvent as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].type).toBe('impression');
    expect(calls[1][0].type).toBe('conversion');
  });

  it('does nothing when flushing empty buffer', async () => {
    await tracker.flush();
    expect(storage.logEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Atom Scorer
// ---------------------------------------------------------------------------

describe('DefaultAtomScorer', () => {
  const scorer = new DefaultAtomScorer();

  describe('score', () => {
    it('computes engagement rate', () => {
      const atom = makeAtom();
      const perf = scorer.score(atom, {
        impressions: 100,
        interactions: 20,
        conversions: 5,
      });

      expect(perf.engagementRate).toBeCloseTo(0.2);
      expect(perf.conversionLift).toBeCloseTo(0.05);
      expect(perf.usageCount).toBe(1);
    });

    it('handles zero impressions', () => {
      const atom = makeAtom();
      const perf = scorer.score(atom, {
        impressions: 0,
        interactions: 0,
        conversions: 0,
      });

      expect(perf.engagementRate).toBe(0);
      expect(perf.conversionLift).toBe(0);
    });

    it('accumulates usage count from existing performance', () => {
      const atom = makeAtom({
        performance: {
          usageCount: 5,
          impressions: 50,
          engagementRate: 0.1,
          conversionLift: 0.02,
          lastUsed: new Date().toISOString(),
          audienceBreakdown: {} as any,
        },
      });

      const perf = scorer.score(atom, {
        impressions: 10,
        interactions: 2,
        conversions: 0,
      });

      expect(perf.usageCount).toBe(6);
      expect(perf.impressions).toBe(60);
    });
  });

  describe('aggregate', () => {
    it('aggregates events for a specific atom', () => {
      const events = [
        makeEvent({ type: 'impression', atomIds: ['atom-1'] }),
        makeEvent({ type: 'impression', atomIds: ['atom-1'] }),
        makeEvent({ type: 'interaction', atomIds: ['atom-1'] }),
        makeEvent({ type: 'conversion', atomIds: ['atom-1'] }),
        makeEvent({ type: 'impression', atomIds: ['atom-2'] }), // different atom
        makeEvent({ type: 'dwell', atomIds: ['atom-1'], data: { dwellMs: 3000 } }),
      ];

      const metrics = scorer.aggregate('atom-1', events);

      expect(metrics.impressions).toBe(2);
      expect(metrics.interactions).toBe(1);
      expect(metrics.conversions).toBe(1);
      expect(metrics.totalDwellMs).toBe(3000);
    });

    it('returns zeros for atom with no events', () => {
      const metrics = scorer.aggregate('nonexistent', [
        makeEvent({ atomIds: ['other'] }),
      ]);

      expect(metrics.impressions).toBe(0);
      expect(metrics.interactions).toBe(0);
    });
  });

  describe('rank', () => {
    it('ranks atoms by performance score', () => {
      const highPerf = makeAtom({
        id: 'high',
        performance: {
          usageCount: 10,
          impressions: 100,
          engagementRate: 0.3,
          conversionLift: 0.1,
          lastUsed: new Date().toISOString(),
          audienceBreakdown: {} as any,
        },
      });

      const lowPerf = makeAtom({
        id: 'low',
        performance: {
          usageCount: 5,
          impressions: 100,
          engagementRate: 0.01,
          conversionLift: 0.001,
          lastUsed: new Date().toISOString(),
          audienceBreakdown: {} as any,
        },
      });

      const noPerf = makeAtom({ id: 'none' });

      const ranked = scorer.rank([noPerf, lowPerf, highPerf]);

      expect(ranked[0].atom.id).toBe('high');
      expect(ranked[0].performanceScore).toBeGreaterThan(ranked[1].performanceScore);
      expect(ranked[2].performanceScore).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Gap Analyzer
// ---------------------------------------------------------------------------

describe('DefaultGapAnalyzer', () => {
  const analyzer = new DefaultGapAnalyzer();

  describe('findContentGaps', () => {
    it('detects low-engagement archetypes', () => {
      const atoms = [makeAtom()];
      const events: AnalyticsEvent[] = [];

      // Create 20 impressions but only 0 interactions for 'explore'
      for (let i = 0; i < 20; i++) {
        events.push(
          makeEvent({ type: 'impression', data: { archetype: 'explore' } }),
        );
      }

      const gaps = analyzer.findContentGaps(atoms, events);
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0].severity).toBe('high');
      expect(gaps[0].intentPattern).toBe('explore');
    });

    it('detects missing content purposes', () => {
      // Atoms with only 'inform' purpose — missing compare, persuade, enable-action
      const atoms = [
        makeAtom({ metadata: { ...makeAtom().metadata, purpose: 'inform' } }),
      ];

      const gaps = analyzer.findContentGaps(atoms, []);
      const missingPurposes = gaps.filter((g) =>
        g.description.includes('No content atoms with purpose'),
      );
      expect(missingPurposes.length).toBeGreaterThan(0);
    });

    it('returns no gaps for well-covered content', () => {
      const atoms = [
        makeAtom({ metadata: { ...makeAtom().metadata, purpose: 'inform' } }),
        makeAtom({ metadata: { ...makeAtom().metadata, purpose: 'compare' } }),
        makeAtom({ metadata: { ...makeAtom().metadata, purpose: 'persuade' } }),
        makeAtom({ metadata: { ...makeAtom().metadata, purpose: 'enable-action' } }),
      ];

      const gaps = analyzer.findContentGaps(atoms, []);
      // Only missing purpose gaps should be gone
      const purposeGaps = gaps.filter((g) => g.description.includes('No content atoms'));
      expect(purposeGaps).toHaveLength(0);
    });
  });

  describe('findTemplateGaps', () => {
    it('detects missing positions', () => {
      const templates: BlockTemplate[] = [
        {
          id: 't1',
          siteId: 'example.com',
          sourceUrl: 'https://example.com',
          blockType: 'hero',
          selector: '#hero',
          htmlShell: '<div>{{title}}</div>',
          cssRules: '',
          slots: [],
          responsive: { mobile: '', tablet: '', desktop: '' },
          position: 'hero',
        },
      ];

      const gaps = analyzer.findTemplateGaps(templates, []);

      // Should report missing above-fold, mid-page, below-fold, footer
      expect(gaps.length).toBe(4);
      expect(gaps.every((g) => g.description.includes('No block templates'))).toBe(true);
    });

    it('detects low-engagement templates', () => {
      const templates: BlockTemplate[] = [
        {
          id: 'poor-template',
          siteId: 'example.com',
          sourceUrl: 'https://example.com',
          blockType: 'mid',
          selector: '.section-mid-page',
          htmlShell: '<div></div>',
          cssRules: '',
          slots: [],
          responsive: { mobile: '', tablet: '', desktop: '' },
          position: 'mid-page',
        },
      ];

      const events: AnalyticsEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(
          makeEvent({ type: 'impression', blockId: 'poor-template' }),
        );
      }
      // 0 interactions = 0% engagement

      const gaps = analyzer.findTemplateGaps(templates, events);
      const templateGap = gaps.find((g) => g.templateId === 'poor-template');
      expect(templateGap).toBeDefined();
      expect(templateGap!.engagementRate).toBe(0);
    });
  });

  describe('findAudienceGaps', () => {
    it('detects underrepresented audience depths', () => {
      const atoms: ContentAtom[] = [];

      // 10 intermediate, 1 expert, 0 novice
      for (let i = 0; i < 10; i++) {
        atoms.push(
          makeAtom({ metadata: { ...makeAtom().metadata, audienceDepth: 'intermediate' } }),
        );
      }
      atoms.push(
        makeAtom({ metadata: { ...makeAtom().metadata, audienceDepth: 'expert' } }),
      );

      const gaps = analyzer.findAudienceGaps(atoms);
      expect(gaps.some((g) => g.audienceMode === 'novice')).toBe(true);
    });

    it('returns no gaps for balanced content', () => {
      const atoms = [
        ...Array.from({ length: 5 }, () =>
          makeAtom({ metadata: { ...makeAtom().metadata, audienceDepth: 'novice' } }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeAtom({ metadata: { ...makeAtom().metadata, audienceDepth: 'intermediate' } }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeAtom({ metadata: { ...makeAtom().metadata, audienceDepth: 'expert' } }),
        ),
      ];

      const gaps = analyzer.findAudienceGaps(atoms);
      const depthGaps = gaps.filter((g) => g.description.includes('audience'));
      expect(depthGaps).toHaveLength(0);
    });

    it('returns empty for no atoms', () => {
      const gaps = analyzer.findAudienceGaps([]);
      expect(gaps).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Skill JSON files — verify they parse correctly
// ---------------------------------------------------------------------------

describe('Skill JSON configs', () => {
  const skillFiles = ['pharma', 'ecommerce', 'saas', 'media'];

  for (const skill of skillFiles) {
    it(`${skill}.json is valid`, async () => {
      // Read and parse the JSON file
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.resolve(
        process.cwd(),
        `skills/${skill}.json`,
      );
      const raw = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(raw);

      // Validate against our runtime validator
      const result = validateSkillConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Check required structure
      expect(config.siteType).toBe(skill);
      expect(config.signalWeights).toBeDefined();
      expect(config.intentOverrides).toBeDefined();
      expect(config.generationConstraints).toBeDefined();
      expect(config.promptModifiers).toBeDefined();
      expect(config.promptModifiers.systemSuffix).toBeTruthy();
    });
  }
});
