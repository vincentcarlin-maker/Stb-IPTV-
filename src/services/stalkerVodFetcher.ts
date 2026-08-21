import { VODItem, TVSeries } from '../types/iptv';
import { vodCacheService } from './vodCacheService';

export interface StalkerVodProgress {
  movies: {
    serverTotal: number;
    expectedPages: number;
    fetchedPages: number;
    fetchedItems: number;
    uniqueCount: number;
    failedPagesCount: number;
    missingPagesCount: number;
  };
  series: {
    serverTotal: number;
    expectedPages: number;
    fetchedPages: number;
    fetchedItems: number;
    uniqueCount: number;
    failedPagesCount: number;
    missingPagesCount: number;
  };
  activeRequests: number;
  currentConcurrency: number;
  retryCount: number;
  definitiveErrors: number;
  statusMessage: string;
  isComplete: boolean;
  catalogCompleteStatus: 'YES' | 'NO';
  catalogCompleteReason?: string;
  currentMovies?: VODItem[];
  currentSeries?: TVSeries[];
}

export interface StalkerAuditReport {
  movies: {
    serverTotal: number;
    expectedPages: number;
    fetchedPages: number;
    failedPages: number;
    missingPages: number;
    rawItems: number;
    uniqueItems: number;
  };
  series: {
    serverTotal: number;
    expectedPages: number;
    fetchedPages: number;
    failedPages: number;
    missingPages: number;
    rawItems: number;
    uniqueItems: number;
  };
  concurrency: number;
  retries: number;
  totalTimeSeconds: string;
  catalogComplete: 'YES' | 'NO';
  reason?: string;
  formattedText: string;
}

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') || 
  window.location.hostname.includes('github.pages') ||
  window.location.hostname.includes('pages.dev') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('vercel.app')
);

