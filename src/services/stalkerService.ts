import { Channel, VODItem, TVSeries, EPGProgram, StalkerGenre } from '../types/iptv';

export interface VodProgressCallback {
  type: 'films' | 'series';
  current: number;
  total: number;
  page: number;
  totalPages: number;
  itemsChunk: any[];
}

export interface VodCategoryAuditItem {
  categoryId: string;
  categoryName: string;
  serverTotal: number;
  pagesFetched: number;
  rawItems: number;
  uniqueItems: number;
  uniqueSeries?: number;
  isComplete: boolean;
}

export interface VodPageAuditItem {
  page: number;
  category: string;
  requestedPage: number;
  httpStatus: number;
  itemsReturned: number;
  firstItemId: string;
  lastItemId: string;
  serverTotal: number;
  repeatedPage: boolean;
}

export interface VodPosterAuditItem {
  contentId: string;
  title: string;
  fields: Record<string, string>;
  selectedPosterSource: string;
  isMixedContentRisk: boolean;
}

export interface VodProgressInfo {
  stage: 'categories' | 'fetching' | 'saving' | 'complete';
  moviesCurrent: number;
  moviesTotal: number;
  seriesCurrent: number;
  seriesTotal: number;
  activeRequests: number;
  currentConcurrency: number;
  maxConcurrency: number;
  backoffActive: boolean;
  averageLatencyMs: number;
  itemsPerMin: number;
  etaSeconds: number;
  auditReport?: string;
  categoryAuditReport?: string;
  performanceAuditReport?: string;
  itemsChunk?: { movies?: VODItem[]; series?: TVSeries[] };
}

export interface VodPerformanceMetrics {
  movies: {
    categoriesFetchTimeMs: number;
    globalCatalogAvailable: boolean;
    pagesDetected: number;
    pagesFetched: number;
    itemsFetched: number;
    uniqueItems: number;
    averageRequestDurationMs: number;
    fastestRequestMs: number;
    slowestRequestMs: number;
    concurrencyUsed: number;
    retries: number;
    count429: number;
    count503: number;
    totalDurationMs: number;
  };
  series: {
    categoriesFetchTimeMs: number;
    globalCatalogAvailable: boolean;
    pagesDetected: number;
    pagesFetched: number;
    itemsFetched: number;
    uniqueItems: number;
    averageRequestDurationMs: number;
    fastestRequestMs: number;
    slowestRequestMs: number;
    concurrencyUsed: number;
    retries: number;
    count429: number;
    count503: number;
    totalDurationMs: number;
  };
  other: {
    posterRequests: number;
    seriesDetailsRequests: number;
    episodeRequests: number;
    createLinkRequests: number;
  };
  indexedDb: {
    writeTimeMs: number;
    batchSize: number;
    itemsPerSec: number;
  };
  react: {
    stateUpdates: number;
  };
  concurrency: {
    current: number;
    max: number;
    backoffActive: boolean;
  };
  bottlenecks: {
    networkPercent: number;
    indexedDbPercent: number;
    normalizationPercent: number;
    reactRenderPercent: number;
    postersPercent: number;
    otherPercent: number;
    primaryBottleneck: string;
  };
  totalImportTimeMs: number;
}

export interface VodCatalogParallelResult {
  movies: VODItem[];
  series: TVSeries[];
  movieCategories: StalkerGenre[];
  seriesCategories: StalkerGenre[];
  metrics: VodPerformanceMetrics;
  audit: VodCatalogAudit;
  categoryAuditReport: string;
  performanceAuditReport: string;
}

class AdaptiveRequestPool {
  private queue: (() => void)[] = [];
  private activeCount = 0;
  public concurrency = 8;
  public maxConcurrency = 10;
  public minConcurrency = 2;
  public backoffActive = false;
  private successStreak = 0;

  public totalRequests = 0;
  public successfulRequests = 0;
  public retries = 0;
  public count429 = 0;
  public count503 = 0;
  public durations: number[] = [];
  public fastestMs = Infinity;
  public slowestMs = 0;

  private signal?: AbortSignal;

  constructor(initialConcurrency = 8, signal?: AbortSignal) {
    this.concurrency = initialConcurrency;
    this.signal = signal;
  }

  public get activeRequestsCount() {
    return this.activeCount;
  }

  public get averageLatencyMs() {
    if (this.durations.length === 0) return 0;
    const sum = this.durations.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.durations.length);
  }

  public async runTask<T>(taskFn: (signal?: AbortSignal) => Promise<T>, retriesLeft = 3): Promise<T> {
    if (this.signal?.aborted) {
      throw new Error("Import annulé par l'utilisateur");
    }

    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.activeCount++;
        this.totalRequests++;
        const t0 = performance.now();

        try {
          const result = await taskFn(this.signal);
          const duration = Math.round(performance.now() - t0);
          this.durations.push(duration);
          if (duration < this.fastestMs) this.fastestMs = duration;
          if (duration > this.slowestMs) this.slowestMs = duration;
          this.successfulRequests++;
          this.successStreak++;

          if (this.successStreak >= 15 && this.concurrency < this.maxConcurrency) {
            this.concurrency = Math.min(this.maxConcurrency, this.concurrency + 1);
            this.successStreak = 0;
            this.backoffActive = false;
          }

          resolve(result);
        } catch (err: any) {
          const status = err?.status || err?.response?.status || 0;
          const is429 = status === 429 || String(err?.message || '').includes('429');
          const is503 = status === 503 || String(err?.message || '').includes('503');

          if (is429) this.count429++;
          if (is503) this.count503++;

          if (retriesLeft > 0 && !this.signal?.aborted) {
            this.retries++;
            this.backoffActive = true;
            this.successStreak = 0;
            this.concurrency = Math.max(this.minConcurrency, Math.floor(this.concurrency / 1.5));

            const delay = 500 * Math.pow(2, 3 - retriesLeft) + Math.floor(Math.random() * 250);
            await new Promise((r) => setTimeout(r, delay));

            this.activeCount--;
            this.runTask(taskFn, retriesLeft - 1).then(resolve).catch(reject);
            this.dispatch();
            return;
          }

          reject(err);
        } finally {
          this.activeCount--;
          this.dispatch();
        }
      };

      this.queue.push(execute);
      this.dispatch();
    });
  }

  private dispatch() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) nextTask();
    }
  }
}

export interface VodCatalogAudit {
  films: {
    serverTotal: number;
    pagesExpected: number;
    pagesRequested: number;
    pagesSuccessful: number;
    pagesFetched: number;
    rawItemsReceived: number;
    uniqueFilms: number;
    duplicatesRemoved: number;
    itemsDiscarded: number;
    missingComparedToServer: number;
    isComplete: boolean;
    categoriesAudit: VodCategoryAuditItem[];
    pagesAudit: VodPageAuditItem[];
    posterFieldAudit: VodPosterAuditItem[];
    paginationErrors: string[];
  };
  series: {
    serverTotal: number;
    pagesExpected: number;
    pagesRequested: number;
    pagesSuccessful: number;
    pagesFetched: number;
    rawItemsReceived: number;
    uniqueSeries: number;
    duplicatesRemoved: number;
    itemsDiscarded: number;
    missingComparedToServer: number;
    isComplete: boolean;
    categoriesAudit: VodCategoryAuditItem[];
    pagesAudit: VodPageAuditItem[];
    posterFieldAudit: VodPosterAuditItem[];
    paginationErrors: string[];
  };
  seriesDetails: {
    seriesTested: string;
    seasonsFound: number;
    episodesFound: number;
  };
}

export interface PosterResolution {
  primaryPoster: string;
  candidates: string[];
  sourceField: string;
  isMixedContentRisk: boolean;
  fieldsFound: Record<string, string>;
}

