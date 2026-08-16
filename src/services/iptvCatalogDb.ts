import { StalkerGenre, VODItem, TVSeries, TVSeriesSeason } from '../types/iptv';

const DB_NAME = 'IPTVCatalogDB';
const DB_VERSION = 2;

export interface PortalCacheMeta {
  portalCacheKey: string;
  lastCatalogUpdate: number;
  movieCount: number;
  seriesCount: number;
  movieCategoriesCount: number;
  seriesCategoriesCount: number;
  auditReport?: string;
  categoryAuditReport?: string;
  schemaVersion: number;
}

export interface CachedSeriesDetails {
  key: string;
  portalCacheKey: string;
  seriesId: string;
  seasons: TVSeriesSeason[];
  lastUpdated: number;
}

export function getPortalCacheKey(portalUrl: string, accountIdentifier: string): string {
  const cleanUrl = (portalUrl || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const cleanAccount = (accountIdentifier || '').trim().toLowerCase().replace(/[:-]/g, '');
  const str = `${cleanUrl}_${cleanAccount}`;
  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const posHash = Math.abs(hash).toString(36);
  const accountSuffix = cleanAccount ? cleanAccount.slice(-4) : 'gen';
  return `portal_${posHash}_${accountSuffix}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB non disponible'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error || new Error('Erreur ouverture IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains('portals')) {
        db.createObjectStore('portals', { keyPath: 'portalCacheKey' });
      }

      if (!db.objectStoreNames.contains('movieCategories')) {
        const store = db.createObjectStore('movieCategories', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('seriesCategories')) {
        const store = db.createObjectStore('seriesCategories', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('movies')) {
        const store = db.createObjectStore('movies', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
        store.createIndex('categoryId', 'categoryId', { unique: false });
      }

      if (!db.objectStoreNames.contains('series')) {
        const store = db.createObjectStore('series', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
        store.createIndex('categoryId', 'categoryId', { unique: false });
      }

      if (!db.objectStoreNames.contains('seriesDetails')) {
        const store = db.createObjectStore('seriesDetails', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('catalogMetadata')) {
        const store = db.createObjectStore('catalogMetadata', { keyPath: 'key' });
        store.createIndex('portalCacheKey', 'portalCacheKey', { unique: false });
      }
    };
  });
}

export async function savePortalCatalog(
  portalCacheKey: string,
  data: {
    movieCategories: StalkerGenre[];
    seriesCategories: StalkerGenre[];
    movies: VODItem[];
    series: TVSeries[];
    auditReport?: string;
    categoryAuditReport?: string;
  }
): Promise<{ addedMovies: number; updatedMovies: number; removedMovies: number; addedSeries: number }> {
  const db = await openDB();
  const tx = db.transaction(
    ['portals', 'movieCategories', 'seriesCategories', 'movies', 'series', 'catalogMetadata'],
    'readwrite'
  );

  const portalsStore = tx.objectStore('portals');
  const movieCatStore = tx.objectStore('movieCategories');
  const seriesCatStore = tx.objectStore('seriesCategories');
  const moviesStore = tx.objectStore('movies');
  const seriesStore = tx.objectStore('series');

  // Helper to fetch existing keys for differential sync
  const getExistingKeys = (store: IDBObjectStore): Promise<Set<string>> => {
    return new Promise((resolve) => {
      const keys = new Set<string>();
      const index = store.index('portalCacheKey');
      const request = index.openKeyCursor(IDBKeyRange.only(portalCacheKey));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          keys.add(String(cursor.primaryKey));
          cursor.continue();
        } else {
          resolve(keys);
        }
      };
      request.onerror = () => resolve(keys);
    });
  };

  const existingMovieKeys = await getExistingKeys(moviesStore);
  const existingSeriesKeys = await getExistingKeys(seriesStore);

  let addedMovies = 0;
  let updatedMovies = 0;
  let addedSeries = 0;

  // 1. Save Movie Categories
  data.movieCategories.forEach((cat, idx) => {
    const key = `${portalCacheKey}:mcat:${cat.id}`;
    movieCatStore.put({
      key,
      portalCacheKey,
      id: cat.id,
      title: cat.title,
      alias: cat.alias || '',
      order: cat.order ?? idx,
      itemCount: cat.itemCount || 0,
      type: 'movie',
    });
  });

  // 2. Save Series Categories
  data.seriesCategories.forEach((cat, idx) => {
    const key = `${portalCacheKey}:scat:${cat.id}`;
    seriesCatStore.put({
      key,
      portalCacheKey,
      id: cat.id,
      title: cat.title,
      alias: cat.alias || '',
      order: cat.order ?? idx,
      itemCount: cat.itemCount || 0,
      type: 'series',
    });
  });

  // 3. Save Movies (Differential)
  const newMovieKeys = new Set<string>();
  data.movies.forEach((m) => {
    const key = `${portalCacheKey}:m:${m.id}`;
    newMovieKeys.add(key);

    if (existingMovieKeys.has(key)) {
      updatedMovies++;
    } else {
      addedMovies++;
    }

    // Omit temporary stream links / play tokens
    moviesStore.put({
      key,
      portalCacheKey,
      id: m.id,
      title: m.title,
      categoryId: m.categoryId || m.category,
      category: m.category,
      poster: m.poster,
      posterCandidates: m.posterCandidates || [m.poster],
      primaryPoster: m.poster,
      posterSource: m.posterSource || 'default',
      backdrop: m.backdrop || '',
      rating: m.rating || 'N/A',
      releaseYear: m.releaseYear || 0,
      duration: m.duration || 'N/A',
      overview: m.overview || '',
      genre: m.genre || [],
      director: m.director || '',
      cast: m.cast || [],
      cmd: m.cmd || '',
      isFavorite: Boolean(m.isFavorite),
      isLocked: Boolean(m.isLocked),
      addedDate: m.addedDate || '',
    });
  });

  // Delete movies removed on server
  let removedMovies = 0;
  existingMovieKeys.forEach((key) => {
    if (!newMovieKeys.has(key)) {
      moviesStore.delete(key);
      removedMovies++;
    }
  });

  // 4. Save Series (Differential)
  const newSeriesKeys = new Set<string>();
  data.series.forEach((s) => {
    const key = `${portalCacheKey}:s:${s.id}`;
    newSeriesKeys.add(key);

    if (!existingSeriesKeys.has(key)) {
      addedSeries++;
    }

    seriesStore.put({
      key,
      portalCacheKey,
      id: s.id,
      title: s.title,
      categoryId: s.categoryId || s.category,
      category: s.category,
      poster: s.poster,
      posterCandidates: s.posterCandidates || [s.poster],
      primaryPoster: s.poster,
      posterSource: s.posterSource || 'default',
      backdrop: s.backdrop || '',
      rating: s.rating || 'N/A',
      releaseYear: s.releaseYear || 0,
      overview: s.overview || '',
      genre: s.genre || [],
      totalSeasons: s.totalSeasons || 1,
      seasons: s.seasons || [],
      isFavorite: Boolean(s.isFavorite),
      isLocked: Boolean(s.isLocked),
    });
  });

  existingSeriesKeys.forEach((key) => {
    if (!newSeriesKeys.has(key)) {
      seriesStore.delete(key);
    }
  });

  // 5. Update Portal Cache Meta
  const meta: PortalCacheMeta = {
    portalCacheKey,
    lastCatalogUpdate: Date.now(),
    movieCount: data.movies.length,
    seriesCount: data.series.length,
    movieCategoriesCount: data.movieCategories.length,
    seriesCategoriesCount: data.seriesCategories.length,
    auditReport: data.auditReport || '',
    categoryAuditReport: data.categoryAuditReport || '',
    schemaVersion: DB_VERSION,
  };
  portalsStore.put(meta);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve({ addedMovies, updatedMovies, removedMovies, addedSeries });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Erreur sauvegarde IndexedDB'));
    };
  });
}

export async function loadPortalCatalog(portalCacheKey: string): Promise<{
  movieCategories: StalkerGenre[];
  seriesCategories: StalkerGenre[];
  movies: VODItem[];
  series: TVSeries[];
  meta: PortalCacheMeta;
} | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(
      ['portals', 'movieCategories', 'seriesCategories', 'movies', 'series'],
      'readonly'
    );

    const portalsStore = tx.objectStore('portals');
    const movieCatStore = tx.objectStore('movieCategories');
    const seriesCatStore = tx.objectStore('seriesCategories');
    const moviesStore = tx.objectStore('movies');
    const seriesStore = tx.objectStore('series');

    const meta: PortalCacheMeta | undefined = await new Promise((resolve) => {
      const req = portalsStore.get(portalCacheKey);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });

    if (!meta || !meta.lastCatalogUpdate) {
      db.close();
      return null;
    }

    const getAllByIndex = <T>(store: IDBObjectStore): Promise<T[]> => {
      return new Promise((resolve) => {
        const index = store.index('portalCacheKey');
        const req = index.getAll(portalCacheKey);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    };

    const [movieCatsRaw, seriesCatsRaw, moviesRaw, seriesRaw] = await Promise.all([
      getAllByIndex<any>(movieCatStore),
      getAllByIndex<any>(seriesCatStore),
      getAllByIndex<any>(moviesStore),
      getAllByIndex<any>(seriesStore),
    ]);

    db.close();

    // Sort categories by order index
    movieCatsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    seriesCatsRaw.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const movieCategories: StalkerGenre[] = movieCatsRaw.map((c) => ({
      id: c.id,
      title: c.title,
      alias: c.alias,
      order: c.order,
      itemCount: c.itemCount,
      type: 'movie',
    }));

    const seriesCategories: StalkerGenre[] = seriesCatsRaw.map((c) => ({
      id: c.id,
      title: c.title,
      alias: c.alias,
      order: c.order,
      itemCount: c.itemCount,
      type: 'series',
    }));

    const movies: VODItem[] = moviesRaw.map((m) => ({
      id: m.id,
      title: m.title,
      streamUrl: '', // Will resolve on play
      cmd: m.cmd || '',
      poster: m.primaryPoster || m.poster,
      posterCandidates: m.posterCandidates || [m.poster],
      posterSource: m.posterSource,
      backdrop: m.backdrop,
      category: m.category,
      categoryId: m.categoryId || m.category,
      rating: m.rating,
      releaseYear: m.releaseYear,
      duration: m.duration,
      overview: m.overview,
      genre: m.genre,
      director: m.director,
      cast: m.cast,
      isFavorite: m.isFavorite,
      isLocked: m.isLocked,
      addedDate: m.addedDate,
    }));

    const series: TVSeries[] = seriesRaw.map((s) => ({
      id: s.id,
      title: s.title,
      poster: s.primaryPoster || s.poster,
      posterCandidates: s.posterCandidates || [s.poster],
      posterSource: s.posterSource,
      backdrop: s.backdrop,
      category: s.category,
      categoryId: s.categoryId || s.category,
      rating: s.rating,
      releaseYear: s.releaseYear,
      overview: s.overview,
      genre: s.genre,
      totalSeasons: s.totalSeasons,
      seasons: s.seasons || [],
      isFavorite: s.isFavorite,
      isLocked: s.isLocked,
    }));

    return {
      movieCategories,
      seriesCategories,
      movies,
      series,
      meta,
    };
  } catch (err) {
    console.warn('Error reading catalog from IndexedDB:', err);
    return null;
  }
}

export async function saveSeriesDetails(
  portalCacheKey: string,
  seriesId: string,
  seasons: TVSeriesSeason[]
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(['seriesDetails'], 'readwrite');
    const store = tx.objectStore('seriesDetails');

    const key = `${portalCacheKey}:sd:${seriesId}`;
    store.put({
      key,
      portalCacheKey,
      seriesId,
      seasons,
      lastUpdated: Date.now(),
    });

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn('Error saving series details to IndexedDB:', err);
  }
}

export async function loadSeriesDetails(
  portalCacheKey: string,
  seriesId: string,
  maxAgeMs = 24 * 60 * 60 * 1000 // 24 Hours TTL
): Promise<TVSeriesSeason[] | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(['seriesDetails'], 'readonly');
    const store = tx.objectStore('seriesDetails');
    const key = `${portalCacheKey}:sd:${seriesId}`;

    const record: CachedSeriesDetails | undefined = await new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });

    db.close();

    if (!record || !record.seasons || record.seasons.length === 0) {
      return null;
    }

    if (Date.now() - record.lastUpdated > maxAgeMs) {
      return null; // Expired
    }

    return record.seasons;
  } catch (err) {
    return null;
  }
}

export async function clearPortalCache(portalCacheKey?: string): Promise<void> {
  try {
    const db = await openDB();
    const stores = [
      'portals',
      'movieCategories',
      'seriesCategories',
      'movies',
      'series',
      'seriesDetails',
      'catalogMetadata',
    ];
    const tx = db.transaction(stores, 'readwrite');

    if (!portalCacheKey) {
      stores.forEach((s) => tx.objectStore(s).clear());
    } else {
      const clearByPortalKey = (storeName: string) => {
        const store = tx.objectStore(storeName);
        if (storeName === 'portals') {
          store.delete(portalCacheKey);
        } else {
          const index = store.index('portalCacheKey');
          const req = index.openKeyCursor(IDBKeyRange.only(portalCacheKey));
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
      };

      stores.forEach(clearByPortalKey);
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn('Error clearing IndexedDB cache:', err);
  }
}
