// core/skills/classifier.ts — Rule-based site type classifier with LLM confirmation
// CC-1.5.4: Classify sites by type using URL patterns, content indicators, and structured data

import type { SiteType } from '../types.js';

export interface ClassificationResult {
  siteType: SiteType;
  confidence: number;
  indicators: string[];
}

/**
 * Auto-classifies website type during indexing.
 * Uses rule-based first pass with optional LLM confirmation.
 */
export interface SiteClassifier {
  classify(
    urls: string[],
    sampleContent: string[],
    structuredData: Record<string, unknown>[]
  ): ClassificationResult;
}

// ---------------------------------------------------------------------------
// Rule-based classifier implementation
// ---------------------------------------------------------------------------

interface SiteTypeRule {
  type: SiteType;
  urlPatterns: RegExp[];
  contentIndicators: RegExp[];
  structuredDataTypes: string[];
  /** Weight multiplier for this rule category */
  weight: number;
}

const RULES: SiteTypeRule[] = [
  {
    type: 'pharma',
    urlPatterns: [
      /prescribing[-_]?info/i,
      /safety[-_]?info/i,
      /indication/i,
      /clinical[-_]?trial/i,
      /hcp\b/i,
      /patient/i,
      /medication/i,
    ],
    contentIndicators: [
      /prescribing information/i,
      /important safety information/i,
      /adverse (events?|reactions?)/i,
      /clinical trial/i,
      /FDA[- ]approved/i,
      /indication/i,
      /contraindication/i,
      /dosage and administration/i,
      /drug interaction/i,
      /black box warning/i,
      /healthcare (professional|provider)/i,
      /\bISI\b/,
      /\bPI\b/,
    ],
    structuredDataTypes: ['Drug', 'MedicalCondition', 'MedicalWebPage'],
    weight: 1.5, // Pharma classification is high-stakes, require stronger signals
  },
  {
    type: 'ecommerce',
    urlPatterns: [
      /\/product[s]?\//i,
      /\/shop\//i,
      /\/cart/i,
      /\/checkout/i,
      /\/category\//i,
      /\/collection[s]?\//i,
      /\/item\//i,
    ],
    contentIndicators: [
      /add to cart/i,
      /add to bag/i,
      /buy now/i,
      /shop now/i,
      /free shipping/i,
      /in stock/i,
      /out of stock/i,
      /price:\s*\$/i,
      /\$\d+\.\d{2}/,
      /product reviews?/i,
      /wishlist/i,
      /size guide/i,
    ],
    structuredDataTypes: ['Product', 'Offer', 'AggregateOffer', 'ShoppingCenter'],
    weight: 1.0,
  },
  {
    type: 'saas',
    urlPatterns: [
      /\/pricing/i,
      /\/features/i,
      /\/plans/i,
      /\/demo/i,
      /\/integrations/i,
      /\/docs\//i,
      /\/api\//i,
      /\/changelog/i,
    ],
    contentIndicators: [
      /free trial/i,
      /get started/i,
      /sign up free/i,
      /per month/i,
      /\/mo\b/i,
      /enterprise plan/i,
      /API (key|access|endpoint)/i,
      /\bSDK\b/i,
      /integration/i,
      /dashboard/i,
      /SLA\b/i,
      /uptime/i,
      /99\.\d+%/,
    ],
    structuredDataTypes: ['SoftwareApplication', 'WebApplication', 'SaaSApplication'],
    weight: 1.0,
  },
  {
    type: 'media',
    urlPatterns: [
      /\/article\//i,
      /\/news\//i,
      /\/blog\//i,
      /\/story\//i,
      /\/opinion\//i,
      /\/\d{4}\/\d{2}\//i, // date-based URL structure
    ],
    contentIndicators: [
      /published on/i,
      /by\s+[A-Z][a-z]+\s+[A-Z]/i, // byline pattern
      /read more/i,
      /related (articles?|stories)/i,
      /breaking news/i,
      /editor'?s? pick/i,
      /subscribe to/i,
      /newsletter/i,
      /minutes? read/i,
    ],
    structuredDataTypes: ['NewsArticle', 'Article', 'BlogPosting', 'MediaObject'],
    weight: 1.0,
  },
  {
    type: 'corporate',
    urlPatterns: [
      /\/about[-_]?us/i,
      /\/careers/i,
      /\/investor/i,
      /\/leadership/i,
      /\/press/i,
      /\/sustainability/i,
      /\/annual[-_]?report/i,
    ],
    contentIndicators: [
      /our mission/i,
      /our values/i,
      /annual report/i,
      /investor relations/i,
      /board of directors/i,
      /press release/i,
      /corporate responsibility/i,
      /sustainability/i,
      /headquarters/i,
      /founded in/i,
    ],
    structuredDataTypes: ['Corporation', 'Organization', 'GovernmentOrganization'],
    weight: 1.0,
  },
];

/**
 * Classify a site type using rule-based heuristics.
 * Scores each site type based on URL patterns, content indicators, and structured data.
 */
export function classifySiteType(
  urls: string[],
  sampleContent: string[],
  structuredData: Record<string, unknown>[] = [],
): ClassificationResult {
  const scores = new Map<SiteType, { score: number; indicators: string[] }>();

  // Initialize scores
  for (const rule of RULES) {
    scores.set(rule.type, { score: 0, indicators: [] });
  }

  const allContent = sampleContent.join('\n');
  const allUrls = urls.join('\n');

  for (const rule of RULES) {
    const entry = scores.get(rule.type)!;

    // Score URL patterns
    for (const pattern of rule.urlPatterns) {
      if (pattern.test(allUrls)) {
        entry.score += 1 * rule.weight;
        entry.indicators.push(`url:${pattern.source}`);
      }
    }

    // Score content indicators
    for (const pattern of rule.contentIndicators) {
      if (pattern.test(allContent)) {
        entry.score += 2 * rule.weight; // Content is a stronger signal
        entry.indicators.push(`content:${pattern.source}`);
      }
    }

    // Score structured data types
    for (const sd of structuredData) {
      const sdType = String(sd['@type'] ?? '');
      if (rule.structuredDataTypes.includes(sdType)) {
        entry.score += 3 * rule.weight; // Structured data is the strongest signal
        entry.indicators.push(`schema:${sdType}`);
      }
    }
  }

  // Find highest-scoring type
  let bestType: SiteType = 'other';
  let bestScore = 0;
  let bestIndicators: string[] = [];

  for (const [type, entry] of scores) {
    if (entry.score > bestScore) {
      bestType = type;
      bestScore = entry.score;
      bestIndicators = entry.indicators;
    }
  }

  // Normalize confidence: 0-1 scale based on indicator count
  // At least 3 indicators for decent confidence, 8+ for high confidence
  const confidence = bestScore === 0
    ? 0
    : Math.min(1.0, bestScore / 15);

  // If confidence is too low, fall back to 'other'
  if (confidence < 0.1) {
    return { siteType: 'other', confidence: 0, indicators: [] };
  }

  return {
    siteType: bestType,
    confidence: Math.round(confidence * 100) / 100,
    indicators: bestIndicators,
  };
}
