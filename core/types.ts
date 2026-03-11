// core/types.ts — All shared type definitions for the Glow system

// =============================================================================
// Content Atoms
// =============================================================================

export type ContentType =
  | 'headline'
  | 'subheading'
  | 'body'
  | 'cta'
  | 'caption'
  | 'list-item'
  | 'stat';

export interface ContentMetadata {
  topics: string[];
  audienceDepth: AudienceDepth;
  purpose: ContentPurpose;
  emotionalRegister: EmotionalRegister;
  wordCount: number;
  language: string;
}

export type AudienceDepth = 'novice' | 'intermediate' | 'expert';

export type ContentPurpose =
  | 'inform'
  | 'persuade'
  | 'enable-action'
  | 'compare'
  | 'entertain';

export type EmotionalRegister =
  | 'rational'
  | 'inspiring'
  | 'urgent'
  | 'empathetic'
  | 'authoritative';

export interface AtomPerformance {
  usageCount: number;
  impressions: number;
  engagementRate: number;
  conversionLift: number;
  lastUsed: string;
  audienceBreakdown: Record<IntentArchetype, number>;
}

export interface ContentAtom {
  id: string;
  content: string;
  sourceUrl: string;
  blockPosition: number;
  contentType: ContentType;
  metadata: ContentMetadata;
  embedding?: number[];
  performance?: AtomPerformance;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Block Templates
// =============================================================================

export type BlockPosition =
  | 'hero'
  | 'above-fold'
  | 'mid-page'
  | 'below-fold'
  | 'footer';

export type SlotType = 'text' | 'rich-text' | 'image' | 'link' | 'list';

export interface SlotConstraints {
  minLength?: number;
  maxLength?: number;
  required: boolean;
  pattern?: string;
}

export interface SlotDefinition {
  name: string;
  type: SlotType;
  constraints: SlotConstraints;
  originalContent: string;
  /** CSS selector relative to the block container for in-place text replacement. */
  cssSelector?: string;
}

export interface ResponsiveStyles {
  mobile: string;
  tablet: string;
  desktop: string;
}

export interface BlockTemplate {
  id: string;
  siteId: string;
  sourceUrl: string;
  blockType: string;
  /** CSS selector for the page element this template replaces (or inserts relative to). */
  selector: string;
  htmlShell: string;
  cssRules: string;
  slots: SlotDefinition[];
  responsive: ResponsiveStyles;
  position: BlockPosition;
  /** If set, insert new content after the selector instead of modifying it. */
  insertAfter?: boolean;
  /** If set, template is only used when intent topics overlap with these. */
  requiredTopics?: string[];
}

// =============================================================================
// Brand Profile
// =============================================================================

export type VoiceFormality = 'casual' | 'balanced' | 'formal';
export type PersonPerspective = 'first' | 'second' | 'third';

export interface BrandVoice {
  tone: string[];
  formality: VoiceFormality;
  personPerspective: PersonPerspective;
  characteristicPhrases: string[];
}

export interface BrandVisual {
  primaryColors: string[];
  fontFamilies: string[];
  spacingScale: number[];
}

export interface DisclaimerRule {
  context: string;
  text: string;
}

export interface BrandGuardrails {
  forbiddenTerms: string[];
  requiredDisclaimers: DisclaimerRule[];
  approvalRequired: boolean;
  maxGeneratedBlocksPerPage: number;
}

export type SiteType =
  | 'pharma'
  | 'ecommerce'
  | 'saas'
  | 'media'
  | 'corporate'
  | 'other';

export interface BrandProfile {
  siteId: string;
  voice: BrandVoice;
  visual: BrandVisual;
  guardrails: BrandGuardrails;
  siteType: SiteType;
  skillConfig: string;
}

// =============================================================================
// Intent Engine
// =============================================================================

export type IntentArchetype =
  | 'explore'
  | 'compare'
  | 'dive_deep'
  | 'seek_action'
  | 'return';

export type ContentDepth = 'overview' | 'detailed' | 'comprehensive';

export interface IntentSnapshot {
  archetype: IntentArchetype;
  confidence: number;
  timestamp: string;
}

export interface IntentVector {
  sessionId: string;
  archetype: IntentArchetype;
  confidence: number;
  topicEmbedding: number[];
  /** Topic keywords extracted from signals (search queries, ChatGPT conversations). */
  topics: string[];
  audienceMode: AudienceDepth;
  contentDepth: ContentDepth;
  emotionalRegister: EmotionalRegister;
  signalCount: number;
  history: IntentSnapshot[];
  updatedAt: string;
}

// =============================================================================
// Signals
// =============================================================================

export type SignalType =
  | 'page_visit'
  | 'scroll_depth'
  | 'click_target'
  | 'hover_dwell'
  | 'search_query'
  | 'filter_select'
  | 'navigation'
  | 'time_on_section'
  | 'form_interaction'
  | 'viewport_block_visibility';

export interface Signal {
  type: SignalType;
  timestamp: string;
  data: Record<string, unknown>;
  pageUrl: string;
}

// Type-specific signal data interfaces for downstream consumers
export interface PageVisitData {
  url: string;
  referrer: string;
  title: string;
}

export interface ScrollDepthData {
  depth: number;
  maxDepth: number;
  sectionId?: string;
}

export interface ClickTargetData {
  selector: string;
  text: string;
  href?: string;
  semanticParent: string;
}

export interface HoverDwellData {
  selector: string;
  dwellMs: number;
  blockType?: string;
}

export interface SearchQueryData {
  query: string;
  resultCount?: number;
}

export interface FilterSelectData {
  filterName: string;
  filterValue: string;
}

export interface NavigationData {
  from: string;
  to: string;
  method: 'click' | 'popstate' | 'pushstate';
}

export interface TimeOnSectionData {
  sectionId: string;
  durationMs: number;
  visible: boolean;
}

export interface FormInteractionData {
  formId?: string;
  fieldName: string;
  action: 'focus' | 'change' | 'submit';
}

export interface ViewportBlockVisibilityData {
  blockSelector: string;
  visiblePercent: number;
  durationMs: number;
}

// =============================================================================
// Generation
// =============================================================================

export type GenerationModel =
  | 'gpt-oss-120b'
  | 'glm-4.7'
  | 'glm-4.7-flash'
  | 'llama-3.3-8b';

export type GenerationTask =
  | 'content_fill'
  | 'layout_adapt'
  | 'atom_select'
  | 'compliance_check';

export interface GenerationBudget {
  maxTimeMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface GenerationRequest {
  intent: IntentVector;
  pageUrl: string;
  targetBlock: {
    templateId: string;
    position: BlockPosition;
    existingContent: string;
  };
  retrievedAtoms: ContentAtom[];
  brandProfile: BrandProfile;
  budget: GenerationBudget;
}

export interface GenerationResponse {
  blockHtml: string;
  model: GenerationModel;
  atomsUsed: string[];
  generationTimeMs: number;
  confidence: number;
  compliancePass: boolean;
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface StorageInterface {
  // Atom retrieval
  queryAtoms(
    siteId: string,
    embedding: number[],
    filters: Partial<ContentMetadata>,
    limit: number
  ): Promise<ContentAtom[]>;

  // Template retrieval
  getTemplate(
    siteId: string,
    templateId: string
  ): Promise<BlockTemplate | null>;

  getTemplatesForPosition(
    siteId: string,
    position: BlockPosition
  ): Promise<BlockTemplate[]>;

  // Brand profile
  getBrandProfile(siteId: string): Promise<BrandProfile | null>;

  // Cache
  getCachedBlock(key: string): Promise<string | null>;
  setCachedBlock(
    key: string,
    html: string,
    ttlSeconds: number
  ): Promise<void>;

  // Analytics
  logEvent(event: AnalyticsEvent): Promise<void>;
}

// =============================================================================
// Analytics
// =============================================================================

export type AnalyticsEventType =
  | 'impression'
  | 'interaction'
  | 'dwell'
  | 'conversion';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  sessionId: string;
  pageUrl: string;
  blockId: string;
  atomIds: string[];
  isGenerative: boolean;
  timestamp: string;
  data: Record<string, unknown>;
}

// =============================================================================
// Skill Configuration
// =============================================================================

export interface SkillIntentOverrides {
  archetypeIndicators: Partial<Record<IntentArchetype, string[]>>;
  confidenceBoosts: Partial<Record<string, number>>;
}

export interface AudienceDetectionRule {
  signal: string;
  audience: string;
  action: string;
}

export interface SkillDisclaimerRule {
  trigger: string;
  text: string;
}

export interface SkillGenerationConstraints {
  maxBlocksPerPage: number;
  requiredDisclaimers: SkillDisclaimerRule[];
  forbiddenTopics: string[];
  audienceDetection: AudienceDetectionRule[];
}

export interface SkillPromptModifiers {
  systemSuffix: string;
  toneOverride?: string;
}

export interface SkillConfig {
  siteType: string;
  signalWeights: Partial<Record<SignalType, number>>;
  intentOverrides: SkillIntentOverrides;
  generationConstraints: SkillGenerationConstraints;
  promptModifiers: SkillPromptModifiers;
}

// =============================================================================
// Pipeline
// =============================================================================

export interface BlockReplacement {
  selector: string;
  html: string;
  templateId: string;
  atomIds: string[];
  generationTimeMs: number;
  model: GenerationModel;
  confidence: number;
  /** Slot values for in-place text replacement (preserves original markup). */
  slotValues?: Record<string, string>;
  /** CSS selectors for each slot, relative to the block container. */
  slotSelectors?: Record<string, string>;
  /** If true, insert new content after the selector instead of modifying it. */
  insertAfter?: boolean;
  /** Source that triggered generation: implicit signals or chatgpt conversation. */
  source?: 'signals' | 'chatgpt';
}

export interface PipelineResult {
  blocks: BlockReplacement[];
  intent: IntentVector;
  totalTimeMs: number;
  cacheHit: boolean;
}

// =============================================================================
// Indexer
// =============================================================================

export interface CrawlResult {
  url: string;
  html: string;
  statusCode: number;
  headers: Record<string, string>;
}

export interface ContentIndex {
  siteId: string;
  atoms: ContentAtom[];
  templates: BlockTemplate[];
  brandProfile: BrandProfile;
  crawledAt: string;
  pageCount: number;
}

// =============================================================================
// Constants
// =============================================================================

export const MAX_GENERATION_TIME_MS = 2500;
export const SPECULATIVE_CACHE_TTL_SECONDS = 60;
export const MAX_INPUT_TOKENS = 2000;
export const MIN_CONFIDENCE_THRESHOLD = 0.3;
export const MODERATE_CONFIDENCE_THRESHOLD = 0.6;
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;
export const SIGNAL_BATCH_INTERVAL_MS = 500;
export const HOVER_DWELL_THRESHOLD_MS = 500;
export const SCROLL_THROTTLE_MS = 200;
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_PAGE_CAP = 50;