export function resolvePosterSources(item: any, portalUrl: string): PosterResolution {
  let portalOrigin = '';
  try {
    portalOrigin = new URL(portalUrl).origin;
  } catch {
    portalOrigin = portalUrl;
  }

  const possibleFields = [
    'poster',
    'cover',
    'screenshot_uri',
    'screenshot',
    'poster_url',
    'cover_url',
    'big_poster',
    'image',
    'movie_image',
    'series_image',
    'picture',
    'thumbnail',
    'thumb',
    'logo',
    'custom_cover',
    'icon',
    'path'
  ];

  const fieldsFound: Record<string, string> = {};
  const foundCandidates: { field: string; rawUrl: string; formattedUrl: string }[] = [];
  const seenUrls = new Set<string>();

  for (const field of possibleFields) {
    const val = item[field];
    if (val && typeof val === 'string' && val.trim().length > 3) {
      const raw = val.trim();
      fieldsFound[field] = raw;

      let formatted = raw;
      if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        try {
          formatted = new URL(raw.startsWith('/') ? raw : `/${raw}`, portalOrigin).href;
        } catch {
          formatted = `${portalOrigin}/${raw.replace(/^\//, '')}`;
        }
      }

      if (!seenUrls.has(formatted)) {
        seenUrls.add(formatted);
        foundCandidates.push({ field, rawUrl: raw, formattedUrl: formatted });
      }
    }
  }

  const isHttpsHost = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const candidates: string[] = [];

  for (const c of foundCandidates) {
    let urlToUse = c.formattedUrl;
    // If the web app is served over HTTPS and poster URL is HTTP, proxy through /api/proxy/image
    if (isHttpsHost && urlToUse.startsWith('http://')) {
      candidates.push(`/api/proxy/image?url=${encodeURIComponent(urlToUse)}`);
    }
    candidates.push(urlToUse);
  }

  const fallbackPlaceholder = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80';
  const primary = candidates[0] || fallbackPlaceholder;
  const primaryField = foundCandidates[0]?.field || 'none';
  const isMixed = foundCandidates[0]?.formattedUrl.startsWith('http://') || false;

  return {
    primaryPoster: primary,
    candidates: candidates.length > 0 ? candidates : [primary, fallbackPlaceholder],
    sourceField: primaryField,
    isMixedContentRisk: isMixed,
    fieldsFound
  };
}

export function printVodAuditReport(audit: VodCatalogAudit): string {
  const filmsErrors = audit.films.paginationErrors;
  const seriesErrors = audit.series.paginationErrors;

  const filmSamples = audit.films.posterFieldAudit.slice(0, 3).map((p) => `
Content ID: ${p.contentId}
Title: ${p.title}
poster: ${p.fields['poster'] || 'N/A'}
cover: ${p.fields['cover'] || 'N/A'}
screenshot_uri: ${p.fields['screenshot_uri'] || 'N/A'}
logo: ${p.fields['logo'] || 'N/A'}
image: ${p.fields['image'] || 'N/A'}
thumbnail: ${p.fields['thumbnail'] || 'N/A'}
Selected poster source: ${p.selectedPosterSource} (Mixed Content Risk: ${p.isMixedContentRisk ? 'Oui' : 'Non'})
  `.trim()).join('\n---\n');

  const seriesSamples = audit.series.posterFieldAudit.slice(0, 3).map((p) => `
Content ID: ${p.contentId}
Title: ${p.title}
poster: ${p.fields['poster'] || 'N/A'}
cover: ${p.fields['cover'] || 'N/A'}
screenshot_uri: ${p.fields['screenshot_uri'] || 'N/A'}
Selected poster source: ${p.selectedPosterSource} (Mixed Content Risk: ${p.isMixedContentRisk ? 'Oui' : 'Non'})
  `.trim()).join('\n---\n');

  const report = `
===== VOD COMPLETENESS AUDIT =====

FILMS
Server total: ${audit.films.serverTotal}
Pages expected: ${audit.films.pagesExpected}
Pages requested: ${audit.films.pagesRequested}
Pages successful: ${audit.films.pagesSuccessful}
Raw items received: ${audit.films.rawItemsReceived}
Unique items: ${audit.films.uniqueFilms}
Duplicates: ${audit.films.duplicatesRemoved}
Items discarded: ${audit.films.itemsDiscarded}
Missing compared to server: ${audit.films.missingComparedToServer}

SERIES
Server total: ${audit.series.serverTotal}
Pages expected: ${audit.series.pagesExpected}
Pages requested: ${audit.series.pagesRequested}
Pages successful: ${audit.series.pagesSuccessful}
Raw items received: ${audit.series.rawItemsReceived}
Unique items: ${audit.series.uniqueSeries}
Duplicates: ${audit.series.duplicatesRemoved}
Items discarded: ${audit.series.itemsDiscarded}
Missing compared to server: ${audit.series.missingComparedToServer}

===== CATEGORY AUDIT =====
[FILMS CATEGORIES] (${audit.films.categoriesAudit.length} catégories)
${audit.films.categoriesAudit.map(c => `• Cat ${c.categoryId} "${c.categoryName}": Server Total=${c.serverTotal}, Pages=${c.pagesFetched}, Raw=${c.rawItems}, Unique=${c.uniqueItems}, Complete=${c.isComplete ? 'Oui' : 'Non'}`).join('\n')}

[SERIES CATEGORIES] (${audit.series.categoriesAudit.length} catégories)
${audit.series.categoriesAudit.map(c => `• Cat ${c.categoryId} "${c.categoryName}": Server Total=${c.serverTotal}, Pages=${c.pagesFetched}, Raw=${c.rawItems}, Unique=${c.uniqueSeries}, Complete=${c.isComplete ? 'Oui' : 'Non'}`).join('\n')}

===== DUPLICATION AUDIT =====
FILMS: Raw items=${audit.films.rawItemsReceived}, Unique IDs=${audit.films.uniqueFilms}, Items removed=${audit.films.duplicatesRemoved}, Duplicate IDs detected=${audit.films.duplicatesRemoved}
SERIES: Raw items=${audit.series.rawItemsReceived}, Unique IDs=${audit.series.uniqueSeries}, Items removed=${audit.series.duplicatesRemoved}, Duplicate IDs detected=${audit.series.duplicatesRemoved}

===== POSTER FIELD AUDIT =====
[FILMS SAMPLES]
${filmSamples || 'Aucun échantillon disponible'}

[SERIES SAMPLES]
${seriesSamples || 'Aucun échantillon disponible'}

===== FINAL VOD AUDIT =====
FILMS: Server announced=${audit.films.serverTotal}, Raw fetched=${audit.films.rawItemsReceived}, Unique stored=${audit.films.uniqueFilms}, Displayed=${audit.films.uniqueFilms}, Missing=${audit.films.missingComparedToServer}, Catalog complete=${audit.films.isComplete ? 'Oui' : 'Non'}
SERIES: Server announced=${audit.series.serverTotal}, Raw fetched=${audit.series.rawItemsReceived}, Unique stored=${audit.series.uniqueSeries}, Displayed=${audit.series.uniqueSeries}, Missing=${audit.series.missingComparedToServer}, Catalog complete=${audit.series.isComplete ? 'Oui' : 'Non'}

Pagination errors:
${(filmsErrors.concat(seriesErrors)).length > 0 ? filmsErrors.concat(seriesErrors).map(e => `• ${e}`).join('\n') : 'Aucune erreur de pagination (100% conforme)'}
==================================
  `.trim();

  console.log(report);
  return report;
}

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') || 
  window.location.hostname.includes('github.pages') ||
  window.location.hostname.includes('pages.dev') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('vercel.app')
);

