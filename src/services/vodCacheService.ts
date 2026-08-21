import { VODItem, TVSeries } from '../types/iptv';

const DB_NAME = 'istb_vod_catalog_v2';
const DB_VERSION = 1;

const STORE_MOVIES = 'movies';
const STORE_SERIES = 'series';
const STORE_METADATA = 'metadata';

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
   * Helper to write items in batches of 100 to 200 to IndexedDB
   * Rule #12: Écris les résultats par lots de 100 à 200 éléments dans IndexedDB.
   * Ne fais pas un write pour chaque film.
   */
  public async saveMoviesInBatches(portalKey: string, movies: VODItem[], batchSize = 150): Promise<void> {
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
              portalKey,
              storeId: `${portalKey}__${movie.id}`,
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

  public async saveSeriesInBatches(portalKey: string, series: TVSeries[], batchSize = 150): Promise<void> {
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
              portalKey,
              storeId: `${portalKey}__${s.id}`,
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

  /**
   * Replace active catalogue only AFTER a new complete catalogue is validated!
   * Rule #12: Ne supprime jamais l'ancien catalogue avant qu'un nouveau catalogue complet soit validé.
   */
  public async commitCompleteCatalogue(
    portalKey: string, 
    movies: VODItem[], 
    series: TVSeries[],
    auditSummary?: any
  ): Promise<void> {
    try {
      const db = await this.getDB();

      // 1. Save new movies in batches
      await this.saveMoviesInBatches(portalKey, movies);

      // 2. Save new series in batches
      await this.saveSeriesInBatches(portalKey, series);

      // 3. Update metadata to mark catalogue complete & save total counts
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_METADATA, 'readwrite');
        const store = tx.objectStore(STORE_METADATA);

        store.put({
          portalKey,
          timestamp: Date.now(),
          movieCount: movies.length,
          seriesCount: series.length,
          auditSummary,
          isComplete: true,
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      console.log(`[VODCache] Catalogue successfully committed to IndexedDB for ${portalKey} (${movies.length} movies, ${series.length} series)`);
    } catch (err) {
      console.warn('[VODCache] Commit complete catalogue failed:', err);
    }
  }

  public async getCachedMovies(portalKey: string): Promise<VODItem[]> {
    try {
      const db = await this.getDB();
      return new Promise<VODItem[]>((resolve) => {
        const tx = db.transaction(STORE_MOVIES, 'readonly');
        const store = tx.objectStore(STORE_MOVIES);
        const index = store.index('portalKey');
        const request = index.getAll(portalKey);

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map(({ storeId, portalKey: pKey, ...item }) => item as VODItem));
        };
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  public async getCachedSeries(portalKey: string): Promise<TVSeries[]> {
    try {
      const db = await this.getDB();
      return new Promise<TVSeries[]>((resolve) => {
        const tx = db.transaction(STORE_SERIES, 'readonly');
        const store = tx.objectStore(STORE_SERIES);
        const index = store.index('portalKey');
        const request = index.getAll(portalKey);

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.map(({ storeId, portalKey: pKey, ...item }) => item as TVSeries));
        };
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  public async getMetadata(portalKey: string): Promise<any | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_METADATA, 'readonly');
        const store = tx.objectStore(STORE_METADATA);
        const request = store.get(portalKey);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }
}

export const vodCacheService = new VODCacheService();
