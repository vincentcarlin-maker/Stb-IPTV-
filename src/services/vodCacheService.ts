import { VODItem, TVSeries } from '../types/iptv';

const DB_NAME = 'istb_vod_catalog_v2';
const DB_VERSION = 3;

const STORE_MOVIES = 'movies';
const STORE_SERIES = 'series';
const STORE_METADATA = 'metadata';
const STORE_PAGES = 'fetched_pages';
const STORE_SERIES_DETAILS = 'series_details';

class VODCacheService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB unsupported in this environment'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_MOVIES)) {
          const moviesStore = db.createObjectStore(STORE_MOVIES, { keyPath: 'storeId' });
          moviesStore.createIndex('portalKey', 'portalKey', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_SERIES)) {
          const seriesStore = db.createObjectStore(STORE_SERIES, { keyPath: 'storeId' });
          seriesStore.createIndex('portalKey', 'portalKey', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'portalKey' });
        }

        if (!db.objectStoreNames.contains(STORE_PAGES)) {
          db.createObjectStore(STORE_PAGES, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORE_SERIES_DETAILS)) {
          db.createObjectStore(STORE_SERIES_DETAILS, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    });

    return this.dbPromise;
  }

  /**
   * Helper to write items in batches of 100 to 200 to IndexedDB.
   * Uses serverKey to isolate records for each server profile.
   */
  public async saveMoviesInBatches(serverKey: string, movies: VODItem[], batchSize = 150): Promise<void> {
    try {
      const db = await this.getDB();
      if (!movies || movies.length === 0) return;

      for (let i = 0; i < movies.length; i += batchSize) {
        const batch = movies.slice(i, i + batchSize);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_MOVIES, 'readwrite');
          const store = tx.objectStore(STORE_MOVIES);

          batch.forEach((movie) => {
            store.put({
              ...movie,
              portalKey: serverKey, // Maps to 'portalKey' index in IndexedDB schema
              storeId: `${serverKey}__${movie.id}`,
            });
          });

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch (err) {
      console.warn('[VODCache] Error saving movies batch to IndexedDB:', err);
    }
  }

  public async saveSeriesInBatches(serverKey: string, series: TVSeries[], batchSize = 150): Promise<void> {
    try {
      const db = await this.getDB();
      if (!series || series.length === 0) return;

      for (let i = 0; i < series.length; i += batchSize) {
        const batch = series.slice(i, i + batchSize);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_SERIES, 'readwrite');
          const store = tx.objectStore(STORE_SERIES);

          batch.forEach((s) => {
            store.put({
              ...s,
              portalKey: serverKey, // Maps to 'portalKey' index in IndexedDB schema
              storeId: `${serverKey}__${s.id}`,
            });
          });

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch (err) {
      console.warn('[VODCache] Error saving series batch to IndexedDB:', err);
    }
  }

  public async updateSeriesSeasonCount(serverKey: string, seriesId: string, seasonCount: number): Promise<void> {
    try {
      const db = await this.getDB();
      const cleanId = seriesId.startsWith('stalker-series-') ? seriesId : `stalker-series-${seriesId}`;
      const storeId = `${serverKey}__${cleanId}`;

      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_SERIES, 'readwrite');
        const store = tx.objectStore(STORE_SERIES);
        const req = store.get(storeId);
        req.onsuccess = () => {
          const item = req.result;
          if (item) {
            item.totalSeasons = seasonCount;
            store.put(item);
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    } catch (err) {
      console.warn('[VODCache] Error updating series season count:', err);
    }
  }

  /**
   * Save completed page numbers for resume support
   */
  public async markPagesFetched(serverKey: string, type: 'vod' | 'series', pageNumbers: number[]): Promise<void> {
    try {
      const db = await this.getDB();
      const key = `${serverKey}__${type}`;
      const existing = await this.getFetchedPages(serverKey, type);
      pageNumbers.forEach((p) => existing.add(p));

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PAGES, 'readwrite');
        const store = tx.objectStore(STORE_PAGES);
        store.put({ key, pages: Array.from(existing) });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VODCache] Error marking pages fetched:', err);
    }
  }

  public async getFetchedPages(serverKey: string, type: 'vod' | 'series'): Promise<Set<number>> {
    try {
      const db = await this.getDB();
      const key = `${serverKey}__${type}`;
      return new Promise<Set<number>>((resolve) => {
        const tx = db.transaction(STORE_PAGES, 'readonly');
        const store = tx.objectStore(STORE_PAGES);
        const req = store.get(key);
        req.onsuccess = () => {
          const pagesArr = req.result?.pages || [];
          resolve(new Set(pagesArr));
        };
        req.onerror = () => resolve(new Set());
      });
    } catch {
      return new Set();
    }
  }

  /**
   * Replace active catalogue only AFTER a new complete catalogue is validated!
   */
  public async commitCompleteCatalogue(
    serverKey: string, 
    movies: VODItem[], 
    series: TVSeries[],
    auditSummary?: any,
    serverMovieCategories?: string[],
    serverSeriesCategories?: string[]
  ): Promise<void> {
    try {
      const db = await this.getDB();

      // 1. Save new movies in batches under serverKey
      await this.saveMoviesInBatches(serverKey, movies);

      // 2. Save new series in batches under serverKey
      await this.saveSeriesInBatches(serverKey, series);

      // 3. Update metadata to mark catalogue complete, save counts and exact server categories order
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_METADATA, 'readwrite');
        const store = tx.objectStore(STORE_METADATA);

        store.put({
          portalKey: serverKey,
          timestamp: Date.now(),
          movieCount: movies.length,
          seriesCount: series.length,
          auditSummary,
          serverMovieCategories: serverMovieCategories || [],
          serverSeriesCategories: serverSeriesCategories || [],
          isComplete: true,
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      console.log(`[VODCache] Catalogue committed to IndexedDB for serverKey: ${serverKey} (${movies.length} movies, ${series.length} series, ${serverMovieCategories?.length || 0} movie categories, ${serverSeriesCategories?.length || 0} series categories)`);
    } catch (err) {
      console.warn('[VODCache] Commit complete catalogue failed:', err);
    }
  }

  /**
   * Retrieve cached server categories in exact server order.
   */
  public async getServerCategories(serverKey: string): Promise<{ movieCategories: string[]; seriesCategories: string[] }> {
    try {
      const meta = await this.getMetadata(serverKey);
      return {
        movieCategories: Array.isArray(meta?.serverMovieCategories) ? meta.serverMovieCategories : [],
        seriesCategories: Array.isArray(meta?.serverSeriesCategories) ? meta.serverSeriesCategories : [],
      };
    } catch {
      return { movieCategories: [], seriesCategories: [] };
    }
  }

  /**
   * Retrieve cached movies for a specific serverKey.
   */
  public async getCachedMovies(serverKey: string): Promise<VODItem[]> {
    try {
      const db = await this.getDB();
      const movies = await new Promise<VODItem[]>((resolve) => {
        const tx = db.transaction(STORE_MOVIES, 'readonly');
        const store = tx.objectStore(STORE_MOVIES);
        const index = store.index('portalKey');
        const request = index.getAll(serverKey);

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map(({ storeId, portalKey: pKey, ...item }) => item as VODItem));
        };
        request.onerror = () => resolve([]);
      });

      return movies || [];
    } catch {
      return [];
    }
  }

  /**
   * Retrieve cached series for a specific serverKey.
   */
  public async getCachedSeries(serverKey: string): Promise<TVSeries[]> {
    try {
      const db = await this.getDB();
      const series = await new Promise<TVSeries[]>((resolve) => {
        const tx = db.transaction(STORE_SERIES, 'readonly');
        const store = tx.objectStore(STORE_SERIES);
        const index = store.index('portalKey');
        const request = index.getAll(serverKey);

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map(({ storeId, portalKey: pKey, ...item }) => item as TVSeries));
        };
        request.onerror = () => resolve([]);
      });

      return series || [];
    } catch {
      return [];
    }
  }

  public async getMetadata(serverKey: string): Promise<any | null> {
    try {
      const db = await this.getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_METADATA, 'readonly');
        const store = tx.objectStore(STORE_METADATA);
        const request = store.get(serverKey);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Deletes all cached data associated with a specific server from IndexedDB when a server is removed.
   */
  public async clearServerCache(serverKey: string): Promise<void> {
    try {
      const db = await this.getDB();

      // Delete movies
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_MOVIES, 'readwrite');
        const store = tx.objectStore(STORE_MOVIES);
        const index = store.index('portalKey');
        const req = index.openCursor(IDBKeyRange.only(serverKey));
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      // Delete series
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_SERIES, 'readwrite');
        const store = tx.objectStore(STORE_SERIES);
        const index = store.index('portalKey');
        const req = index.openCursor(IDBKeyRange.only(serverKey));
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      // Delete metadata
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_METADATA, 'readwrite');
        const store = tx.objectStore(STORE_METADATA);
        store.delete(serverKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      // Delete fetched pages
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_PAGES, 'readwrite');
        const store = tx.objectStore(STORE_PAGES);
        store.delete(`${serverKey}__vod`);
        store.delete(`${serverKey}__series`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      console.log(`[VODCache] Cleared IndexedDB cache for server: ${serverKey}`);
    } catch (err) {
      console.warn('[VODCache] Error clearing server cache:', err);
    }
  }

  /**
   * Retrieve cached series details (seasons & episodes) for a specific series.
   * Checks TTL (default 24h).
   */
  public async getCachedSeriesDetails(serverKey: string, seriesId: string): Promise<{ seasons: any[]; updatedAt: number } | null> {
    try {
      const db = await this.getDB();
      const key = `${serverKey}__${seriesId}`;
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_SERIES_DETAILS, 'readonly');
        const store = tx.objectStore(STORE_SERIES_DETAILS);
        const req = store.get(key);
        req.onsuccess = () => {
          const res = req.result;
          if (res && res.seasons && Array.isArray(res.seasons) && res.seasons.length > 0) {
            const age = Date.now() - (res.updatedAt || 0);
            // 24 hours TTL
            if (age < 24 * 3600 * 1000) {
              resolve({ seasons: res.seasons, updatedAt: res.updatedAt });
              return;
            }
          }
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Save series details (seasons & episodes) into IndexedDB cache under serverKey__seriesId
   */
  public async saveSeriesDetails(serverKey: string, seriesId: string, seasons: any[]): Promise<void> {
    try {
      const db = await this.getDB();
      const key = `${serverKey}__${seriesId}`;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SERIES_DETAILS, 'readwrite');
        const store = tx.objectStore(STORE_SERIES_DETAILS);
        store.put({
          key,
          serverKey,
          seriesId,
          seasons,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VODCache] Error saving series details to IndexedDB:', err);
    }
  }
}

export const vodCacheService = new VODCacheService();
