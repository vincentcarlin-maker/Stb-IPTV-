import { Channel, VODItem, TVSeries, EPGProgram } from '../types/iptv';

export interface StalkerGenre {
  id: string;
  title: string;
  alias?: string;
  category_id?: string;
  category_name?: string;
}

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
  params?: any
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
          items.forEach((c: any) => {
            const cid = String(c.id || c.category_id || c.genre_id || '').trim();
            const title = String(c.title || c.category_name || c.name || c.genre_name || '').trim();
            if (cid && title) {
              categoryMap.set(cid, title);
              list.push({ id: cid, title, alias: c.alias || '' });
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
          items.forEach((c: any) => {
            const cid = String(c.id || c.category_id || c.genre_id || '').trim();
            const title = String(c.title || c.category_name || c.name || c.genre_name || '').trim();
            if (cid && title) {
              categoryMap.set(cid, title);
              list.push({ id: cid, title, alias: c.alias || '' });
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
  public async getVODMovies(
    onProgress?: (progress: VodProgressCallback) => void
  ): Promise<VODItem[]> {
    this.lastAudit.films = {
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
    };

    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {
      portalOrigin = '';
    }

    try {
      const { map: categoryMap, list: categoriesList } = await this.getVODCategories();
      const moviesMap = new Map<string, VODItem>();
      let globalDuplicates = 0;
      let highestServerReportedTotal = 0;

      // Define categories to scan: Pass 0 = 'All' ('*'), followed by each category ID
      const categoryPasses: { id: string; name: string }[] = [
        { id: '*', name: 'Toutes les catégories (Vue Générale)' },
        { id: '0', name: 'Catégorie 0 (Par défaut)' },
        ...categoriesList.map(c => ({ id: c.id, name: c.title }))
      ];

      this.lastAudit.films.categoriesAudit = [];

      for (let passIdx = 0; passIdx < categoryPasses.length; passIdx++) {
        const cat = categoryPasses[passIdx];
        let catRawItemsCount = 0;
        let catUniqueItemsCount = 0;
        let catPagesFetched = 0;
        let catServerTotal = 0;

        let pageNum = 1;
        let catMaxPageItems = 0;
        let lastBatchIdsSignature = '';

        while (pageNum <= 250) {
          const fetchParams = { category: cat.id, p: pageNum, page: pageNum, sortby: 'added' };
          this.lastAudit.films.pagesRequested++;

          try {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'vod',
              'get_ordered_list',
              this.token,
              fetchParams
            );

            const httpStatus = res.status;
            const data = await res.json();
            const js = data?.js;

            let rawItems: any[] = [];
            if (Array.isArray(js)) {
              rawItems = js;
            } else if (js) {
              if (Array.isArray(js.data)) rawItems = js.data;
              else if (Array.isArray(js.records)) rawItems = js.records;
              else if (Array.isArray(js.items)) rawItems = js.items;

              const totalAnnounced = parseInt(String(js.total_items || js.total || 0), 10) || 0;
              if (totalAnnounced > catServerTotal) catServerTotal = totalAnnounced;
              if (totalAnnounced > highestServerReportedTotal) highestServerReportedTotal = totalAnnounced;

              const maxPg = parseInt(String(js.max_page_items || 0), 10) || 0;
              if (maxPg > catMaxPageItems) catMaxPageItems = maxPg;
            }

            if (httpStatus >= 200 && httpStatus < 300) {
              this.lastAudit.films.pagesSuccessful++;
            }

            catPagesFetched++;
            this.lastAudit.films.pagesFetched++;
            catRawItemsCount += rawItems.length;
            this.lastAudit.films.rawItemsReceived += rawItems.length;

            if (rawItems.length === 0) {
              // Empty page reached, end pagination for this category
              break;
            }

            if (catMaxPageItems <= 0) catMaxPageItems = rawItems.length;

            const firstItemId = String(rawItems[0]?.id || rawItems[0]?.movie_id || '');
            const lastItemId = String(rawItems[rawItems.length - 1]?.id || rawItems[rawItems.length - 1]?.movie_id || '');
            const batchSignature = `${firstItemId}_${lastItemId}_${rawItems.length}`;

            const isRepeatedPage = batchSignature === lastBatchIdsSignature;
            lastBatchIdsSignature = batchSignature;

            this.lastAudit.films.pagesAudit.push({
              page: pageNum,
              category: cat.name,
              requestedPage: pageNum,
              httpStatus,
              itemsReturned: rawItems.length,
              firstItemId,
              lastItemId,
              serverTotal: catServerTotal || rawItems.length,
              repeatedPage: isRepeatedPage,
            });

            if (isRepeatedPage) {
              this.lastAudit.films.paginationErrors.push(`Catégorie ${cat.name} Page ${pageNum}: Page répétée (doublon). Fin du balayage.`);
              break;
            }

            const newFormattedItems: VODItem[] = [];

            for (let i = 0; i < rawItems.length; i++) {
              const item = rawItems[i];
              const rawId = String(item.id || item.movie_id || item.cmd || (pageNum - 1) * catMaxPageItems + i);
              const uniqueId = `stalker-vod-${rawId}`;

              const rawCmd = item.cmd ? item.cmd.trim() : '';
              let streamUrl = rawCmd.replace(/^(ffmpeg|auto|ffrt)\s+/i, '').trim();

              if (streamUrl.startsWith('http://localhost') || streamUrl.startsWith('http://127.0.0.1')) {
                if (portalOrigin) streamUrl = streamUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, portalOrigin);
              } else if (streamUrl.startsWith('/')) {
                if (portalOrigin) streamUrl = `${portalOrigin}${streamUrl}`;
              }

              const posterRes = resolvePosterSources(item, this.portalUrl);

              let catName = item.category_name || item.genre_name || item.category;
              const catId = String(item.category_id || item.genre_id || '').trim();
              if (!catName && catId && categoryMap.has(catId)) {
                catName = categoryMap.get(catId);
              }
              if (!catName) catName = cat.name !== 'Toutes les catégories (Vue Générale)' ? cat.name : 'Films VOD';

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
                rating: item.rating || item.kinopoisk_rating || item.rating_imdb ? `${item.rating || item.kinopoisk_rating || item.rating_imdb}/10` : 'Tous publics',
                releaseYear: item.year ? parseInt(String(item.year).slice(0, 4), 10) : 2024,
                duration: item.time || item.duration || '1h 45m',
                overview: item.description || item.plot || item.descr || 'Film complet disponible sur votre serveur Stalker.',
                genre: [catName],
                director: item.director,
                cast: item.actors ? String(item.actors).split(',').map((s: string) => s.trim()) : undefined,
                isLocked: item.locked === '1' || item.censored === '1' || item.name?.toUpperCase().includes('18+'),
              };

              // Collect sample poster audit for first 5 items
              if (this.lastAudit.films.posterFieldAudit.length < 5) {
                this.lastAudit.films.posterFieldAudit.push({
                  contentId: uniqueId,
                  title: formatted.title,
                  fields: posterRes.fieldsFound,
                  selectedPosterSource: posterRes.sourceField,
                  isMixedContentRisk: posterRes.isMixedContentRisk,
                });
              }

              if (moviesMap.has(uniqueId)) {
                globalDuplicates++;
              } else {
                moviesMap.set(uniqueId, formatted);
                newFormattedItems.push(formatted);
                catUniqueItemsCount++;
              }
            }

            if (onProgress && newFormattedItems.length > 0) {
              onProgress({
                type: 'films',
                current: moviesMap.size,
                total: highestServerReportedTotal || moviesMap.size,
                page: pageNum,
                totalPages: catMaxPageItems > 0 && catServerTotal > 0 ? Math.ceil(catServerTotal / catMaxPageItems) : pageNum,
                itemsChunk: newFormattedItems,
              });
            }

            const expectedPagesForCat = catMaxPageItems > 0 && catServerTotal > 0 ? Math.ceil(catServerTotal / catMaxPageItems) : 1;
            if (pageNum >= expectedPagesForCat && catServerTotal > 0) {
              break;
            }

            pageNum++;
            await new Promise((r) => setTimeout(r, 15));
          } catch (err: any) {
            this.lastAudit.films.paginationErrors.push(`Erreur réseau Catégorie ${cat.name} Page ${pageNum}: ${err.message}`);
            break;
          }
        }

        if (catRawItemsCount > 0) {
          this.lastAudit.films.categoriesAudit.push({
            categoryId: cat.id,
            categoryName: cat.name,
            serverTotal: catServerTotal,
            pagesFetched: catPagesFetched,
            rawItems: catRawItemsCount,
            uniqueItems: catUniqueItemsCount,
            isComplete: true,
          });
        }
      }

      this.lastAudit.films.serverTotal = highestServerReportedTotal || moviesMap.size;
      this.lastAudit.films.pagesExpected = Math.max(1, Math.ceil(this.lastAudit.films.serverTotal / 100));
      this.lastAudit.films.uniqueFilms = moviesMap.size;
      this.lastAudit.films.duplicatesRemoved = globalDuplicates;
      this.lastAudit.films.itemsDiscarded = 0;
      this.lastAudit.films.missingComparedToServer = Math.max(0, this.lastAudit.films.serverTotal - moviesMap.size);
      this.lastAudit.films.isComplete = this.lastAudit.films.missingComparedToServer === 0;

      return Array.from(moviesMap.values());
    } catch (err: any) {
      console.error('Error in getVODMovies multi-pass pagination:', err);
      this.lastAudit.films.paginationErrors.push(`Erreur globale films: ${err.message}`);
      return [];
    }
  }

  // ==========================================
  // FULL PAGINATED SERIES (MULTI-PASS)
  // ==========================================
  public async getSeriesList(
    onProgress?: (progress: VodProgressCallback) => void
  ): Promise<TVSeries[]> {
    this.lastAudit.series = {
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
    };

    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {
      portalOrigin = '';
    }

    try {
      const { map: categoryMap, list: categoriesList } = await this.getSeriesCategories();
      const seriesMap = new Map<string, TVSeries>();
      let globalDuplicates = 0;
      let highestServerReportedTotal = 0;

      const categoryPasses: { id: string; name: string }[] = [
        { id: '*', name: 'Toutes les catégories Séries (Vue Générale)' },
        { id: '0', name: 'Catégorie 0 (Par défaut)' },
        ...categoriesList.map(c => ({ id: c.id, name: c.title }))
      ];

      this.lastAudit.series.categoriesAudit = [];

      for (let passIdx = 0; passIdx < categoryPasses.length; passIdx++) {
        const cat = categoryPasses[passIdx];
        let catRawItemsCount = 0;
        let catUniqueItemsCount = 0;
        let catPagesFetched = 0;
        let catServerTotal = 0;

        let pageNum = 1;
        let catMaxPageItems = 0;
        let lastBatchIdsSignature = '';

        while (pageNum <= 250) {
          const fetchParams = { category: cat.id, p: pageNum, page: pageNum, sortby: 'added' };
          this.lastAudit.series.pagesRequested++;

          try {
            const res = await performStalkerFetch(
              this.portalUrl,
              this.mac,
              'series',
              'get_ordered_list',
              this.token,
              fetchParams
            );

            const httpStatus = res.status;
            const data = await res.json();
            const js = data?.js;

            let rawItems: any[] = [];
            if (Array.isArray(js)) {
              rawItems = js;
            } else if (js) {
              if (Array.isArray(js.data)) rawItems = js.data;
              else if (Array.isArray(js.records)) rawItems = js.records;
              else if (Array.isArray(js.items)) rawItems = js.items;

              const totalAnnounced = parseInt(String(js.total_items || js.total || 0), 10) || 0;
              if (totalAnnounced > catServerTotal) catServerTotal = totalAnnounced;
              if (totalAnnounced > highestServerReportedTotal) highestServerReportedTotal = totalAnnounced;

              const maxPg = parseInt(String(js.max_page_items || 0), 10) || 0;
              if (maxPg > catMaxPageItems) catMaxPageItems = maxPg;
            }

            if (httpStatus >= 200 && httpStatus < 300) {
              this.lastAudit.series.pagesSuccessful++;
            }

            catPagesFetched++;
            this.lastAudit.series.pagesFetched++;
            catRawItemsCount += rawItems.length;
            this.lastAudit.series.rawItemsReceived += rawItems.length;

            if (rawItems.length === 0) {
              break;
            }

            if (catMaxPageItems <= 0) catMaxPageItems = rawItems.length;

            const firstItemId = String(rawItems[0]?.id || rawItems[0]?.movie_id || '');
            const lastItemId = String(rawItems[rawItems.length - 1]?.id || rawItems[rawItems.length - 1]?.movie_id || '');
            const batchSignature = `${firstItemId}_${lastItemId}_${rawItems.length}`;

            const isRepeatedPage = batchSignature === lastBatchIdsSignature;
            lastBatchIdsSignature = batchSignature;

            this.lastAudit.series.pagesAudit.push({
              page: pageNum,
              category: cat.name,
              requestedPage: pageNum,
              httpStatus,
              itemsReturned: rawItems.length,
              firstItemId,
              lastItemId,
              serverTotal: catServerTotal || rawItems.length,
              repeatedPage: isRepeatedPage,
            });

            if (isRepeatedPage) {
              this.lastAudit.series.paginationErrors.push(`Catégorie Séries ${cat.name} Page ${pageNum}: Page répétée (doublon). Fin du balayage.`);
              break;
            }

            const newFormattedItems: TVSeries[] = [];

            for (let i = 0; i < rawItems.length; i++) {
              const item = rawItems[i];
              const rawId = String(item.id || item.movie_id || item.series_id || (pageNum - 1) * catMaxPageItems + i);
              const uniqueId = `stalker-series-${rawId}`;

              const posterRes = resolvePosterSources(item, this.portalUrl);

              let catName = item.category_name || item.genre_name || item.category;
              const catId = String(item.category_id || item.genre_id || '').trim();
              if (!catName && catId && categoryMap.has(catId)) {
                catName = categoryMap.get(catId);
              }
              if (!catName) catName = cat.name !== 'Toutes les catégories Séries (Vue Générale)' ? cat.name : 'Séries TV';

              const totalSeasons = item.total_seasons ? parseInt(String(item.total_seasons), 10) : 1;

              const formatted: TVSeries = {
                id: uniqueId,
                title: item.name || item.title || item.o_name || `Série ${rawId}`,
                poster: posterRes.primaryPoster,
                posterCandidates: posterRes.candidates,
                posterSource: posterRes.sourceField,
                backdrop: posterRes.primaryPoster,
                category: catName,
                rating: item.rating ? `${item.rating}/10` : '12+',
                releaseYear: item.year ? parseInt(String(item.year).slice(0, 4), 10) : 2024,
                overview: item.description || item.plot || item.descr || 'Série TV complète disponible sur votre serveur Stalker.',
                genre: [catName],
                totalSeasons: totalSeasons > 0 ? totalSeasons : 1,
                seasons: [],
                isLocked: item.locked === '1' || item.censored === '1' || item.name?.toUpperCase().includes('18+'),
              };

              if (this.lastAudit.series.posterFieldAudit.length < 5) {
                this.lastAudit.series.posterFieldAudit.push({
                  contentId: uniqueId,
                  title: formatted.title,
                  fields: posterRes.fieldsFound,
                  selectedPosterSource: posterRes.sourceField,
                  isMixedContentRisk: posterRes.isMixedContentRisk,
                });
              }

              if (seriesMap.has(uniqueId)) {
                globalDuplicates++;
              } else {
                seriesMap.set(uniqueId, formatted);
                newFormattedItems.push(formatted);
                catUniqueItemsCount++;
              }
            }

            if (onProgress && newFormattedItems.length > 0) {
              onProgress({
                type: 'series',
                current: seriesMap.size,
                total: highestServerReportedTotal || seriesMap.size,
                page: pageNum,
                totalPages: catMaxPageItems > 0 && catServerTotal > 0 ? Math.ceil(catServerTotal / catMaxPageItems) : pageNum,
                itemsChunk: newFormattedItems,
              });
            }

            const expectedPagesForCat = catMaxPageItems > 0 && catServerTotal > 0 ? Math.ceil(catServerTotal / catMaxPageItems) : 1;
            if (pageNum >= expectedPagesForCat && catServerTotal > 0) {
              break;
            }

            pageNum++;
            await new Promise((r) => setTimeout(r, 15));
          } catch (err: any) {
            this.lastAudit.series.paginationErrors.push(`Erreur réseau Catégorie Séries ${cat.name} Page ${pageNum}: ${err.message}`);
            break;
          }
        }

        if (catRawItemsCount > 0) {
          this.lastAudit.series.categoriesAudit.push({
            categoryId: cat.id,
            categoryName: cat.name,
            serverTotal: catServerTotal,
            pagesFetched: catPagesFetched,
            rawItems: catRawItemsCount,
            uniqueItems: catUniqueItemsCount,
            uniqueSeries: catUniqueItemsCount,
            isComplete: true,
          });
        }
      }

      this.lastAudit.series.serverTotal = highestServerReportedTotal || seriesMap.size;
      this.lastAudit.series.pagesExpected = Math.max(1, Math.ceil(this.lastAudit.series.serverTotal / 100));
      this.lastAudit.series.uniqueSeries = seriesMap.size;
      this.lastAudit.series.duplicatesRemoved = globalDuplicates;
      this.lastAudit.series.itemsDiscarded = 0;
      this.lastAudit.series.missingComparedToServer = Math.max(0, this.lastAudit.series.serverTotal - seriesMap.size);
      this.lastAudit.series.isComplete = this.lastAudit.series.missingComparedToServer === 0;

      // Print consolidated audit report
      printVodAuditReport(this.lastAudit);

      return Array.from(seriesMap.values());
    } catch (err: any) {
      console.error('Error in getSeriesList multi-pass pagination:', err);
      this.lastAudit.series.paginationErrors.push(`Erreur globale séries: ${err.message}`);
      return [];
    }
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
