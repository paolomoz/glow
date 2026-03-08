// indexer/extractor/index.ts — Barrel exports for content extractor module

export {
  detectBlocks,
  buildUniqueSelector,
  type DetectedBlock,
  type BlockDetectorOptions,
} from './block-detector.js';

export {
  extractTemplate,
  extractTemplates,
  type TemplateExtractionOptions,
} from './template-extractor.js';

export {
  extractAtoms,
  extractAllAtoms,
  type AtomExtractionOptions,
} from './atom-extractor.js';

export {
  extractStructuredData,
  type StructuredData,
  type JsonLdObject,
  type MicrodataItem,
} from './structured-data.js';

export {
  captureBlocks,
  type BlockCapture,
  type VisualCaptureOptions,
} from './visual-capture.js';
