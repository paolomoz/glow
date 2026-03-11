// extension/storage/indexeddb-adapter.ts — IndexedDB storage adapter
// CC-3.1.4: Implements core StorageInterface using IndexedDB for content index

import type {
  StorageInterface,
  ContentAtom,
  ContentMetadata,
  BlockTemplate,
  BlockPosition,
  BrandProfile,
  AnalyticsEvent,
} from '@glow/core';

const DB_NAME = 'glow-content-index';
const DB_VERSION = 1;

// Store names
const ATOMS_STORE = 'atoms';
const TEMPLATES_STORE = 'templates';
const PROFILES_STORE = 'profiles';
const CACHE_STORE = 'cache';
const EVENTS_STORE = 'events';

/**
 * IndexedDB-backed storage adapter for the Chrome extension.
 * Stores content atoms, block templates, brand profiles, and cached blocks.
 */
export class IndexedDBStorageAdapter implements StorageInterface {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;

          // Atoms store — keyed by id, indexed by siteId and contentType
          if (!db.objectStoreNames.contains(ATOMS_STORE)) {
            const atomStore = db.createObjectStore(ATOMS_STORE, {
              keyPath: 'id',
            });
            atomStore.createIndex('siteId', 'sourceUrl', { unique: false });
            atomStore.createIndex('contentType', 'contentType', {
              unique: false,
            });
          }

          // Templates store — keyed by id, indexed by siteId and position
          if (!db.objectStoreNames.contains(TEMPLATES_STORE)) {
            const templateStore = db.createObjectStore(TEMPLATES_STORE, {
              keyPath: 'id',
            });
            templateStore.createIndex('siteId', 'siteId', { unique: false });
            templateStore.createIndex('position', 'position', {
              unique: false,
            });
            templateStore.createIndex('siteId_position', ['siteId', 'position'], {
              unique: false,
            });
          }

          // Profiles store — keyed by siteId
          if (!db.objectStoreNames.contains(PROFILES_STORE)) {
            db.createObjectStore(PROFILES_STORE, { keyPath: 'siteId' });
          }

