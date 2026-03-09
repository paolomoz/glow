// worker/storage/r2-adapter.ts — R2 bulk storage adapter
// CC-4.1.5: Raw content corpus, index snapshots, analytics event logs

import type {
  ContentIndex,
  AnalyticsEvent,
} from '@glow/core';

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

/**
 * R2-backed storage for bulk data.
 *
 * Key schema:
 *   corpus/{siteId}/index.json         → Full ContentIndex snapshot
 *   corpus/{siteId}/pages/{pageHash}   → Raw HTML
 *   events/{date}/{batchId}.jsonl      → Analytics event batches
 */
export class R2StorageAdapter {
  constructor(private bucket: R2Bucket) {}

  // -------------------------------------------------------------------------
  // Content index snapshots
  // -------------------------------------------------------------------------

  async storeContentIndex(index: ContentIndex): Promise<void> {
    await this.bucket.put(
      `corpus/${index.siteId}/index.json`,
      JSON.stringify(index),
      {
        customMetadata: {
          siteId: index.siteId,
          pageCount: String(index.pageCount),
          crawledAt: index.crawledAt,
        },
      },
    );
  }

  async getContentIndex(siteId: string): Promise<ContentIndex | null> {
    const obj = await this.bucket.get(`corpus/${siteId}/index.json`);
    if (!obj) return null;
    return obj.json<ContentIndex>();
  }

  // -------------------------------------------------------------------------
  // Raw page HTML
  // -------------------------------------------------------------------------

  async storeRawPage(
    siteId: string,
    url: string,
    html: string,
  ): Promise<void> {
    const pageHash = simpleHash(url);
    await this.bucket.put(
      `corpus/${siteId}/pages/${pageHash}`,
      html,
      {
        customMetadata: { url, storedAt: new Date().toISOString() },
      },
    );
  }

  async getRawPage(siteId: string, url: string): Promise<string | null> {
    const pageHash = simpleHash(url);
    const obj = await this.bucket.get(
      `corpus/${siteId}/pages/${pageHash}`,
    );
    if (!obj) return null;
    return obj.text();
  }

  // -------------------------------------------------------------------------
  // Analytics events
  // -------------------------------------------------------------------------

  async storeEvents(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;

    const date = new Date().toISOString().split('T')[0];
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const jsonl = events.map((e) => JSON.stringify(e)).join('\n');

    await this.bucket.put(`events/${date}/${batchId}.jsonl`, jsonl, {
      customMetadata: {
        eventCount: String(events.length),
        storedAt: new Date().toISOString(),
      },
    });
  }

  async listEventBatches(
    date: string,
  ): Promise<{ key: string; eventCount: number }[]> {
    const result = await this.bucket.list({
      prefix: `events/${date}/`,
      limit: 1000,
    });

    return result.objects.map((obj) => ({
      key: obj.key,
      eventCount: parseInt(obj.customMetadata?.eventCount ?? '0', 10),
    }));
  }

  // -------------------------------------------------------------------------
  // Site management
  // -------------------------------------------------------------------------

  async deleteSiteData(siteId: string): Promise<void> {
    // List and delete all objects for this site
    let cursor: string | undefined;
    do {
      const result = await this.bucket.list({
        prefix: `corpus/${siteId}/`,
        limit: 100,
        cursor,
      });

      for (const obj of result.objects) {
        await this.bucket.delete(obj.key);
      }

      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}
