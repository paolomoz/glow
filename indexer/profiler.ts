// indexer/profiler.ts — Extract brand profile from site content via LLM
// CC-1.5.3: Single LLM call (GPT-OSS-120B) against representative content sample
// to extract voice characteristics, tone, terminology, audience segments, visual language.

import type {
  BrandProfile,
  BrandVoice,
  BrandVisual,
  BrandGuardrails,
  SiteType,
  ContentAtom,
  BlockTemplate,
} from '@glow/core';
import type { CerebrasClient } from '../core/generation/cerebras-client.js';
import type { StructuredData } from './extractor/structured-data.js';

export interface ProfilerConfig {
  /** Maximum atoms to include in the LLM prompt sample (default: 20) */
  maxSampleAtoms?: number;
  /** Maximum output tokens for the profiler LLM call (default: 1500) */
  maxOutputTokens?: number;
}

const DEFAULT_MAX_SAMPLE_ATOMS = 20;
const DEFAULT_MAX_OUTPUT_TOKENS = 1500;

/**
 * Build a BrandProfile by analyzing representative content with an LLM.
 * Uses a single GPT-OSS-120B call to extract voice, visual, and guardrail info.
 */
export async function buildBrandProfile(
  siteId: string,
  atoms: ContentAtom[],
  templates: BlockTemplate[],
  structuredData: StructuredData,
  siteType: SiteType,
  skillConfigPath: string,
  client: CerebrasClient,
  config: ProfilerConfig = {},
): Promise<BrandProfile> {
  const maxSample = config.maxSampleAtoms ?? DEFAULT_MAX_SAMPLE_ATOMS;
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  // Select a representative sample of atoms
  const sample = selectRepresentativeSample(atoms, maxSample);

  // Extract visual info from templates
  const visualInfo = extractVisualInfo(templates);

  // Build the prompt
  const prompt = buildProfilerPrompt(sample, visualInfo, structuredData);

  // Call the LLM
  const response = await client.complete({
    model: 'gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: PROFILER_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    maxTokens: maxOutputTokens,
    temperature: 0.3,
  });

  // Parse the LLM response
  const parsed = parseProfilerResponse(response.content);

  return {
    siteId,
    voice: parsed.voice,
    visual: { ...visualInfo, ...parsed.visual },
    guardrails: parsed.guardrails,
    siteType,
    skillConfig: skillConfigPath,
  };
}

/**
 * Build a BrandProfile using only heuristics (no LLM call).
 * Used as a fallback when the LLM is unavailable.
 */