          // Cache store — keyed by string key, with TTL
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            const cacheStore = db.createObjectStore(CACHE_STORE, {
              keyPath: 'key',
            });
            cacheStore.createIndex('expiry', 'expiry', { unique: false });
          }

          // Events store — auto-incrementing key
          if (!db.objectStoreNames.contains(EVENTS_STORE)) {
            db.createObjectStore(EVENTS_STORE, { autoIncrement: true });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  // -------------------------------------------------------------------------
  // Atom retrieval
  // -------------------------------------------------------------------------

  async queryAtoms(
    siteId: string,
    _embedding: number[],
    filters: Partial<ContentMetadata>,
    limit: number,
  ): Promise<ContentAtom[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATOMS_STORE, 'readonly');
      const store = tx.objectStore(ATOMS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        let atoms: ContentAtom[] = request.result;

        // Filter by siteId (atoms store sourceUrl by hostname)
        atoms = atoms.filter((a) => {
          try {
            return new URL(a.sourceUrl).hostname === siteId;
          } catch {
            return a.sourceUrl.includes(siteId);
          }
        });

        // Simple relevance scoring using cosine similarity if embeddings exist
        if (_embedding.length > 0) {
          atoms = atoms
            .filter((a) => a.embedding && a.embedding.length > 0)
            .map((a) => ({
              atom: a,
              score: cosineSim(_embedding, a.embedding!),
            }))
            .sort((a, b) => b.score - a.score)
            .map((r) => r.atom);
        }

        // Apply metadata filters — boost matching atoms to the front
        // Uses substring matching to connect intent topics (e.g., "german") with
        // atom topics (e.g., "german-engineering")
        if (filters.topics && (filters.topics as unknown as string[]).length > 0) {
          const filterTopics = (filters.topics as unknown as string[]).map((t) => t.toLowerCase());
          atoms.sort((a, b) => {
            const aCount = countTopicMatches(a.metadata.topics, filterTopics);
            const bCount = countTopicMatches(b.metadata.topics, filterTopics);
            return bCount - aCount; // More matches = higher rank
          });
        }

        // Return more atoms than requested so the atom selector can rank them
        resolve(atoms.slice(0, Math.max(limit, 50)));
      };

      request.onerror = () => reject(request.error);
    });
  }

  // -------------------------------------------------------------------------
  // Template retrieval
  // -------------------------------------------------------------------------

  async getTemplate(
    siteId: string,
    templateId: string,
  ): Promise<BlockTemplate | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEMPLATES_STORE, 'readonly');
      const store = tx.objectStore(TEMPLATES_STORE);
      const request = store.get(templateId);

      request.onsuccess = () => {
        const template = request.result as BlockTemplate | undefined;
        if (template && template.siteId === siteId) {
          resolve(template);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getTemplatesForPosition(
    siteId: string,
    position: BlockPosition,
  ): Promise<BlockTemplate[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEMPLATES_STORE, 'readonly');
      const store = tx.objectStore(TEMPLATES_STORE);
      const index = store.index('siteId_position');
      const request = index.getAll([siteId, position]);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // -------------------------------------------------------------------------
  // Brand profile
  // -------------------------------------------------------------------------

  async getBrandProfile(siteId: string): Promise<BrandProfile | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROFILES_STORE, 'readonly');
      const store = tx.objectStore(PROFILES_STORE);
      const request = store.get(siteId);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  // -------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------

  async getCachedBlock(key: string): Promise<string | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as
          | { key: string; html: string; expiry: number }
          | undefined;
        if (!entry) {
          resolve(null);
        } else if (Date.now() > entry.expiry) {
          // Expired — clean up async
          this.deleteCacheEntry(key);
          resolve(null);
        } else {
          resolve(entry.html);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async setCachedBlock(
    key: string,
    html: string,
    ttlSeconds: number,
  ): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      store.put({
        key,
        html,
        expiry: Date.now() + ttlSeconds * 1000,
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async deleteCacheEntry(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).delete(key);
    } catch {
      // Best effort
    }
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  async logEvent(event: AnalyticsEvent): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EVENTS_STORE, 'readwrite');
      const store = tx.objectStore(EVENTS_STORE);
      store.add(event);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------------
  // Bulk write operations (for indexing)
  // -------------------------------------------------------------------------

  async storeAtoms(atoms: ContentAtom[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATOMS_STORE, 'readwrite');
      const store = tx.objectStore(ATOMS_STORE);
      for (const atom of atoms) {
        store.put(atom);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async storeTemplates(templates: BlockTemplate[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEMPLATES_STORE, 'readwrite');
      const store = tx.objectStore(TEMPLATES_STORE);
      for (const template of templates) {
        store.put(template);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async storeBrandProfile(profile: BrandProfile): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROFILES_STORE, 'readwrite');
      const store = tx.objectStore(PROFILES_STORE);
      store.put(profile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Get counts of stored items for a site. */
  async getIndexStats(
    siteId: string,
  ): Promise<{ atomCount: number; templateCount: number }> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [ATOMS_STORE, TEMPLATES_STORE],
        'readonly',
      );

      let atomCount = 0;
      let templateCount = 0;

      const atomReq = tx.objectStore(ATOMS_STORE).getAll();
      atomReq.onsuccess = () => {
        atomCount = (atomReq.result as ContentAtom[]).filter((a) => {
          try {
            return new URL(a.sourceUrl).hostname === siteId;
          } catch {
            return false;
          }
        }).length;
      };

      const templateReq = tx
        .objectStore(TEMPLATES_STORE)
        .index('siteId')
        .getAll(siteId);
      templateReq.onsuccess = () => {
        templateCount = templateReq.result.length;
      };

      tx.oncomplete = () => resolve({ atomCount, templateCount });
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Clear all stored data (atoms, templates, profiles). */
  async clear(): Promise<void> {
    const db = await this.getDB();
    const storeNames = [ATOMS_STORE, TEMPLATES_STORE, PROFILES_STORE];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Clear all data for a site. */
  async clearSite(siteId: string): Promise<void> {
    const db = await this.getDB();

    // Clear templates
    const txTemplates = db.transaction(TEMPLATES_STORE, 'readwrite');
    const templateIndex = txTemplates
      .objectStore(TEMPLATES_STORE)
      .index('siteId');
    const templateKeys = await new Promise<IDBValidKey[]>(
      (resolve, reject) => {
        const req = templateIndex.getAllKeys(siteId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      },
    );
    const txDel = db.transaction(TEMPLATES_STORE, 'readwrite');
    const store = txDel.objectStore(TEMPLATES_STORE);
    for (const key of templateKeys) {
      store.delete(key);
    }

    // Clear brand profile
    const txProfile = db.transaction(PROFILES_STORE, 'readwrite');
    txProfile.objectStore(PROFILES_STORE).delete(siteId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count how many atom topics match intent topics (substring matching). */
function countTopicMatches(atomTopics: string[], intentTopics: string[]): number {
  let matches = 0;
  for (const at of atomTopics) {
    const atLow = at.toLowerCase();
    for (const it of intentTopics) {
      if (atLow === it || atLow.includes(it) || it.includes(atLow)) {
        matches++;
        break;
      }
    }
  }
  return matches;
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