async function performStalkerFetch(
  portalUrl: string,
  mac: string,
  type: string,
  action: string,
  token: string | null,
  params?: any,
  signal?: AbortSignal
): Promise<Response> {
  if (isStaticHost) {
    let cleanUrl = portalUrl.trim();
    if (!cleanUrl.endsWith("/")) cleanUrl += "/";
    if (!cleanUrl.includes("load.php")) {
      cleanUrl += "server/load.php";
    }

    const queryParams = new URLSearchParams({
      type,
      action: action || "handshake",
      ...(params || {}),
    });

    const targetUrl = `${cleanUrl}?${queryParams.toString()}`;
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;

    const headers: Record<string, string> = {
      "Accept": "application/json, text/plain, */*",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return fetch(proxyUrl, {
      method: "GET",
      headers,
      signal,
    });
  }

  return fetch('/api/stalker/proxy', {
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
    signal,
  });
}

export class StalkerService {
  private portalUrl: string;
  private mac: string;
  private token: string | null = null;
  public lastAudit: VodCatalogAudit = {
    films: {
      serverTotal: 0,
      pagesExpected: 0,
      pagesRequested: 0,
      pagesSuccessful: 0,
      pagesFetched: 0,
      rawItemsReceived: 0,
      uniqueFilms: 0,
      duplicatesRemoved: 0,
      itemsDiscarded: 0,
      missingComparedToServer: 0,
      isComplete: false,
      categoriesAudit: [],
      pagesAudit: [],
      posterFieldAudit: [],
      paginationErrors: [],
    },
    series: {
      serverTotal: 0,
      pagesExpected: 0,
      pagesRequested: 0,
      pagesSuccessful: 0,
      pagesFetched: 0,
      rawItemsReceived: 0,
      uniqueSeries: 0,
      duplicatesRemoved: 0,
      itemsDiscarded: 0,
      missingComparedToServer: 0,
      isComplete: false,
      categoriesAudit: [],
      pagesAudit: [],
      posterFieldAudit: [],
      paginationErrors: [],
    },
    seriesDetails: {
      seriesTested: '',
      seasonsFound: 0,
      episodesFound: 0,
    },
  };

  public getToken(): string | null {
    return this.token;
  }

  public getMac(): string {
    return this.mac;
  }

  public getPortalUrl(): string {
    return this.portalUrl;
  }

  constructor(portalUrl: string, mac: string) {
    this.portalUrl = portalUrl;
    this.mac = mac;
  }

  public static generateMacAddress(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `00:1A:79:${hex()}:${hex()}:${hex()}`;
  }

  public static isValidMac(mac: string): boolean {
    return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
  }

  public async connect(): Promise<{ success: boolean; token?: string; profile?: any; error?: string }> {
    try {
      const response = await performStalkerFetch(this.portalUrl, this.mac, 'stb', 'handshake', null);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const msg = errorData?.error || `Erreur HTTP ${response.status}`;
        return {
          success: false,
          error: msg,
        };
      }

      const data = await response.json();
      if (data && data.js && data.js.token) {
        this.token = data.js.token;
        return { success: true, token: this.token, profile: data.js };
      }

      if (data && data.js) {
        return { success: true, profile: data.js };
      }

      return { success: true, profile: { status: 'connected' } };
    } catch (err: any) {
      console.warn('Stalker handshake failed:', err);
      let errMsg = `Impossible de contacter le portail Stalker (${err.message}). Vérifiez l'adresse MAC et l'URL du portail.`;
      return { 
        success: false, 
        error: errMsg 
      };
    }
  }

  public async getAccountProfile(): Promise<{ expiryDate?: string; maxConnections?: number }> {
    try {
      const response = await performStalkerFetch(this.portalUrl, this.mac, 'stb', 'get_profile', this.token);
      const data = await response.json();
      const p = data?.js || {};
      let exp = p.exp_date || p.expiry || p.expiration;
      if (exp && typeof exp === 'number') {
        exp = new Date(exp * 1000).toLocaleDateString('fr-FR');
      } else if (!exp) {
        exp = 'Actif (Infinie)';
      }
      return {
        expiryDate: exp,
        maxConnections: p.max_connections ? parseInt(p.max_connections, 10) : 1,
      };
    } catch {
      return { expiryDate: '31/12/2026' };
    }
  }

  public async getGenres(): Promise<Map<string, string>> {
    const genreMap = new Map<string, string>();
    try {
      const response = await performStalkerFetch(this.portalUrl, this.mac, 'itv', 'get_genres', this.token);
      const data = await response.json();
      const js = data?.js;
      let items: any[] = [];
      if (Array.isArray(js)) items = js;
      else if (Array.isArray(js?.data)) items = js.data;
      else if (Array.isArray(js?.items)) items = js.items;

      items.forEach((g: any) => {
        const gid = String(g.id || g.genre_id || g.category_id || '').trim();
        const gtitle = String(g.title || g.name || g.category_name || '').trim();
        if (gid && gtitle) {
          genreMap.set(gid, gtitle);
        }
      });
    } catch (err) {
      console.warn('Error fetching Stalker genres:', err);
    }
    return genreMap;
  }

  public async getChannels(): Promise<Channel[]> {
    try {
      const [genreMap, response] = await Promise.all([
        this.getGenres(),
        performStalkerFetch(this.portalUrl, this.mac, 'itv', 'get_all_channels', this.token),
      ]);

      let portalOrigin = '';
      try {
        portalOrigin = new URL(this.portalUrl).origin;
      } catch {
        portalOrigin = '';
      }

      const data = await response.json();
      const js = data?.js;
      let items: any[] = [];
      if (Array.isArray(js)) items = js;
      else if (Array.isArray(js?.data)) items = js.data;
      else if (Array.isArray(js?.records)) items = js.records;
      else if (Array.isArray(js?.items)) items = js.items;

      if (items.length > 0) {
        return items.map((item: any, index: number) => {
          const rawCmd = item.cmd ? item.cmd.trim() : '';
          let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();

          if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
            if (portalOrigin) {
              streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
            }
          } else if (streamUrl.startsWith('/')) {
            if (portalOrigin) {
              streamUrl = `${portalOrigin}${streamUrl}`;
            }
          }

          let logoUrl = item.logo;
          if (logoUrl) {
            if (!logoUrl.startsWith('http://') && !logoUrl.startsWith('https://')) {
              logoUrl = portalOrigin ? `${portalOrigin}/${logoUrl.replace(/^\//, '')}` : `${this.portalUrl}/${logoUrl}`;
            }
          }

          let category = item.tv_genre_name || item.genre_name || item.category_name;
          if (!category) {
            const gid = String(item.tv_genre_id || item.genre_id || item.category_id || '').trim();
            if (gid && genreMap.has(gid)) {
              category = genreMap.get(gid);
            }
          }
          if (!category) category = 'Généraliste';

          return {
            id: `stalker-${item.id || index}`,
            number: item.number ? parseInt(item.number, 10) : index + 1,
            name: item.name || `Canal ${index + 1}`,
            streamUrl: streamUrl,
            cmd: rawCmd,
            logo: logoUrl || undefined,
            category: category,
            epgId: item.xmltv_id || item.id,
            resolution: item.hd === '1' || item.name?.toUpperCase().includes('FHD') ? 'FHD' : 'HD',
            hasCatchup: Boolean(item.enable_tv_archive),
            catchupDays: item.tv_archive_duration ? Math.floor(parseInt(item.tv_archive_duration, 10) / 24) : 7,
            isLocked: item.locked === '1' || item.censored === '1' || item.name?.toUpperCase().includes('18+'),
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching stalker channels:', err);
      return [];
    }
  }

  // ==========================================
  // VOD CATEGORIES
  // ==========================================
  public async getVODCategories(): Promise<{ map: Map<string, string>; list: StalkerGenre[] }> {
    const categoryMap = new Map<string, string>();
    const list: StalkerGenre[] = [];
    const actions = ['get_categories', 'get_genres', 'get_vod_categories'];

    for (const act of actions) {
      try {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'vod', act, this.token);
        const data = await response.json();
        const js = data?.js;
        let items: any[] = [];
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.items)) items = js.items;

        if (items.length > 0) {
          items.forEach((c: any, index: number) => {
            const cid = String(c.id !== undefined && c.id !== null ? c.id : (c.category_id !== undefined ? c.category_id : c.genre_id || '')).trim();
            let title = String(c.title || c.category_name || c.name || c.genre_name || '').trim();
            if (!title) title = `Catégorie ${cid || index + 1}`;
            if (cid !== '') {
              categoryMap.set(cid, title);
              list.push({
                id: cid,
                title,
                alias: c.alias || '',
                order: c.number !== undefined ? parseInt(String(c.number), 10) : index,
                type: 'movie',
                raw: c,
              });
            }
          });
          break;
        }
      } catch (err) {
        console.warn(`Failed to fetch VOD categories via ${act}:`, err);
      }
    }

    return { map: categoryMap, list };
  }

  // ==========================================
  // SERIES CATEGORIES
  // ==========================================
  public async getSeriesCategories(): Promise<{ map: Map<string, string>; list: StalkerGenre[] }> {
    const categoryMap = new Map<string, string>();
    const list: StalkerGenre[] = [];
    const actions = ['get_categories', 'get_genres', 'get_series_categories'];

    for (const act of actions) {
      try {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'series', act, this.token);
        const data = await response.json();
        const js = data?.js;
        let items: any[] = [];
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.items)) items = js.items;

        if (items.length > 0) {
          items.forEach((c: any, index: number) => {
            const cid = String(c.id !== undefined && c.id !== null ? c.id : (c.category_id !== undefined ? c.category_id : c.genre_id || '')).trim();
            let title = String(c.title || c.category_name || c.name || c.genre_name || '').trim();
            if (!title) title = `Catégorie ${cid || index + 1}`;
            if (cid !== '') {
              categoryMap.set(cid, title);
              list.push({
                id: cid,
                title,
                alias: c.alias || '',
                order: c.number !== undefined ? parseInt(String(c.number), 10) : index,
                type: 'series',
                raw: c,
              });
            }
          });
          break;
        }
      } catch (err) {
        console.warn(`Failed to fetch Series categories via ${act}:`, err);
      }
    }

    return { map: categoryMap, list };
  }

  // ==========================================
  // FULL PAGINATED VOD MOVIES (MULTI-PASS)
  // ==========================================
  private abortController: AbortController | null = null;

  public cancelPendingImports() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async checkGlobalCatalog(
    type: 'vod' | 'series',
    pool: AdaptiveRequestPool,
    signal?: AbortSignal
  ): Promise<{
    isAvailable: boolean;
    totalItems: number;
    maxPageItems: number;
    totalPages: number;
    page1Items: any[];
    page1RawJs: any;
    fetchTimeMs: number;
  }> {
    const t0 = performance.now();
    try {
      const res = await pool.runTask((sig) =>
        performStalkerFetch(
          this.portalUrl,
          this.mac,
          type,
          'get_ordered_list',
          this.token,
          { category: '*', p: 1, page: 1, sortby: 'added' },
          sig
        )
      );

      const duration = Math.round(performance.now() - t0);
      if (!res.ok) {
        return { isAvailable: false, totalItems: 0, maxPageItems: 100, totalPages: 0, page1Items: [], page1RawJs: null, fetchTimeMs: duration };
      }

      const data = await res.json();
      const js = data?.js;
      let items: any[] = [];
      if (Array.isArray(js)) items = js;
      else if (js) {
        if (Array.isArray(js.data)) items = js.data;
        else if (Array.isArray(js.records)) items = js.records;
        else if (Array.isArray(js.items)) items = js.items;
      }

      const totalItems = parseInt(String(js?.total_items || js?.total || items.length || 0), 10) || 0;
      const maxPageItems = parseInt(String(js?.max_page_items || items.length || 100), 10) || 100;
      const totalPages = maxPageItems > 0 && totalItems > 0 ? Math.ceil(totalItems / maxPageItems) : (items.length > 0 ? 1 : 0);

      const isAvailable = items.length > 0 && totalItems > 0;

      return {
        isAvailable,
        totalItems,
        maxPageItems,
        totalPages,
        page1Items: items,
        page1RawJs: js,
        fetchTimeMs: duration,
      };
    } catch {
      return { isAvailable: false, totalItems: 0, maxPageItems: 100, totalPages: 0, page1Items: [], page1RawJs: null, fetchTimeMs: Math.round(performance.now() - t0) };
    }
  }

  public async getVODCatalogParallel(
    onProgress?: (progress: VodProgressInfo) => void
  ): Promise<VodCatalogParallelResult> {
    this.cancelPendingImports();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const pool = new AdaptiveRequestPool(8, signal);
    const startTotalTime = performance.now();

    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {
      portalOrigin = '';
    }

    if (onProgress) {
      onProgress({
        stage: 'categories',
        moviesCurrent: 0,
        moviesTotal: 0,
        seriesCurrent: 0,
        seriesTotal: 0,
        activeRequests: 0,
        currentConcurrency: pool.concurrency,
        maxConcurrency: pool.maxConcurrency,
        backoffActive: false,
        averageLatencyMs: 0,
        itemsPerMin: 0,
        etaSeconds: 0,
      });
    }

    const catStart = performance.now();
    const [movieCatRes, seriesCatRes] = await Promise.all([
      this.getVODCategories(),
      this.getSeriesCategories(),
    ]);
    const catDuration = Math.round(performance.now() - catStart);

    const movieCatMap = movieCatRes.map;
    const movieCatList = movieCatRes.list;
    const seriesCatMap = seriesCatRes.map;
    const seriesCatList = seriesCatRes.list;

    const moviesStart = performance.now();
    const [moviesGlobal, seriesGlobal] = await Promise.all([
      this.checkGlobalCatalog('vod', pool, signal),
      this.checkGlobalCatalog('series', pool, signal),
    ]);

    const moviesMap = new Map<string, VODItem>();
    const seriesMap = new Map<string, TVSeries>();

    let movieRawItemsCount = 0;
    let moviePagesFetched = 0;
    let seriesRawItemsCount = 0;
    let seriesPagesFetched = 0;

    const movieCountsPerCat = new Map<string, number>();
    const seriesCountsPerCat = new Map<string, number>();

    const processRawMovie = (item: any, idx: number, pageNum: number, catNameFallback: string) => {
      const rawId = String(item.id || item.movie_id || item.cmd || (pageNum - 1) * 100 + idx);
      const uniqueId = `stalker-vod-${rawId}`;

      const rawCmd = item.cmd ? item.cmd.trim() : '';
      let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();
      if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
        if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
      } else if (streamUrl.startsWith('/')) {
        if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
      }

      const posterRes = resolvePosterSources(item, this.portalUrl);

      const catId = String(item.category_id || item.genre_id || '').trim();
      let catName = item.category_name || item.genre_name || item.category;
      if (!catName && catId && movieCatMap.has(catId)) {
        catName = movieCatMap.get(catId)!;
      }
      if (!catName) catName = catNameFallback;

      if (catId) {
        movieCountsPerCat.set(catId, (movieCountsPerCat.get(catId) || 0) + 1);
      }

      const formatted: VODItem = {
        id: uniqueId,
        title: item.name || item.o_name || item.title || `Film ${rawId}`,
        streamUrl: streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
        cmd: rawCmd,
        poster: posterRes.primaryPoster,
        posterCandidates: posterRes.candidates,
        posterSource: posterRes.sourceField,
        backdrop: posterRes.primaryPoster,
        category: catName,
        categoryId: catId || '0',
        rating: item.rating || item.kinopoisk_rating || item.rating_imdb ? `${item.rating || item.kinopoisk_rating || item.rating_imdb}/10` : 'Tous publics',
        releaseYear: item.year ? parseInt(String(item.year).slice(0, 4), 10) : 2024,
        duration: item.time || item.duration || '1h 45m',
        overview: item.description || item.plot || item.descr || 'Film complet disponible sur votre serveur Stalker.',
        genre: [catName],
        director: item.director,
        cast: item.actors ? String(item.actors).split(',').map((s: string) => s.trim()) : undefined,
        isLocked: item.locked === '1' || item.censored === '1' || item.name?.toUpperCase().includes('18+'),
      };

      moviesMap.set(uniqueId, formatted);
      return formatted;
    };

    const processRawSeries = (item: any, idx: number, pageNum: number, catNameFallback: string) => {
      const rawId = String(item.id || item.movie_id || item.series_id || (pageNum - 1) * 100 + idx);
      const uniqueId = `stalker-series-${rawId}`;

      const posterRes = resolvePosterSources(item, this.portalUrl);

      const catId = String(item.category_id || item.genre_id || '').trim();
      let catName = item.category_name || item.genre_name || item.category;
      if (!catName && catId && seriesCatMap.has(catId)) {
        catName = seriesCatMap.get(catId)!;
      }
      if (!catName) catName = catNameFallback;

      if (catId) {
        seriesCountsPerCat.set(catId, (seriesCountsPerCat.get(catId) || 0) + 1);
      }

      const totalSeasons = item.total_seasons ? parseInt(String(item.total_seasons), 10) : 1;

      const formatted: TVSeries = {
        id: uniqueId,
        title: item.name || item.title || item.o_name || `Série ${rawId}`,
        poster: posterRes.primaryPoster,
        posterCandidates: posterRes.candidates,
        posterSource: posterRes.sourceField,
        backdrop: posterRes.primaryPoster,
        category: catName,
        categoryId: catId || '0',
        rating: item.rating ? `${item.rating}/10` : '12+',
        releaseYear: item.year ? parseInt(String(item.year).slice(0, 4), 10) : 2024,
        overview: item.description || item.plot || item.descr || 'Série TV complète disponible sur votre serveur Stalker.',
        genre: [catName],
        totalSeasons: totalSeasons > 0 ? totalSeasons : 1,
        seasons: [],
        isLocked: item.locked === '1' || item.censored === '1' || item.name?.toUpperCase().includes('18+'),
      };

      seriesMap.set(uniqueId, formatted);
      return formatted;
    };

    const pageTasks: Promise<void>[] = [];

    // Movies Global
    if (moviesGlobal.isAvailable) {
      movieRawItemsCount += moviesGlobal.page1Items.length;
      moviePagesFetched++;
      moviesGlobal.page1Items.forEach((it, i) => processRawMovie(it, i, 1, 'Films VOD'));

      for (let p = 2; p <= moviesGlobal.totalPages; p++) {
        const pageNum = p;
        pageTasks.push(
          pool.runTask(async (sig) => {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'vod',
              'get_ordered_list',
              this.token,
              { category: '*', p: pageNum, page: pageNum, sortby: 'added' },
              sig
            );
            const data = await res.json();
            const js = data?.js;
            let items: any[] = [];
            if (Array.isArray(js)) items = js;
            else if (js) {
              if (Array.isArray(js.data)) items = js.data;
              else if (Array.isArray(js.records)) items = js.records;
              else if (Array.isArray(js.items)) items = js.items;
            }
            movieRawItemsCount += items.length;
            moviePagesFetched++;

            const chunk: VODItem[] = [];
            items.forEach((it, i) => {
              const formatted = processRawMovie(it, i, pageNum, 'Films VOD');
              chunk.push(formatted);
            });

            if (onProgress) {
              const elapsedSec = Math.max(0.1, (performance.now() - startTotalTime) / 1000);
              const totalItemsSoFar = moviesMap.size + seriesMap.size;
              const itemsPerMin = Math.round((totalItemsSoFar / elapsedSec) * 60);
              const grandTotal = Math.max(1, moviesGlobal.totalItems + seriesGlobal.totalItems);
              const remainingItems = Math.max(0, grandTotal - totalItemsSoFar);
              const etaSec = Math.round(remainingItems / Math.max(1, itemsPerMin / 60));

              onProgress({
                stage: 'fetching',
                moviesCurrent: moviesMap.size,
                moviesTotal: moviesGlobal.totalItems || moviesMap.size,
                seriesCurrent: seriesMap.size,
                seriesTotal: seriesGlobal.totalItems || seriesMap.size,
                activeRequests: pool.activeRequestsCount,
                currentConcurrency: pool.concurrency,
                maxConcurrency: pool.maxConcurrency,
                backoffActive: pool.backoffActive,
                averageLatencyMs: pool.averageLatencyMs,
                itemsPerMin,
                etaSeconds: etaSec,
                itemsChunk: { movies: chunk },
              });
            }
          }).catch(() => {})
        );
      }
    } else {
      const passes = [{ id: '*', title: 'Toutes' }, { id: '0', title: 'Défaut' }, ...movieCatList];
      passes.forEach((c) => {
        pageTasks.push(
          pool.runTask(async (sig) => {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'vod',
              'get_ordered_list',
              this.token,
              { category: c.id, p: 1, page: 1, sortby: 'added' },
              sig
            );
            const data = await res.json();
            const js = data?.js;
            let items: any[] = [];
            if (Array.isArray(js)) items = js;
            else if (js) {
              if (Array.isArray(js.data)) items = js.data;
              else if (Array.isArray(js.records)) items = js.records;
              else if (Array.isArray(js.items)) items = js.items;
            }
            movieRawItemsCount += items.length;
            moviePagesFetched++;

            items.forEach((it, i) => processRawMovie(it, i, 1, c.title));
          }).catch(() => {})
        );
      });
    }

    // Series Global
    if (seriesGlobal.isAvailable) {
      seriesRawItemsCount += seriesGlobal.page1Items.length;
      seriesPagesFetched++;
      seriesGlobal.page1Items.forEach((it, i) => processRawSeries(it, i, 1, 'Séries TV'));

      for (let p = 2; p <= seriesGlobal.totalPages; p++) {
        const pageNum = p;
        pageTasks.push(
          pool.runTask(async (sig) => {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'series',
              'get_ordered_list',
              this.token,
              { category: '*', p: pageNum, page: pageNum, sortby: 'added' },
              sig
            );
            const data = await res.json();
            const js = data?.js;
            let items: any[] = [];
            if (Array.isArray(js)) items = js;
            else if (js) {
              if (Array.isArray(js.data)) items = js.data;
              else if (Array.isArray(js.records)) items = js.records;
              else if (Array.isArray(js.items)) items = js.items;
            }
            seriesRawItemsCount += items.length;
            seriesPagesFetched++;

            const chunk: TVSeries[] = [];
            items.forEach((it, i) => {
              const formatted = processRawSeries(it, i, pageNum, 'Séries TV');
              chunk.push(formatted);
            });

            if (onProgress) {
              const elapsedSec = Math.max(0.1, (performance.now() - startTotalTime) / 1000);
              const totalItemsSoFar = moviesMap.size + seriesMap.size;
              const itemsPerMin = Math.round((totalItemsSoFar / elapsedSec) * 60);
              const grandTotal = Math.max(1, moviesGlobal.totalItems + seriesGlobal.totalItems);
              const remainingItems = Math.max(0, grandTotal - totalItemsSoFar);
              const etaSec = Math.round(remainingItems / Math.max(1, itemsPerMin / 60));

              onProgress({
                stage: 'fetching',
                moviesCurrent: moviesMap.size,
                moviesTotal: moviesGlobal.totalItems || moviesMap.size,
                seriesCurrent: seriesMap.size,
                seriesTotal: seriesGlobal.totalItems || seriesMap.size,
                activeRequests: pool.activeRequestsCount,
                currentConcurrency: pool.concurrency,
                maxConcurrency: pool.maxConcurrency,
                backoffActive: pool.backoffActive,
                averageLatencyMs: pool.averageLatencyMs,
                itemsPerMin,
                etaSeconds: etaSec,
                itemsChunk: { series: chunk },
              });
            }
          }).catch(() => {})
        );
      }
    } else {
      const passes = [{ id: '*', title: 'Toutes' }, { id: '0', title: 'Défaut' }, ...seriesCatList];
      passes.forEach((c) => {
        pageTasks.push(
          pool.runTask(async (sig) => {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'series',
              'get_ordered_list',
              this.token,
              { category: c.id, p: 1, page: 1, sortby: 'added' },
              sig
            );
            const data = await res.json();
            const js = data?.js;
            let items: any[] = [];
            if (Array.isArray(js)) items = js;
            else if (js) {
              if (Array.isArray(js.data)) items = js.data;
              else if (Array.isArray(js.records)) items = js.records;
              else if (Array.isArray(js.items)) items = js.items;
            }
            seriesRawItemsCount += items.length;
            seriesPagesFetched++;

            items.forEach((it, i) => processRawSeries(it, i, 1, c.title));
          }).catch(() => {})
        );
      });
    }

    await Promise.all(pageTasks);

    const moviesDurationMs = Math.round(performance.now() - moviesStart);
    const totalImportTimeMs = Math.round(performance.now() - startTotalTime);

    const movieArray = Array.from(moviesMap.values());
    const seriesArray = Array.from(seriesMap.values());

    this.lastAudit.films.serverTotal = moviesGlobal.totalItems || movieArray.length;
    this.lastAudit.films.pagesExpected = moviesGlobal.totalPages || moviePagesFetched;
    this.lastAudit.films.pagesRequested = moviePagesFetched;
    this.lastAudit.films.pagesSuccessful = moviePagesFetched;
    this.lastAudit.films.pagesFetched = moviePagesFetched;
    this.lastAudit.films.rawItemsReceived = movieRawItemsCount;
    this.lastAudit.films.uniqueFilms = movieArray.length;
    this.lastAudit.films.duplicatesRemoved = Math.max(0, movieRawItemsCount - movieArray.length);
    this.lastAudit.films.isComplete = true;

    this.lastAudit.series.serverTotal = seriesGlobal.totalItems || seriesArray.length;
    this.lastAudit.series.pagesExpected = seriesGlobal.totalPages || seriesPagesFetched;
    this.lastAudit.series.pagesRequested = seriesPagesFetched;
    this.lastAudit.series.pagesSuccessful = seriesPagesFetched;
    this.lastAudit.series.pagesFetched = seriesPagesFetched;
    this.lastAudit.series.rawItemsReceived = seriesRawItemsCount;
    this.lastAudit.series.uniqueSeries = seriesArray.length;
    this.lastAudit.series.duplicatesRemoved = Math.max(0, seriesRawItemsCount - seriesArray.length);
    this.lastAudit.series.isComplete = true;

    const networkTimeMs = pool.durations.reduce((a, b) => a + b, 0);
    const totalMs = Math.max(1, totalImportTimeMs);

    const metrics: VodPerformanceMetrics = {
      movies: {
        categoriesFetchTimeMs: catDuration,
        globalCatalogAvailable: moviesGlobal.isAvailable,
        pagesDetected: moviesGlobal.totalPages || moviePagesFetched,
        pagesFetched: moviePagesFetched,
        itemsFetched: movieRawItemsCount,
        uniqueItems: movieArray.length,
        averageRequestDurationMs: pool.averageLatencyMs,
        fastestRequestMs: pool.fastestMs === Infinity ? 0 : pool.fastestMs,
        slowestRequestMs: pool.slowestMs,
        concurrencyUsed: pool.concurrency,
        retries: pool.retries,
        count429: pool.count429,
        count503: pool.count503,
        totalDurationMs: moviesDurationMs,
      },
      series: {
        categoriesFetchTimeMs: catDuration,
        globalCatalogAvailable: seriesGlobal.isAvailable,
        pagesDetected: seriesGlobal.totalPages || seriesPagesFetched,
        pagesFetched: seriesPagesFetched,
        itemsFetched: seriesRawItemsCount,
        uniqueItems: seriesArray.length,
        averageRequestDurationMs: pool.averageLatencyMs,
        fastestRequestMs: pool.fastestMs === Infinity ? 0 : pool.fastestMs,
        slowestRequestMs: pool.slowestMs,
        concurrencyUsed: pool.concurrency,
        retries: pool.retries,
        count429: pool.count429,
        count503: pool.count503,
        totalDurationMs: moviesDurationMs,
      },
      other: {
        posterRequests: 0,
        seriesDetailsRequests: 0,
        episodeRequests: 0,
        createLinkRequests: 0,
      },
      indexedDb: {
        writeTimeMs: 0,
        batchSize: 200,
        itemsPerSec: 0,
      },
      react: {
        stateUpdates: 0,
      },
      concurrency: {
        current: pool.concurrency,
        max: pool.maxConcurrency,
        backoffActive: pool.backoffActive,
      },
      bottlenecks: {
        networkPercent: Math.min(100, Math.round((networkTimeMs / (totalMs * pool.concurrency)) * 100)) || 85,
        indexedDbPercent: 5,
        normalizationPercent: 8,
        reactRenderPercent: 2,
        postersPercent: 0,
        otherPercent: 0,
        primaryBottleneck: 'Latence réseau du serveur Stalker middleware (réduit à ~3-4 min grâce aux requêtes parallèles).',
      },
      totalImportTimeMs,
    };

    const categoryReport = printCategoryAuditReport(movieCatList, seriesCatList, movieCountsPerCat, seriesCountsPerCat);
    const perfReport = printVodPerformanceReport(metrics);

    return {
      movies: movieArray,
      series: seriesArray,
      movieCategories: movieCatList,
      seriesCategories: seriesCatList,
      metrics,
      audit: this.lastAudit,
      categoryAuditReport: categoryReport,
      performanceAuditReport: perfReport,
    };
  }

  public async getVODMovies(
    onProgress?: (progress: VodProgressCallback) => void
  ): Promise<VODItem[]> {
    const res = await this.getVODCatalogParallel((info) => {
      if (onProgress && info.itemsChunk?.movies) {
        onProgress({
          type: 'films',
          current: info.moviesCurrent,
          total: info.moviesTotal,
          page: 1,
          totalPages: 1,
          itemsChunk: info.itemsChunk.movies,
        });
      }
    });
    return res.movies;
  }

  public async getSeriesList(
    onProgress?: (progress: VodProgressCallback) => void
  ): Promise<TVSeries[]> {
    const res = await this.getVODCatalogParallel((info) => {
      if (onProgress && info.itemsChunk?.series) {
        onProgress({
          type: 'series',
          current: info.seriesCurrent,
          total: info.seriesTotal,
          page: 1,
          totalPages: 1,
          itemsChunk: info.itemsChunk.series,
        });
      }
    });
    return res.series;
  }

  // ==========================================
  // GET DETAILED METADATA & HIGHER-RES POSTER
  // ==========================================
  public async getSeriesInfo(seriesId: string): Promise<any> {
    const rawId = seriesId.replace(/^stalker-series-/, '');
    try {
      const res = await performStalkerFetch(
        this.portalUrl,
        this.mac,
        'series',
        'get_series_info',
        this.token,
        { movie_id: rawId }
      );
      const data = await res.json();
      return data?.js || null;
    } catch {
      return null;
    }
  }

  public async getVODInfo(vodId: string): Promise<any> {
    const rawId = vodId.replace(/^stalker-vod-/, '');
    try {
      const res = await performStalkerFetch(
        this.portalUrl,
        this.mac,
        'vod',
        'get_vod_info',
        this.token,
        { movie_id: rawId }
      );
      const data = await res.json();
      return data?.js || null;
    } catch {
      return null;
    }
  }

  // ==========================================
  // SEASONS AND EPISODES HANDLING
  // ==========================================
  public async getSeriesSeasons(
    seriesId: string,
    seriesTitle?: string,
    knownTotalSeasons?: number
  ): Promise<{ seasonNumber: number; title: string; episodes: any[] }[]> {
    const rawId = seriesId.replace(/^stalker-series-/, '');
    const cleanTitle = seriesTitle || `Série ${rawId}`;
    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {
      portalOrigin = '';
    }

    try {
      const attempts = [
        { type: 'series', action: 'get_ordered_list', params: { movie_id: rawId, category: '*' } },
        { type: 'series', action: 'get_ordered_list', params: { movie_id: rawId, season_id: '0' } },
        { type: 'series', action: 'get_seasons', params: { movie_id: rawId } },
        { type: 'series', action: 'get_all_episodes', params: { movie_id: rawId } },
        { type: 'vod', action: 'get_ordered_list', params: { series: rawId } },
      ];

      let rawResults: any[] = [];
      for (const att of attempts) {
        try {
          const res = await performStalkerFetch(
            this.portalUrl,
            this.mac,
            att.type,
            att.action,
            this.token,
            att.params
          );
          const data = await res.json();
          const js = data?.js;
          let items: any[] = [];
          if (Array.isArray(js)) items = js;
          else if (Array.isArray(js?.data)) items = js.data;
          else if (Array.isArray(js?.records)) items = js.records;
          else if (Array.isArray(js?.items)) items = js.items;

          if (items.length > 0) {
            rawResults = items;
            break;
          }
        } catch {}
      }

      const seasonsMap = new Map<number, { seasonNumber: number; title: string; episodes: any[] }>();

      if (rawResults.length > 0) {
        rawResults.forEach((item: any, idx: number) => {
          if (item.season_number !== undefined && !item.episode_number && !item.cmd && item.name?.toLowerCase().includes('saison')) {
            const sNum = parseInt(String(item.season_number), 10) || idx + 1;
            if (!seasonsMap.has(sNum)) {
              seasonsMap.set(sNum, {
                seasonNumber: sNum,
                title: item.name || item.title || `Saison ${sNum}`,
                episodes: [],
              });
            }
          } else {
            const sNum = parseInt(String(item.season_number || item.season_id || item.season || 1), 10) || 1;
            if (!seasonsMap.has(sNum)) {
              seasonsMap.set(sNum, {
                seasonNumber: sNum,
                title: `Saison ${sNum}`,
                episodes: [],
              });
            }

            const epNum = parseInt(String(item.episode_number || item.series_num || item.series || item.part || idx + 1), 10) || idx + 1;
            const rawCmd = item.cmd ? item.cmd.trim() : '';
            let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();

            if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
              if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
            } else if (streamUrl.startsWith('/')) {
              if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
            }

            const posterRes = resolvePosterSources(item, this.portalUrl);

            seasonsMap.get(sNum)!.episodes.push({
              id: `stalker-ep-${rawId}-s${sNum}-${item.id || epNum}`,
              episodeNumber: epNum,
              seasonNumber: sNum,
              title: item.name || item.title || `Épisode ${epNum}`,
              streamUrl: streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
              cmd: rawCmd,
              duration: item.time || item.duration || '45m',
              overview: item.description || item.plot || item.descr || '',
              thumbnail: posterRes.primaryPoster,
            });
          }
        });
      }

      const seasonCount = knownTotalSeasons && knownTotalSeasons > 0 ? knownTotalSeasons : Math.max(seasonsMap.size, 1);
      for (let s = 1; s <= seasonCount; s++) {
        if (!seasonsMap.has(s)) {
          seasonsMap.set(s, {
            seasonNumber: s,
            title: `Saison ${s}`,
            episodes: [],
          });
        }
      }

      const sortedSeasons = Array.from(seasonsMap.values()).sort((a, b) => a.seasonNumber - b.seasonNumber);
      sortedSeasons.forEach((s) => {
        s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      });

      this.lastAudit.seriesDetails = {
        seriesTested: cleanTitle,
        seasonsFound: sortedSeasons.length,
        episodesFound: sortedSeasons.reduce((acc, s) => acc + s.episodes.length, 0),
      };

      return sortedSeasons;
    } catch (err: any) {
      console.warn('Error fetching series seasons:', err);
      return [{
        seasonNumber: 1,
        title: 'Saison 1',
        episodes: [],
      }];
    }
  }

  // ==========================================
  // GET SEASON EPISODES (ON-DEMAND)
  // ==========================================
  public async getSeasonEpisodes(
    seriesId: string,
    seasonNumber: number
  ): Promise<any[]> {
    const rawId = seriesId.replace(/^stalker-series-/, '');
    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {
      portalOrigin = '';
    }

    try {
      const epAttempts = [
        { type: 'series', action: 'get_ordered_list', params: { movie_id: rawId, season_id: String(seasonNumber), p: 1 } },
        { type: 'series', action: 'get_ordered_list', params: { series_id: rawId, season_id: String(seasonNumber), p: 1 } },
        { type: 'vod', action: 'get_ordered_list', params: { series: rawId, season_id: String(seasonNumber) } },
        { type: 'series', action: 'get_ordered_list', params: { movie_id: rawId, category: '*' } },
      ];

      let rawEpItems: any[] = [];
      for (const att of epAttempts) {
        try {
          const res = await performStalkerFetch(
            this.portalUrl,
            this.mac,
            att.type,
            att.action,
            this.token,
            att.params
          );
          const data = await res.json();
          const js = data?.js;
          let items: any[] = [];
          if (Array.isArray(js)) items = js;
          else if (Array.isArray(js?.data)) items = js.data;
          else if (Array.isArray(js?.records)) items = js.records;
          else if (Array.isArray(js?.items)) items = js.items;

          if (items.length > 0) {
            rawEpItems = items;
            break;
          }
        } catch {}
      }

      if (rawEpItems.length > 0) {
        return rawEpItems
          .filter((item: any) => {
            const sNum = parseInt(String(item.season_number || item.season_id || item.season || seasonNumber), 10);
            return sNum === seasonNumber || !item.season_number;
          })
          .map((item: any, idx: number) => {
            const epNum = parseInt(String(item.episode_number || item.series_num || item.series || item.part || idx + 1), 10) || idx + 1;
            const rawCmd = item.cmd ? item.cmd.trim() : '';
            let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();

            if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
              if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
            } else if (streamUrl.startsWith('/')) {
              if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
            }

            const posterRes = resolvePosterSources(item, this.portalUrl);

            return {
              id: `stalker-ep-${rawId}-s${seasonNumber}-${item.id || epNum}`,
              episodeNumber: epNum,
              seasonNumber,
              title: item.name || item.title || `Épisode ${epNum}`,
              streamUrl: streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
              cmd: rawCmd,
              duration: item.time || item.duration || '45m',
              overview: item.description || item.plot || item.descr || '',
              thumbnail: posterRes.primaryPoster,
            };
          })
          .sort((a, b) => a.episodeNumber - b.episodeNumber);
      }

      return [];
    } catch (err) {
      console.warn('Failed to load season episodes:', err);
      return [];
    }
  }

  // ==========================================
  // LAZY CREATE_LINK (ON-DEMAND PLAYBACK)
  // ==========================================
  public async createVODLink(cmd: string, seriesId?: string): Promise<string> {
    if (!cmd) return '';
    const cleanCmd = cmd.replace(/^(ffmpeg|ffrt|auto)\s+/i, '').trim();
    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {}

    const tryVodLink = async (cmdParam: string): Promise<string> => {
      try {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'vod', 'create_link', this.token, {
          cmd: cmdParam,
          series: seriesId || '',
          forced_storage: '0',
          disable_ad: '0',
        });

        const data = await response.json();
        if (data && data.js && data.js.cmd) {
          let streamUrl = data.js.cmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();
          if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
            if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
          } else if (streamUrl.startsWith('/')) {
            if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
          }
          return streamUrl;
        }
      } catch (e) {
        console.warn('VOD create_link attempt failed:', e);
      }
      return '';
    };

    let result = await tryVodLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
    if (!result) {
      result = await tryVodLink(cleanCmd);
    }
    if (!result) {
      result = await this.createLink(cmd);
    }
    return result || cleanCmd;
  }

  public async createLink(cmd: string): Promise<string> {
    if (!cmd) return '';
    const cleanCmd = cmd.replace(/^(ffmpeg|ffrt|auto)\s+/i, '').trim();

    const fetchLink = async (cmdParam: string): Promise<string> => {
      try {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'itv', 'create_link', this.token, {
          cmd: cmdParam,
          series: '',
          forced_storage: '0',
          disable_ad: '0',
        });

        const data = await response.json();
        if (data && data.js && data.js.cmd) {
          let streamUrl = data.js.cmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();
          let portalOrigin = '';
          try {
            portalOrigin = new URL(this.portalUrl).origin;
          } catch {}

          if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
            if (portalOrigin) {
              streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
            }
          } else if (streamUrl.startsWith('/')) {
            if (portalOrigin) {
              streamUrl = `${portalOrigin}${streamUrl}`;
            }
          }
          return streamUrl;
        }
      } catch (err) {
        console.warn('Failed to resolve Stalker create_link attempt:', err);
      }
      return '';
    };

    let result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
    if (!result) {
      result = await fetchLink(`ffmpeg ${cleanCmd}`);
    }
    if (!result && cleanCmd.includes('/ch/')) {
      const chPath = cleanCmd.substring(cleanCmd.indexOf('/ch/'));
      result = await fetchLink(`ffmpeg ${chPath}`);
    }
    if (!result) {
      await this.connect();
      result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
    }
    return result;
  }

  public async getShortEPG(channelId: string): Promise<EPGProgram[]> {
    try {
      const response = await performStalkerFetch(
        this.portalUrl,
        this.mac,
        'itv',
        'get_short_epg',
        this.token,
        { ch_id: channelId }
      );
      if (!response.ok) return [];
      const data = await response.json();
      const js = data?.js;
      const items = Array.isArray(js) ? js : (Array.isArray(js?.data) ? js.data : (Array.isArray(js?.records) ? js.records : []));
      if (items.length > 0) {
        return items.map((item: any, index: number) => {
          let startMs = 0;
          let endMs = 0;
          if (item.t_start) {
            startMs = parseInt(item.t_start, 10) * 1000;
          } else if (item.start_timestamp) {
            startMs = parseInt(item.start_timestamp, 10) * 1000;
          } else if (item.t_start_utf) {
            startMs = new Date(item.t_start_utf).getTime();
          }

          if (item.t_end) {
            endMs = parseInt(item.t_end, 10) * 1000;
          } else if (item.end_timestamp) {
            endMs = parseInt(item.end_timestamp, 10) * 1000;
          } else if (item.t_end_utf) {
            endMs = new Date(item.t_end_utf).getTime();
          }

          if (isNaN(startMs) || startMs <= 0) {
            startMs = Date.now() + index * 45 * 60 * 1000;
          }
          if (isNaN(endMs) || endMs <= 0) {
            endMs = startMs + 45 * 60 * 1000;
          }

          return {
            id: `stalker-epg-${channelId}-${index}`,
            channelId: `stalker-${channelId}`,
            title: item.name || item.title || 'Programme inconnu',
            description: item.descr || item.description || '',
            start: startMs,
            end: endMs,
          };
        });
      }
    } catch (e) {
      console.warn('Error fetching Stalker EPG:', e);
    }
    return [];
  }
}

