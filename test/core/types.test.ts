import { describe, it, expect } from 'vitest';
import type {
  ContentAtom,
  BlockTemplate,
  BrandProfile,
  IntentVector,
  Signal,
  GenerationRequest,
  GenerationResponse,
  SkillConfig,
  AnalyticsEvent,
  StorageInterface,
} from '../../core/types.js';
import {
  MAX_GENERATION_TIME_MS,
  MIN_CONFIDENCE_THRESHOLD,
  MODERATE_CONFIDENCE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
  SPECULATIVE_CACHE_TTL_SECONDS,
  MAX_INPUT_TOKENS,
} from '../../core/types.js';
import {
  getPersonalizationLevel,
  getMaxBlocksForLevel,
} from '../../core/intent/progressive.js';
import { ARCHETYPE_PROFILES } from '../../core/intent/archetypes.js';
import { TimeBudget } from '../../core/pipeline/timeout.js';
import { wrapWithBadge } from '../../core/blocks/badge.js';

describe('Core Types', () => {
  it('should create a valid ContentAtom', () => {
    const atom: ContentAtom = {
      id: 'atom-1',
      content: 'Welcome to our platform',
      sourceUrl: 'https://example.com',
      blockPosition: 0,
      contentType: 'headline',
      metadata: {
        topics: ['platform', 'welcome'],
        audienceDepth: 'novice',
        purpose: 'inform',
        emotionalRegister: 'inspiring',
        wordCount: 4,
        language: 'en',
      },
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(atom.id).toBe('atom-1');
    expect(atom.contentType).toBe('headline');
    expect(atom.metadata.topics).toContain('platform');
  });

  it('should create a valid BlockTemplate', () => {
    const template: BlockTemplate = {
      id: 'tpl-1',
      siteId: 'site-1',
      sourceUrl: 'https://example.com',
      blockType: 'hero',
      selector: '#hero',
      htmlShell: '<div class="hero">{{headline}}</div>',
      cssRules: '.hero { font-size: 2rem; }',
      slots: [
        {
          name: 'headline',
          type: 'text',
          constraints: { maxLength: 100, required: true },
          originalContent: 'Original Headline',
        },
      ],
      responsive: { mobile: '', tablet: '', desktop: '' },
      position: 'hero',
    };
    expect(template.slots).toHaveLength(1);
    expect(template.slots[0].name).toBe('headline');
  });

  it('should create a valid BrandProfile', () => {
    const brand: BrandProfile = {
      siteId: 'site-1',
      voice: {
        tone: ['professional', 'warm'],
        formality: 'balanced',
        personPerspective: 'second',
        characteristicPhrases: ['we believe'],
      },
      visual: {
        primaryColors: ['#0066cc'],
        fontFamilies: ['Inter'],
        spacingScale: [4, 8, 16, 24, 32],
      },
      guardrails: {
        forbiddenTerms: ['competitor-name'],
        requiredDisclaimers: [],
        approvalRequired: false,
        maxGeneratedBlocksPerPage: 3,
      },
      siteType: 'saas',
      skillConfig: 'saas.json',
    };
    expect(brand.voice.formality).toBe('balanced');
    expect(brand.siteType).toBe('saas');
  });

  it('should create a valid IntentVector', () => {
    const intent: IntentVector = {
      sessionId: 'sess-1',
      archetype: 'explore',
      confidence: 0.45,
      topicEmbedding: [0.1, 0.2, 0.3],
      topics: [],
      audienceMode: 'novice',
      contentDepth: 'overview',
      emotionalRegister: 'rational',
      signalCount: 12,
      history: [
        { archetype: 'explore', confidence: 0.3, timestamp: '2026-01-01T00:00:00Z' },
      ],
      updatedAt: '2026-01-01T00:01:00Z',
    };
    expect(intent.archetype).toBe('explore');
    expect(intent.confidence).toBeGreaterThan(0);
  });

  it('should create valid Signal objects', () => {
    const signal: Signal = {
      type: 'page_visit',
      timestamp: '2026-01-01T00:00:00Z',
      data: { url: 'https://example.com/about', title: 'About Us' },
      pageUrl: 'https://example.com/about',
    };
    expect(signal.type).toBe('page_visit');
  });
});

describe('Constants', () => {
  it('should have correct time budget', () => {
    expect(MAX_GENERATION_TIME_MS).toBe(2500);
  });

  it('should have correct confidence thresholds', () => {
    expect(MIN_CONFIDENCE_THRESHOLD).toBeLessThan(MODERATE_CONFIDENCE_THRESHOLD);
    expect(MODERATE_CONFIDENCE_THRESHOLD).toBeLessThan(HIGH_CONFIDENCE_THRESHOLD);
  });

  it('should have correct cache TTL', () => {
    expect(SPECULATIVE_CACHE_TTL_SECONDS).toBe(60);
  });

  it('should have correct input token limit', () => {
    expect(MAX_INPUT_TOKENS).toBe(2000);
  });
});

describe('Progressive Personalization', () => {
  it('should return none for low confidence', () => {
    expect(getPersonalizationLevel(0.1)).toBe('none');
    expect(getPersonalizationLevel(0.29)).toBe('none');
  });

  it('should return subtle for moderate-low confidence', () => {
    expect(getPersonalizationLevel(0.3)).toBe('subtle');
    expect(getPersonalizationLevel(0.5)).toBe('subtle');
  });

  it('should return moderate for moderate-high confidence', () => {
    expect(getPersonalizationLevel(0.6)).toBe('moderate');
    expect(getPersonalizationLevel(0.79)).toBe('moderate');
  });

  it('should return full for high confidence', () => {
    expect(getPersonalizationLevel(0.8)).toBe('full');
    expect(getPersonalizationLevel(1.0)).toBe('full');
  });

  it('should return correct max blocks per level', () => {
    expect(getMaxBlocksForLevel('none')).toBe(0);
    expect(getMaxBlocksForLevel('subtle')).toBe(1);
    expect(getMaxBlocksForLevel('moderate')).toBe(3);
    expect(getMaxBlocksForLevel('full')).toBe(5);
  });
});

describe('Archetype Profiles', () => {
  it('should have all five archetypes', () => {
    expect(ARCHETYPE_PROFILES).toHaveLength(5);
    const archetypes = ARCHETYPE_PROFILES.map((p) => p.archetype);
    expect(archetypes).toContain('explore');
    expect(archetypes).toContain('compare');
    expect(archetypes).toContain('dive_deep');
    expect(archetypes).toContain('seek_action');
    expect(archetypes).toContain('return');
  });

  it('should have feature weights between 0 and 1', () => {
    for (const profile of ARCHETYPE_PROFILES) {
      const weights = Object.values(profile.featureWeights);
      for (const w of weights) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('TimeBudget', () => {
  it('should track elapsed time', () => {
    const budget = new TimeBudget(5000);
    expect(budget.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(budget.remainingMs).toBeLessThanOrEqual(5000);
    expect(budget.isExpired).toBe(false);
  });

  it('should expire with zero budget', () => {
    const budget = new TimeBudget(0);
    expect(budget.isExpired).toBe(true);
    expect(budget.remainingMs).toBe(0);
  });

  it('should create an AbortSignal', () => {
    const budget = new TimeBudget(5000);
    const signal = budget.createAbortSignal();
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
  });
});

describe('Badge', () => {
  it('should wrap HTML with AI badge', () => {
    const html = '<div>Hello</div>';
    const wrapped = wrapWithBadge(html);
    expect(wrapped).toContain('glow-ai-badge');
    expect(wrapped).toContain(html);
    expect(wrapped).toContain('✦');
  });
});