export function buildFallbackProfile(
  siteId: string,
  atoms: ContentAtom[],
  templates: BlockTemplate[],
  siteType: SiteType,
  skillConfigPath: string,
): BrandProfile {
  return {
    siteId,
    voice: inferVoiceFromContent(atoms),
    visual: extractVisualInfo(templates),
    guardrails: inferGuardrails(siteType),
    siteType,
    skillConfig: skillConfigPath,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const PROFILER_SYSTEM_PROMPT = `You are a brand voice analyst. Given a sample of website content, extract the brand's communication characteristics. Respond ONLY with valid JSON matching this schema:

{
  "voice": {
    "tone": ["adjective1", "adjective2", "adjective3"],
    "formality": "casual" | "balanced" | "formal",
    "personPerspective": "first" | "second" | "third",
    "characteristicPhrases": ["phrase1", "phrase2"]
  },
  "visual": {
    "primaryColors": ["#hex1", "#hex2"],
    "fontFamilies": ["font1", "font2"]
  },
  "guardrails": {
    "forbiddenTerms": ["term1", "term2"],
    "requiredDisclaimers": [{"context": "when", "text": "disclaimer text"}],
    "approvalRequired": false,
    "maxGeneratedBlocksPerPage": 3
  }
}`;

function buildProfilerPrompt(
  sample: ContentAtom[],
  visualInfo: BrandVisual,
  structuredData: StructuredData,
): string {
  const contentLines = sample
    .map((a) => `[${a.contentType}] ${a.content}`)
    .join('\n');

  const metaLines: string[] = [];
  if (structuredData.metaTags['title']) {
    metaLines.push(`Site title: ${structuredData.metaTags['title']}`);
  }
  if (structuredData.metaTags['description']) {
    metaLines.push(`Description: ${structuredData.metaTags['description']}`);
  }
  if (structuredData.openGraph['og:title']) {
    metaLines.push(`OG Title: ${structuredData.openGraph['og:title']}`);
  }

  const visualLines = [
    `Colors detected: ${visualInfo.primaryColors.join(', ') || 'none'}`,
    `Fonts detected: ${visualInfo.fontFamilies.join(', ') || 'none'}`,
  ];

  return [
    '## Site Metadata',
    metaLines.join('\n'),
    '',
    '## Visual Information',
    visualLines.join('\n'),
    '',
    '## Content Sample',
    contentLines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Sample selection
// ---------------------------------------------------------------------------

/** Select a diverse, representative sample of atoms. */
function selectRepresentativeSample(
  atoms: ContentAtom[],
  maxCount: number,
): ContentAtom[] {
  if (atoms.length <= maxCount) return atoms;

  // Ensure we get a mix of content types
  const byType = new Map<string, ContentAtom[]>();
  for (const atom of atoms) {
    const list = byType.get(atom.contentType) ?? [];
    list.push(atom);
    byType.set(atom.contentType, list);
  }

  const sample: ContentAtom[] = [];
  const types = Array.from(byType.keys());
  let typeIndex = 0;

  while (sample.length < maxCount) {
    const type = types[typeIndex % types.length];
    const list = byType.get(type)!;
    if (list.length > 0) {
      sample.push(list.shift()!);
    }
    typeIndex++;
    // Safety: if all lists are empty, break
    if (types.every((t) => (byType.get(t)?.length ?? 0) === 0)) break;
  }

  return sample;
}

// ---------------------------------------------------------------------------
// Visual info extraction from templates
// ---------------------------------------------------------------------------

function extractVisualInfo(templates: BlockTemplate[]): BrandVisual {
  const colors = new Set<string>();
  const fonts = new Set<string>();
  const spacings: number[] = [];

  for (const template of templates) {
    const css = template.cssRules;
    // Extract colors
    const colorMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (colorMatches) {
      for (const c of colorMatches) colors.add(c.toLowerCase());
    }
    const rgbMatches = css.match(/rgb\([^)]+\)/g);
    if (rgbMatches) {
      for (const c of rgbMatches) colors.add(c);
    }

    // Extract font families
    const fontMatch = css.match(/font-family:\s*([^;]+)/);
    if (fontMatch) {
      const fontList = fontMatch[1].split(',').map((f) => f.trim().replace(/["']/g, ''));
      for (const f of fontList) {
        if (f && !isGenericFont(f)) fonts.add(f);
      }
    }

    // Extract spacing values
    const spacingMatches = css.match(/(?:padding|margin|gap):\s*(\d+)px/g);
    if (spacingMatches) {
      for (const m of spacingMatches) {
        const num = parseInt(m.match(/(\d+)px/)![1], 10);
        if (!spacings.includes(num)) spacings.push(num);
      }
    }
  }

  return {
    primaryColors: Array.from(colors).slice(0, 6),
    fontFamilies: Array.from(fonts).slice(0, 4),
    spacingScale: spacings.sort((a, b) => a - b).slice(0, 6),
  };
}

function isGenericFont(font: string): boolean {
  const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
  return generics.includes(font.toLowerCase());
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

interface ParsedProfile {
  voice: BrandVoice;
  visual: Partial<BrandVisual>;
  guardrails: BrandGuardrails;
}

function parseProfilerResponse(content: string): ParsedProfile {
  try {
    // Extract JSON from the response (may be wrapped in markdown code fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      voice: {
        tone: Array.isArray(parsed.voice?.tone) ? parsed.voice.tone : ['professional'],
        formality: parsed.voice?.formality ?? 'balanced',
        personPerspective: parsed.voice?.personPerspective ?? 'second',
        characteristicPhrases: Array.isArray(parsed.voice?.characteristicPhrases)
          ? parsed.voice.characteristicPhrases
          : [],
      },
      visual: {
        primaryColors: Array.isArray(parsed.visual?.primaryColors) ? parsed.visual.primaryColors : [],
        fontFamilies: Array.isArray(parsed.visual?.fontFamilies) ? parsed.visual.fontFamilies : [],
      },
      guardrails: {
        forbiddenTerms: Array.isArray(parsed.guardrails?.forbiddenTerms) ? parsed.guardrails.forbiddenTerms : [],
        requiredDisclaimers: Array.isArray(parsed.guardrails?.requiredDisclaimers)
          ? parsed.guardrails.requiredDisclaimers
          : [],
        approvalRequired: parsed.guardrails?.approvalRequired ?? false,
        maxGeneratedBlocksPerPage: parsed.guardrails?.maxGeneratedBlocksPerPage ?? 3,
      },
    };
  } catch {
    // Return sensible defaults if parsing fails
    return {
      voice: {
        tone: ['professional'],
        formality: 'balanced',
        personPerspective: 'second',
        characteristicPhrases: [],
      },
      visual: {},
      guardrails: {
        forbiddenTerms: [],
        requiredDisclaimers: [],
        approvalRequired: false,
        maxGeneratedBlocksPerPage: 3,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback helpers
// ---------------------------------------------------------------------------

function inferVoiceFromContent(atoms: ContentAtom[]): BrandVoice {
  const allText = atoms.map((a) => a.content).join(' ').toLowerCase();

  // Formality: presence of contractions suggests casual
  const contractions = (allText.match(/\b(don't|won't|can't|isn't|it's|we're|you're|they're)\b/g) ?? []).length;
  const formality = contractions > 5 ? 'casual' as const : contractions > 0 ? 'balanced' as const : 'formal' as const;

  // Person perspective: count pronouns
  const weCount = (allText.match(/\bwe\b/g) ?? []).length;
  const youCount = (allText.match(/\byou\b/g) ?? []).length;
  const perspective = weCount > youCount ? 'first' as const : youCount > 0 ? 'second' as const : 'third' as const;

  return {
    tone: ['professional'],
    formality,
    personPerspective: perspective,
    characteristicPhrases: [],
  };
}

function inferGuardrails(siteType: SiteType): BrandGuardrails {
  const base: BrandGuardrails = {
    forbiddenTerms: [],
    requiredDisclaimers: [],
    approvalRequired: false,
    maxGeneratedBlocksPerPage: 3,
  };

  if (siteType === 'pharma') {
    base.approvalRequired = true;
    base.maxGeneratedBlocksPerPage = 1;
    base.requiredDisclaimers = [
      { context: 'drug information', text: 'Please see full prescribing information.' },
    ];
    base.forbiddenTerms = ['cure', 'guaranteed', 'miracle', 'risk-free'];
  }

  if (siteType === 'ecommerce') {
    base.forbiddenTerms = ['free', 'guaranteed lowest'];
  }

  return base;
}
