// core/storage/file-storage.ts — File-backed StorageInterface for local development
// Loads a ContentIndex JSON file and serves it via the standard StorageInterface.
// This is the local dev path (alongside extension/IndexedDB and worker/KV).

import type {
  StorageInterface,
  ContentIndex,
  ContentAtom,
  ContentMetadata,
  BlockTemplate,
  BrandProfile,
  BlockPosition,
  AnalyticsEvent,
} from '../types.js';

/**
 * StorageInterface backed by an in-memory ContentIndex loaded from a JSON file.
 * Suitable for local development and pipeline testing without Cloudflare or Chrome.
 */
export class FileStorageAdapter implements StorageInterface {
  private atoms: ContentAtom[];
  private templates: BlockTemplate[];
  private brandProfile: BrandProfile;
  private cache = new Map<string, { html: string; expiry: number }>();

  constructor(private index: ContentIndex) {
    this.atoms = index.atoms;
    this.templates = index.templates;
    this.brandProfile = index.brandProfile;
  }

  async queryAtoms(
    _siteId: string,
    _embedding: number[],
    filters: Partial<ContentMetadata>,
    limit: number,
  ): Promise<ContentAtom[]> {
    let results = this.atoms;

    // Apply metadata filters
    if (filters.purpose) {
      results = results.filter((a) => a.metadata.purpose === filters.purpose);
    }
    if (filters.audienceDepth) {
      results = results.filter((a) => a.metadata.audienceDepth === filters.audienceDepth);
    }
    if (filters.emotionalRegister) {
      results = results.filter((a) => a.metadata.emotionalRegister === filters.emotionalRegister);
    }

    // Without embeddings, prioritize content diversity by type
    const byType = new Map<string, ContentAtom[]>();
    for (const atom of results) {
      const list = byType.get(atom.contentType) ?? [];
      list.push(atom);
      byType.set(atom.contentType, list);
    }

    // Round-robin across types for diversity
    const diverse: ContentAtom[] = [];
    const iterators = [...byType.values()].map((list) => list[Symbol.iterator]());
    while (diverse.length < limit && iterators.length > 0) {
      for (let i = iterators.length - 1; i >= 0; i--) {
        const next = iterators[i].next();
        if (next.done) {
          iterators.splice(i, 1);
        } else {
          diverse.push(next.value);
          if (diverse.length >= limit) break;
        }
      }
    }

    return diverse;
  }

  async getTemplate(_siteId: string, templateId: string): Promise<BlockTemplate | null> {
    return this.templates.find((t) => t.id === templateId) ?? null;
  }

  async getTemplatesForPosition(_siteId: string, position: BlockPosition): Promise<BlockTemplate[]> {
    return this.templates.filter((t) => t.position === position);
  }

  async getBrandProfile(_siteId: string): Promise<BrandProfile | null> {
    return this.brandProfile;
  }

  async getCachedBlock(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.html;
  }

  async setCachedBlock(key: string, html: string, ttlSeconds: number): Promise<void> {
    this.cache.set(key, { html, expiry: Date.now() + ttlSeconds * 1000 });
  }

  async logEvent(_event: AnalyticsEvent): Promise<void> {
    // No-op for local dev
  }
}
