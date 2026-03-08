// indexer/storage-writers.ts — Save content index to storage adapters
// CC-1.5.7: Write atoms, templates, brand profile, embeddings, and metadata

import type {
  ContentIndex,
  ContentAtom,
  BlockTemplate,
  BrandProfile,
  StorageInterface,
} from '@glow/core';

/**
 * Extended storage interface for index writing operations.
 * The core StorageInterface is read-oriented; this adds write methods
 * needed during indexing.
 */
export interface IndexStorageWriter {
  /** Write content atoms (with embeddings) to vector store */
  writeAtoms(siteId: string, atoms: ContentAtom[]): Promise<void>;
  /** Write block templates */
  writeTemplates(siteId: string, templates: BlockTemplate[]): Promise<void>;
  /** Write brand profile */
  writeBrandProfile(siteId: string, profile: BrandProfile): Promise<void>;
  /** Write full index snapshot for backup/restore */
  writeIndexSnapshot(index: ContentIndex): Promise<void>;
  /** Write metadata/lookup indexes */
  writeMetadata(siteId: string, metadata: IndexMetadata): Promise<void>;
}

/** Metadata stored alongside the content index for fast lookups. */
export interface IndexMetadata {
  siteId: string;
  seedUrl: string;
  pageCount: number;
  atomCount: number;
  templateCount: number;
  siteType: string;
  indexedAt: string;
  version: number;
}

/**
 * Build IndexMetadata from a ContentIndex.
 */
export function buildIndexMetadata(
  index: ContentIndex,
  seedUrl: string,
  version: number = 1,
): IndexMetadata {
  return {
    siteId: index.siteId,
    seedUrl,
    pageCount: index.pageCount,
    atomCount: index.atoms.length,
    templateCount: index.templates.length,
    siteType: index.brandProfile.siteType,
    indexedAt: index.crawledAt,
    version,
  };
}

/**
 * Write a complete content index to a storage writer.
 * Performs all writes in parallel where possible.
 */
export async function writeContentIndex(
  index: ContentIndex,
  writer: IndexStorageWriter,
  seedUrl: string,
): Promise<void> {
  const metadata = buildIndexMetadata(index, seedUrl);

  // Write atoms, templates, and profile in parallel
  await Promise.all([
    writer.writeAtoms(index.siteId, index.atoms),
    writer.writeTemplates(index.siteId, index.templates),
    writer.writeBrandProfile(index.siteId, index.brandProfile),
    writer.writeMetadata(index.siteId, metadata),
  ]);

  // Write full snapshot after individual writes succeed
  await writer.writeIndexSnapshot(index);
}

/**
 * In-memory storage writer for testing and demo mode.
 */
export class InMemoryIndexWriter implements IndexStorageWriter {
  atoms = new Map<string, ContentAtom[]>();
  templates = new Map<string, BlockTemplate[]>();
  profiles = new Map<string, BrandProfile>();
  snapshots = new Map<string, ContentIndex>();
  metadata = new Map<string, IndexMetadata>();

  async writeAtoms(siteId: string, atoms: ContentAtom[]): Promise<void> {
    this.atoms.set(siteId, atoms);
  }

  async writeTemplates(siteId: string, templates: BlockTemplate[]): Promise<void> {
    this.templates.set(siteId, templates);
  }

  async writeBrandProfile(siteId: string, profile: BrandProfile): Promise<void> {
    this.profiles.set(siteId, profile);
  }

  async writeIndexSnapshot(index: ContentIndex): Promise<void> {
    this.snapshots.set(index.siteId, index);
  }

  async writeMetadata(siteId: string, meta: IndexMetadata): Promise<void> {
    this.metadata.set(siteId, meta);
  }
}