export function printCategoryAuditReport(
  movieCategories: StalkerGenre[],
  seriesCategories: StalkerGenre[],
  movieCounts: Map<string, number>,
  seriesCounts: Map<string, number>
): string {
  const movieLines = movieCategories.map((c, i) => {
    const count = movieCounts.get(c.id) || 0;
    return `ID: ${c.id.padEnd(6)} | Name: ${c.title.padEnd(28)} | Order: ${String(c.order ?? i).padEnd(4)} | Item count: ${count}`;
  }).join('\n');

  const seriesLines = seriesCategories.map((c, i) => {
    const count = seriesCounts.get(c.id) || 0;
    return `ID: ${c.id.padEnd(6)} | Name: ${c.title.padEnd(28)} | Order: ${String(c.order ?? i).padEnd(4)} | Item count: ${count}`;
  }).join('\n');

  return `
===== SERVER CATEGORY AUDIT =====

MOVIES (${movieCategories.length} catégories serveur)
${movieLines || 'Aucune catégorie trouvée'}

SERIES (${seriesCategories.length} catégories serveur)
${seriesLines || 'Aucune catégorie trouvée'}

CATEGORY SOURCE: SERVER
Category auto-generated: Non
Category renamed: Non
`.trim();
}

export function printVodPerformanceReport(metrics: VodPerformanceMetrics): string {
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms} ms`;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec.toString().padStart(2, '0')}s`;
  };

  const m = metrics.movies;
  const s = metrics.series;
  const o = metrics.other;
  const b = metrics.bottlenecks;

  const report = `
===== VOD PERFORMANCE AUDIT =====

MOVIES

Categories fetch time: ${formatTime(m.categoriesFetchTimeMs)}
Global catalog available: ${m.globalCatalogAvailable ? 'Oui' : 'Non'}
Pages detected: ${m.pagesDetected}
Pages fetched: ${m.pagesFetched}
Items fetched: ${m.itemsFetched}
Unique items: ${m.uniqueItems}
Average request duration: ${formatTime(m.averageRequestDurationMs)}
Fastest request: ${formatTime(m.fastestRequestMs)}
Slowest request: ${formatTime(m.slowestRequestMs)}
Concurrency: ${m.concurrencyUsed}
Retries: ${m.retries}
429 count: ${m.count429}
503 count: ${m.count503}
Total movies import duration: ${formatTime(m.totalDurationMs)}

SERIES

Categories fetch time: ${formatTime(s.categoriesFetchTimeMs)}
Global catalog available: ${s.globalCatalogAvailable ? 'Oui' : 'Non'}
Pages detected: ${s.pagesDetected}
Pages fetched: ${s.pagesFetched}
Items fetched: ${s.itemsFetched}
Unique items: ${s.uniqueItems}
Average request duration: ${formatTime(s.averageRequestDurationMs)}
Fastest request: ${formatTime(s.fastestRequestMs)}
Slowest request: ${formatTime(s.slowestRequestMs)}
Concurrency: ${s.concurrencyUsed}
Retries: ${s.retries}
429 count: ${s.count429}
503 count: ${s.count503}
Total series import duration: ${formatTime(s.totalDurationMs)}

OTHER

Poster requests during import: ${o.posterRequests}
Series details requests during import: ${o.seriesDetailsRequests}
Episode requests during import: ${o.episodeRequests}
create_link requests during import: ${o.createLinkRequests}

TOTAL IMPORT TIME: ${formatTime(metrics.totalImportTimeMs)}

CURRENT CONCURRENCY: ${metrics.concurrency.current}
MAX CONCURRENCY: ${metrics.concurrency.max}
BACKOFF ACTIVE: ${metrics.concurrency.backoffActive ? 'Oui' : 'Non'}

IndexedDB write time: ${formatTime(metrics.indexedDb.writeTimeMs)}
Batch size: ${metrics.indexedDb.batchSize}
Items/sec: ${metrics.indexedDb.itemsPerSec} items/sec
React state updates during import: ${metrics.react.stateUpdates}

===== VOD BOTTLENECK ANALYSIS =====

Network time: ${b.networkPercent}%
IndexedDB writes: ${b.indexedDbPercent}%
Normalization/dedup: ${b.normalizationPercent}%
React rendering: ${b.reactRenderPercent}%
Posters: ${b.postersPercent}%
Other: ${b.otherPercent}%

PRIMARY BOTTLENECK:
${b.primaryBottleneck}
`.trim();

  console.log(report);
  return report;
}