async function rawStalkerRequest(
  portalUrl: string,
  mac: string,
  type: string,
  action: string,
  token: string | null,
  params?: any
): Promise<any> {
  const cleanUrl = portalUrl.trim().replace(/\/+$/, '');
  const loadPhpUrl = cleanUrl.includes('load.php') ? cleanUrl : `${cleanUrl}/server/load.php`;

  const queryParams = new URLSearchParams({
    type,
    action: action || 'get_ordered_list',
    ...(params || {}),
  });

  if (isStaticHost) {
    const targetUrl = `${loadPhpUrl}?${queryParams.toString()}`;
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(proxyUrl, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('/api/stalker/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portalUrl,
        mac,
        type,
        action,
        token,
        params,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export class StalkerVodFetcher {
  private portalUrl: string;
  private mac: string;
  private token: string | null;
  private portalKey: string;

  // Concurrency bounds (Rule #3: 4 -> 5 -> 6 max, error -> 6 -> 4 -> 2 -> 1)
  private currentConcurrency = 4;
  private maxConcurrency = 6;
  private minConcurrency = 1;
  private consecutiveSuccesses = 0;

  // Active requests counter
  private activeRequestsCount = 0;

  // Retry tracking (Rule #4)
  private totalRetriesCount = 0;
  private totalDefinitiveErrors = 0;

  constructor(portalUrl: string, mac: string, token: string | null = null) {
    this.portalUrl = portalUrl;
    this.mac = mac;
    this.token = token;

    try {
      const u = new URL(portalUrl);
      this.portalKey = `${u.hostname}:${u.port || '80'}${u.pathname}`.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
      this.portalKey = portalUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
    }
  }

  private increaseConcurrency() {
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses >= 3) {
      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        console.log(`[StalkerFetcher] Concurrency increased: ${this.currentConcurrency}`);
      }
      this.consecutiveSuccesses = 0;
    }
  }

  private decreaseConcurrency() {
    this.consecutiveSuccesses = 0;
    if (this.currentConcurrency > this.minConcurrency) {
      this.currentConcurrency = Math.max(this.minConcurrency, Math.floor(this.currentConcurrency / 2));
      console.warn(`[StalkerFetcher] Error detected, concurrency reduced to ${this.currentConcurrency}`);
    }
  }

  /**
   * Helper to execute a page request with exponential backoff & jitter (Rule #4)
   * Tentative 1 -> error -> wait 500ms + jitter
   * Tentative 2 -> error -> wait 1500ms + jitter
   * Tentative 3 -> error -> wait 3000ms + jitter
   */
  private async fetchPageWithRetry(
    type: 'vod' | 'series',
    action: string,
    page: number,
    categoryId: string = '0',
    maxAttempts = 3
  ): Promise<{ items: any[]; totalItems?: number; pageSize?: number; pageNumber: number; success: boolean; error?: string }> {
    let attempt = 0;
    const delays = [500, 1500, 3000];

    while (attempt < maxAttempts) {
      attempt++;
      this.activeRequestsCount++;
      try {
        const responseData = await rawStalkerRequest(this.portalUrl, this.mac, type, action, this.token, {
          page,
          p: page,
          category: categoryId,
          genre: categoryId,
          sortby: 'added',
        });
        this.activeRequestsCount = Math.max(0, this.activeRequestsCount - 1);

        const js = responseData?.js;
        let items: any[] = [];

        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.records)) items = js.records;
        else if (Array.isArray(js?.items)) items = js.items;

        const totalItems = js?.total_items !== undefined ? parseInt(js.total_items, 10) 
          : js?.selected_item !== undefined ? parseInt(js.selected_item, 10)
          : js?.total !== undefined ? parseInt(js.total, 10)
          : undefined;

        const pageSize = js?.max_page_items !== undefined ? parseInt(js.max_page_items, 10)
          : js?.page_size !== undefined ? parseInt(js.page_size, 10)
          : undefined;

        // Success!
        this.increaseConcurrency();
        return {
          items,
          totalItems,
          pageSize,
          pageNumber: page,
          success: true,
        };
      } catch (err: any) {
        this.activeRequestsCount = Math.max(0, this.activeRequestsCount - 1);
        this.decreaseConcurrency();
        this.totalRetriesCount++;

        console.warn(`[StalkerFetcher] Page ${page} (${type}) attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

        if (attempt < maxAttempts) {
          const baseDelay = delays[attempt - 1] || 1000;
          const jitter = Math.floor(Math.random() * 300);
          await new Promise((r) => setTimeout(r, baseDelay + jitter));
        } else {
          this.totalDefinitiveErrors++;
          return {
            items: [],
            pageNumber: page,
            success: false,
            error: err.message,
          };
        }
      }
    }

    return { items: [], pageNumber: page, success: false, error: 'Max retries reached' };
  }

  /**
   * Helper to process a queue of pages with limited worker concurrency
   */
  private async processPageQueue(
    type: 'vod' | 'series',
    action: string,
    pagesToFetch: number[],
    categoryId: string = '0',
    onPageResult: (res: { items: any[]; pageNumber: number; success: boolean }) => void
  ): Promise<{ failedPages: number[] }> {
    const queue = [...pagesToFetch];
    const failedPages: number[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const page = queue.shift();
        if (page === undefined) break;

        const result = await this.fetchPageWithRetry(type, action, page, categoryId);
        if (result.success) {
          onPageResult(result);
        } else {
          failedPages.push(page);
        }
      }
    };

    // Run parallel workers dynamically according to currentConcurrency limit
    const workerPromises: Promise<void>[] = [];
    const initialWorkerCount = Math.min(this.currentConcurrency, pagesToFetch.length);

    for (let i = 0; i < initialWorkerCount; i++) {
      workerPromises.push(worker());
    }

    await Promise.all(workerPromises);
    return { failedPages };
  }

  /**
   * Fetch categories from server for VOD or Series (Rule #7 & #8)
   */
  public async fetchCategories(type: 'vod' | 'series'): Promise<{ id: string; name: string }[]> {
    try {
      const data = await rawStalkerRequest(this.portalUrl, this.mac, type, 'get_categories', this.token);
      const js = data?.js;
      let rawCats: any[] = [];
      if (Array.isArray(js)) rawCats = js;
      else if (Array.isArray(js?.data)) rawCats = js.data;
      else if (Array.isArray(js?.items)) rawCats = js.items;

      return rawCats.map((c: any) => ({
        id: String(c.id || c.category_id || '').trim(),
        name: String(c.title || c.category_name || c.name || '').trim(),
      })).filter((c) => c.id && c.name);
    } catch {
      return [];
    }
  }

  /**
   * Main execution method for complete VOD Movies and Series catalogue retrieval
   */
  public async fetchFullCatalogue(
    onProgress?: (progress: StalkerVodProgress) => void
  ): Promise<{
    movies: VODItem[];
    series: TVSeries[];
    auditReport: StalkerAuditReport;
  }> {
    const startTime = Date.now();
    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {}

    const movieMap = new Map<string, VODItem>();
    const seriesMap = new Map<string, TVSeries>();

    let rawMovieCount = 0;
    let rawSeriesCount = 0;

    // Load existing cached items & previously completed pages for resumption (Rule #11)
    const [cachedMovies, cachedSeries, completedMoviePages, completedSeriesPages] = await Promise.all([
      vodCacheService.getCachedMovies(this.portalKey),
      vodCacheService.getCachedSeries(this.portalKey),
      vodCacheService.getFetchedPages(this.portalKey, 'vod'),
      vodCacheService.getFetchedPages(this.portalKey, 'series'),
    ]);

    cachedMovies.forEach((m) => movieMap.set(m.id, m));
    cachedSeries.forEach((s) => seriesMap.set(s.id, s));

    if (cachedMovies.length > 0 || cachedSeries.length > 0) {
      console.log(`[StalkerFetcher] Resuming import from IndexedDB cache: ${cachedMovies.length} movies (${completedMoviePages.size} pages), ${cachedSeries.length} series (${completedSeriesPages.size} pages).`);
    }

    // Fetch server category lookup maps
    const movieCatMap = new Map<string, string>();
    const seriesCatMap = new Map<string, string>();
    try {
      const [movieCats, seriesCats] = await Promise.all([
        this.fetchCategories('vod'),
        this.fetchCategories('series'),
      ]);
      movieCats.forEach(c => movieCatMap.set(c.id, c.name));
      seriesCats.forEach(c => seriesCatMap.set(c.id, c.name));
    } catch (e) {
      console.warn('[StalkerFetcher] Category map fetch notice:', e);
    }

    // Progress State Init
    const progress: StalkerVodProgress = {
      movies: {
        serverTotal: 0,
        expectedPages: 0,
        fetchedPages: 0,
        fetchedItems: 0,
        uniqueCount: 0,
        failedPagesCount: 0,
        missingPagesCount: 0,
      },
      series: {
        serverTotal: 0,
        expectedPages: 0,
        fetchedPages: 0,
        fetchedItems: 0,
        uniqueCount: 0,
        failedPagesCount: 0,
        missingPagesCount: 0,
      },
      activeRequests: 0,
      currentConcurrency: this.currentConcurrency,
      retryCount: 0,
      definitiveErrors: 0,
      statusMessage: 'Analyse de la pagination du catalogue...',
      isComplete: false,
      catalogCompleteStatus: 'NO',
    };

    let lastMovieSaveCount = 0;
    let lastSeriesSaveCount = 0;

    const saveIncrementalCache = (force = false) => {
      const currentM = Array.from(movieMap.values());
      const currentS = Array.from(seriesMap.values());
      if (force || currentM.length - lastMovieSaveCount >= 25) {
        lastMovieSaveCount = currentM.length;
        if (currentM.length > 0) {
          vodCacheService.saveMoviesInBatches(this.portalKey, currentM).catch(() => {});
        }
      }
      if (force || currentS.length - lastSeriesSaveCount >= 25) {
        lastSeriesSaveCount = currentS.length;
        if (currentS.length > 0) {
          vodCacheService.saveSeriesInBatches(this.portalKey, currentS).catch(() => {});
        }
      }
    };

    const unloadHandler = () => {
      saveIncrementalCache(true);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', unloadHandler);
      window.addEventListener('pagehide', unloadHandler);
    }

    const emitProgress = (msg?: string) => {
      if (msg) progress.statusMessage = msg;
      progress.activeRequests = this.activeRequestsCount;
      progress.currentConcurrency = this.currentConcurrency;
      progress.retryCount = this.totalRetriesCount;
      progress.definitiveErrors = this.totalDefinitiveErrors;
      progress.movies.uniqueCount = movieMap.size;
      progress.series.uniqueCount = seriesMap.size;
      progress.currentMovies = Array.from(movieMap.values());
      progress.currentSeries = Array.from(seriesMap.values());
      saveIncrementalCache();
      if (onProgress) onProgress({ ...progress });
    };

    // Helper to format movie item without heavy details
    const parseMovieItem = (item: any, index: number): VODItem => {
      const realId = String(item.id || item.vod_id || index).trim();
      const rawCmd = item.cmd ? item.cmd.trim() : '';
      let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();

      if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
        if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
      } else if (streamUrl.startsWith('/')) {
        if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
      }

      let poster = item.screenshot_uri || item.poster || item.logo || item.cover;
      if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
        poster = portalOrigin ? `${portalOrigin}/${poster.replace(/^\//, '')}` : `${this.portalUrl}/${poster}`;
      }

      const catId = String(item.category_id || item.genre_id || '').trim();
      const resolvedCategory = item.category_name || item.genre_name || movieCatMap.get(catId) || 'Films VOD';

      return {
        id: `stalker-vod-${realId}`,
        title: item.name || item.o_name || item.title || `Film Stalker ${index + 1}`,
        streamUrl: streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
        cmd: rawCmd,
        poster: poster || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
        backdrop: poster,
        category: resolvedCategory,
        rating: item.rating ? `${item.rating}/10` : 'Tous publics',
        releaseYear: item.year ? parseInt(item.year, 10) : 2024,
        duration: item.time || item.duration || '1h 45m',
        overview: item.description || item.plot || 'Film VOD disponible sur votre serveur Stalker.',
        genre: [resolvedCategory],
        director: item.director,
        cast: item.actors ? item.actors.split(',') : undefined,
      };
    };

    // Helper to format series item without heavy details
    const parseSeriesItem = (item: any, index: number): TVSeries => {
      const realId = String(item.id || item.series_id || index).trim();
      let poster = item.screenshot_uri || item.poster || item.cover || item.logo;
      if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
        poster = portalOrigin ? `${portalOrigin}/${poster.replace(/^\//, '')}` : `${this.portalUrl}/${poster}`;
      }

      const catId = String(item.category_id || item.genre_id || '').trim();
      const resolvedCategory = item.category_name || item.genre_name || seriesCatMap.get(catId) || 'Séries TV';

      return {
        id: `stalker-series-${realId}`,
        title: item.name || item.title || `Série ${index + 1}`,
        poster: poster || 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
        backdrop: poster,
        category: resolvedCategory,
        rating: item.rating ? `${item.rating}/10` : '12+',
        releaseYear: item.year ? parseInt(item.year, 10) : 2024,
        overview: item.description || item.plot || 'Série TV disponible sur votre serveur Stalker.',
        genre: [resolvedCategory],
        totalSeasons: item.total_seasons ? parseInt(item.total_seasons, 10) : 1,
        seasons: [],
      };
    };

    // ==========================================
    // STEP 1: FETCH MOVIES CATALOGUE
    // ==========================================
    emitProgress('Détéction de la pagination Films...');

    // First page probe for VOD Movies
    let moviesAction = 'get_ordered_list';
    let firstMoviePage = await this.fetchPageWithRetry('vod', moviesAction, 1);
    if (!firstMoviePage.success || firstMoviePage.items.length === 0) {
      moviesAction = 'get_all_records';
      firstMoviePage = await this.fetchPageWithRetry('vod', moviesAction, 1);
    }

    let movieServerTotal = firstMoviePage.totalItems || 0;
    let moviePageSize = firstMoviePage.pageSize || (firstMoviePage.items.length > 0 ? firstMoviePage.items.length : 50);
    if (moviePageSize <= 0) moviePageSize = 50;

    if (movieServerTotal === 0 && firstMoviePage.items.length > 0) {
      movieServerTotal = firstMoviePage.items.length;
    }

    let movieExpectedPages = movieServerTotal > 0 ? Math.ceil(movieServerTotal / moviePageSize) : 1;

    progress.movies.serverTotal = movieServerTotal;
    progress.movies.expectedPages = movieExpectedPages;
    emitProgress(`Catalogue Films : ${movieServerTotal} annoncés (${movieExpectedPages} pages).`);

    // Ingest first page if not already in cache
    if (!completedMoviePages.has(1) && firstMoviePage.items.length > 0) {
      progress.movies.fetchedPages++;
      progress.movies.fetchedItems += firstMoviePage.items.length;
      rawMovieCount += firstMoviePage.items.length;
      firstMoviePage.items.forEach((item, idx) => {
        const parsed = parseMovieItem(item, idx);
        movieMap.set(parsed.id, parsed);
      });
      vodCacheService.markPagesFetched(this.portalKey, 'vod', [1]).catch(() => {});
    } else if (completedMoviePages.has(1)) {
      progress.movies.fetchedPages++;
    }

    // Build remaining page list for Movies: [2, 3, ..., expectedPages]
    let moviePagesToFetch: number[] = [];
    for (let p = 2; p <= movieExpectedPages; p++) {
      if (completedMoviePages.has(p)) {
        progress.movies.fetchedPages++;
      } else {
        moviePagesToFetch.push(p);
      }
    }

    emitProgress(`Catalogue Films : ${movieServerTotal} annoncés (${progress.movies.fetchedPages}/${movieExpectedPages} pages en mémoire).`);

    if (moviePagesToFetch.length > 0) {
      const { failedPages } = await this.processPageQueue(
        'vod',
        moviesAction,
        moviePagesToFetch,
        '0',
        (res) => {
          progress.movies.fetchedPages++;
          progress.movies.fetchedItems += res.items.length;
          rawMovieCount += res.items.length;
          res.items.forEach((item, idx) => {
            const parsed = parseMovieItem(item, idx);
            movieMap.set(parsed.id, parsed);
          });
          vodCacheService.markPagesFetched(this.portalKey, 'vod', [res.pageNumber]).catch(() => {});
          emitProgress(`Chargement Films : ${progress.movies.fetchedPages}/${movieExpectedPages} pages (${movieMap.size}/${movieServerTotal} uniques)`);
        }
      );

      // Retry failed pages up to 2 pass cycles (Rule #2 & #5 & #11)
      if (failedPages.length > 0) {
        console.warn(`[StalkerFetcher] Retrying ${failedPages.length} failed movie pages...`);
        progress.movies.failedPagesCount = failedPages.length;
        emitProgress(`Nouvelle tentative sur ${failedPages.length} pages Films manquantes...`);

        const retryRes = await this.processPageQueue(
          'vod',
          moviesAction,
          failedPages,
          '0',
          (res) => {
            progress.movies.fetchedPages++;
            progress.movies.fetchedItems += res.items.length;
            rawMovieCount += res.items.length;
            res.items.forEach((item, idx) => {
              const parsed = parseMovieItem(item, idx);
              movieMap.set(parsed.id, parsed);
            });
            emitProgress(`Retry Films : ${movieMap.size}/${movieServerTotal} uniques.`);
          }
        );

        progress.movies.missingPagesCount = retryRes.failedPages.length;
      }
    }

    // Check if category scanning is required (Rule #7 & #10: if unique items < server total)
    if (movieServerTotal > 0 && movieMap.size < movieServerTotal) {
      console.warn(`[StalkerFetcher] Global movies view incomplete (${movieMap.size}/${movieServerTotal}). Scanning server categories...`);
      emitProgress('Analyse des catégories serveur pour compléter les films manquants...');

      const movieCategories = await this.fetchCategories('vod');
      for (const cat of movieCategories) {
        if (movieMap.size >= movieServerTotal) break;
        const catRes = await this.fetchPageWithRetry('vod', moviesAction, 1, cat.id);
        if (catRes.success && catRes.items.length > 0) {
          catRes.items.forEach((item, idx) => {
            const parsed = parseMovieItem(item, idx);
            if (!parsed.category || parsed.category === 'Films VOD') {
              parsed.category = cat.name;
            }
            movieMap.set(parsed.id, parsed);
          });
          emitProgress(`Extraction catégorie ${cat.name} : ${movieMap.size}/${movieServerTotal} films.`);
        }
      }
    }

    // ==========================================
    // STEP 2: FETCH SERIES CATALOGUE
    // ==========================================
    emitProgress('Détection de la pagination Séries...');

    let seriesAction = 'get_ordered_list';
    let firstSeriesPage = await this.fetchPageWithRetry('series', seriesAction, 1);
    if (!firstSeriesPage.success || firstSeriesPage.items.length === 0) {
      seriesAction = 'get_all_records';
      firstSeriesPage = await this.fetchPageWithRetry('series', seriesAction, 1);
    }

    let seriesServerTotal = firstSeriesPage.totalItems || 0;
    let seriesPageSize = firstSeriesPage.pageSize || (firstSeriesPage.items.length > 0 ? firstSeriesPage.items.length : 50);
    if (seriesPageSize <= 0) seriesPageSize = 50;

    if (seriesServerTotal === 0 && firstSeriesPage.items.length > 0) {
      seriesServerTotal = firstSeriesPage.items.length;
    }

    let seriesExpectedPages = seriesServerTotal > 0 ? Math.ceil(seriesServerTotal / seriesPageSize) : 1;

    progress.series.serverTotal = seriesServerTotal;
    progress.series.expectedPages = seriesExpectedPages;
    emitProgress(`Catalogue Séries : ${seriesServerTotal} annoncées (${seriesExpectedPages} pages).`);

    // Ingest first series page if not already in cache
    if (!completedSeriesPages.has(1) && firstSeriesPage.items.length > 0) {
      progress.series.fetchedPages++;
      progress.series.fetchedItems += firstSeriesPage.items.length;
      rawSeriesCount += firstSeriesPage.items.length;
      firstSeriesPage.items.forEach((item, idx) => {
        const parsed = parseSeriesItem(item, idx);
        seriesMap.set(parsed.id, parsed);
      });
      vodCacheService.markPagesFetched(this.portalKey, 'series', [1]).catch(() => {});
    } else if (completedSeriesPages.has(1)) {
      progress.series.fetchedPages++;
    }

    // Build remaining page list for Series: [2, 3, ..., expectedPages]
    let seriesPagesToFetch: number[] = [];
    for (let p = 2; p <= seriesExpectedPages; p++) {
      if (completedSeriesPages.has(p)) {
        progress.series.fetchedPages++;
      } else {
        seriesPagesToFetch.push(p);
      }
    }

    emitProgress(`Catalogue Séries : ${seriesServerTotal} annoncées (${progress.series.fetchedPages}/${seriesExpectedPages} pages en mémoire).`);

    if (seriesPagesToFetch.length > 0) {
      const { failedPages } = await this.processPageQueue(
        'series',
        seriesAction,
        seriesPagesToFetch,
        '0',
        (res) => {
          progress.series.fetchedPages++;
          progress.series.fetchedItems += res.items.length;
          rawSeriesCount += res.items.length;
          res.items.forEach((item, idx) => {
            const parsed = parseSeriesItem(item, idx);
            seriesMap.set(parsed.id, parsed);
          });
          vodCacheService.markPagesFetched(this.portalKey, 'series', [res.pageNumber]).catch(() => {});
          emitProgress(`Chargement Séries : ${progress.series.fetchedPages}/${seriesExpectedPages} pages (${seriesMap.size}/${seriesServerTotal} uniques)`);
        }
      );

      // Retry failed pages
      if (failedPages.length > 0) {
        console.warn(`[StalkerFetcher] Retrying ${failedPages.length} failed series pages...`);
        progress.series.failedPagesCount = failedPages.length;
        emitProgress(`Nouvelle tentative sur ${failedPages.length} pages Séries manquantes...`);

        const retryRes = await this.processPageQueue(
          'series',
          seriesAction,
          failedPages,
          '0',
          (res) => {
            progress.series.fetchedPages++;
            progress.series.fetchedItems += res.items.length;
            rawSeriesCount += res.items.length;
            res.items.forEach((item, idx) => {
              const parsed = parseSeriesItem(item, idx);
              seriesMap.set(parsed.id, parsed);
            });
            emitProgress(`Retry Séries : ${seriesMap.size}/${seriesServerTotal} uniques.`);
          }
        );

        progress.series.missingPagesCount = retryRes.failedPages.length;
      }
    }

    // Check if category scanning is required for Series
    if (seriesServerTotal > 0 && seriesMap.size < seriesServerTotal) {
      console.warn(`[StalkerFetcher] Global series view incomplete (${seriesMap.size}/${seriesServerTotal}). Scanning categories...`);
      emitProgress('Analyse des catégories Séries serveur...');

      const seriesCategories = await this.fetchCategories('series');
      for (const cat of seriesCategories) {
        if (seriesMap.size >= seriesServerTotal) break;
        const catRes = await this.fetchPageWithRetry('series', seriesAction, 1, cat.id);
        if (catRes.success && catRes.items.length > 0) {
          catRes.items.forEach((item, idx) => {
            const parsed = parseSeriesItem(item, idx);
            if (!parsed.category || parsed.category === 'Séries TV') {
              parsed.category = cat.name;
            }
            seriesMap.set(parsed.id, parsed);
          });
          emitProgress(`Extraction catégorie Séries ${cat.name} : ${seriesMap.size}/${seriesServerTotal}.`);
        }
      }
    }

    // ==========================================
    // STEP 3: AUDIT & VALIDATION (Rule #10, #15, #16)
    // ==========================================
    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(1);

    const moviesList = Array.from(movieMap.values());
    const seriesList = Array.from(seriesMap.values());

    const moviesComplete = 
      progress.movies.missingPagesCount === 0 &&
      (movieServerTotal === 0 || moviesList.length >= movieServerTotal);

    const seriesComplete = 
      progress.series.missingPagesCount === 0 &&
      (seriesServerTotal === 0 || seriesList.length >= seriesServerTotal);

    const isCatalogComplete = moviesComplete && seriesComplete;
    const catalogCompleteStatus: 'YES' | 'NO' = isCatalogComplete ? 'YES' : 'NO';

    let reason: string | undefined = undefined;
    if (!isCatalogComplete) {
      const reasons: string[] = [];
      if (progress.movies.missingPagesCount > 0) reasons.push(`${progress.movies.missingPagesCount} pages Films non récupérées`);
      if (movieServerTotal > 0 && moviesList.length < movieServerTotal) reasons.push(`Films incomplets (${moviesList.length}/${movieServerTotal})`);
      if (progress.series.missingPagesCount > 0) reasons.push(`${progress.series.missingPagesCount} pages Séries non récupérées`);
      if (seriesServerTotal > 0 && seriesList.length < seriesServerTotal) reasons.push(`Séries incomplètes (${seriesList.length}/${seriesServerTotal})`);
      reason = reasons.join(' ; ');
    }

    const formattedAuditText = `===== STALKER CATALOG AUDIT =====
MOVIES
Server total: ${movieServerTotal}
Expected pages: ${movieExpectedPages}
Fetched pages: ${progress.movies.fetchedPages}
Failed pages: ${progress.movies.failedPagesCount}
Missing pages: ${progress.movies.missingPagesCount}
Raw items: ${rawMovieCount}
Unique items: ${moviesList.length}
SERIES
Server total: ${seriesServerTotal}
Expected pages: ${seriesExpectedPages}
Fetched pages: ${progress.series.fetchedPages}
Failed pages: ${progress.series.failedPagesCount}
Missing pages: ${progress.series.missingPagesCount}
Raw items: ${rawSeriesCount}
Unique items: ${seriesList.length}
Concurrency: ${this.currentConcurrency}
Retries: ${this.totalRetriesCount}
Total time: ${durationSec}s
CATALOG COMPLETE: ${catalogCompleteStatus}${reason ? `\nReason: ${reason}` : ''}`;

    console.log(formattedAuditText);

    const auditReport: StalkerAuditReport = {
      movies: {
        serverTotal: movieServerTotal,
        expectedPages: movieExpectedPages,
        fetchedPages: progress.movies.fetchedPages,
        failedPages: progress.movies.failedPagesCount,
        missingPages: progress.movies.missingPagesCount,
        rawItems: rawMovieCount,
        uniqueItems: moviesList.length,
      },
      series: {
        serverTotal: seriesServerTotal,
        expectedPages: seriesExpectedPages,
        fetchedPages: progress.series.fetchedPages,
        failedPages: progress.series.failedPagesCount,
        missingPages: progress.series.missingPagesCount,
        rawItems: rawSeriesCount,
        uniqueItems: seriesList.length,
      },
      concurrency: this.currentConcurrency,
      retries: this.totalRetriesCount,
      totalTimeSeconds: durationSec,
      catalogComplete: catalogCompleteStatus,
      reason,
      formattedText: formattedAuditText,
    };

    // ==========================================
    // STEP 4: INDEXEDDB CACHE WRITE (Rule #12)
    // ==========================================
    // Commit to IndexedDB in batches of 100-200. Never erase old catalogue before validation!
    if (isCatalogComplete || moviesList.length > 0 || seriesList.length > 0) {
      emitProgress('Mise en cache du catalogue dans IndexedDB par lots de 150 éléments...');
      await vodCacheService.commitCompleteCatalogue(
        this.portalKey,
        moviesList,
        seriesList,
        auditReport
      );
    }

    progress.isComplete = true;
    progress.catalogCompleteStatus = catalogCompleteStatus;
    progress.catalogCompleteReason = reason;
    emitProgress(isCatalogComplete ? 'Catalogue Stalker récupéré et validé à 100% !' : 'Catalogue partiellement récupéré.');

    return {
      movies: moviesList,
      series: seriesList,
      auditReport,
    };
  }
}
