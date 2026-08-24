import { TVSeries, TVSeriesSeason, TVSeriesEpisode } from '../types/iptv';
import { vodCacheService } from './vodCacheService';

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

export interface StalkerSeriesDetailsResult {
  seasons: TVSeriesSeason[];
  diagnosticLog: string;
  cacheHit: boolean;
  success: boolean;
  error?: string;
}

// Helper to determine if an item represents a Season folder/container
function isSeasonContainerItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.is_season === 1 || item.is_season === '1' || item.has_seasons === 1 || item.type === 'season') {
    return true;
  }
  if (item.is_folder === 1 && !item.cmd && !item.url && !item.path) {
    return true;
  }

  const title = String(item.name || item.title || item.o_name || '').trim();
  const hasCmd = Boolean((item.cmd || item.url || item.path || item.file || item.stream_url || '').trim());

  if (!hasCmd && item.is_file !== 1) {
    if (
      /^(saison|season|st)\s*\d+/i.test(title) ||
      /^s\d+$/i.test(title) ||
      (item.season_number !== undefined && item.episode_number === undefined && item.episode_num === undefined && item.episode === undefined)
    ) {
      return true;
    }
  }

  return false;
}

// Helper to determine if an item represents a REAL Episode (and NOT a season container/folder)
function isRealEpisode(item: any, expectedSeasonNum?: number): boolean {
  if (!item || typeof item !== 'object') return false;

  // 1. Must not be explicitly marked as season
  if (item.is_season === 1 || item.is_season === '1' || item.has_seasons === 1 || item.type === 'season') {
    return false;
  }

  const title = String(item.name || item.title || item.o_name || '').trim();
  const hasCmd = Boolean((item.cmd || item.url || item.path || item.file || item.stream_url || '').trim());

  // 2. Folders without playback command/url are containers, not episodes
  if (!hasCmd && item.is_folder === 1) {
    return false;
  }

  // 3. Titles purely matching "Saison X", "Season X", "St X", "S4" without video cmd are containers
  if (/^(saison|season|st)\s*\d+$/i.test(title) || /^s\d+$/i.test(title)) {
    if (!hasCmd && item.is_file !== 1) {
      return false;
    }
  }

  // 4. Items where episode identifier is missing and title matches Season X are containers
  if (!hasCmd && item.episode_number === undefined && item.episode_num === undefined && item.episode === undefined) {
    if (/^(saison|season|st)\s*\d+$/i.test(title) || /^s\d+$/i.test(title)) {
      return false;
    }
  }

  return true;
}

function parseSeasonNum(item: any, fallbackNum: number): number {
  if (!item) return fallbackNum;
  const rawVal = item.season_number ?? item.season_num ?? item.season_id ?? item.season;
  if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
    const num = parseInt(String(rawVal), 10);
    if (!isNaN(num) && num >= 0) return num;
  }

  const title = String(item.name || item.title || item.o_name || '').trim();
  const match = title.match(/saison\s*(\d+)/i) ||
                title.match(/season\s*(\d+)/i) ||
                title.match(/s(\d+)\s*e\d+/i) ||
                title.match(/(\d+)x\d+/i) ||
                title.match(/^s(\d+)$/i) ||
                title.match(/^st\s*(\d+)/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }

  return fallbackNum;
}

function parseEpisodeNum(item: any, fallbackNum: number): number {
  if (!item) return fallbackNum;
  // NOTE: Do NOT use series_num here as it often holds season index
  const rawVal = item.episode_number ?? item.episode_num ?? item.episode ?? item.number;
  if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
    const num = parseInt(String(rawVal), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  const title = String(item.name || item.title || item.o_name || '').trim();
  const match = title.match(/s\d+\s*e(\d+)/i) ||
                title.match(/\d+x(\d+)/i) ||
                title.match(/e(\d+)\b/i) ||
                title.match(/ep\s*(\d+)/i) ||
                title.match(/épisode\s*(\d+)/i) ||
                title.match(/episode\s*(\d+)/i) ||
                title.match(/^(\d+)\s*[-_.]/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }

  return fallbackNum;
}

function cleanEpisodeTitle(item: any, epNum: number, seasonNum: number): string {
  const rawName = String(item.name || item.title || item.o_name || '').trim();
  if (!rawName) return `Épisode ${epNum}`;

  if (/^(saison|season|st)\s*\d+$/i.test(rawName) || /^s\d+$/i.test(rawName)) {
    return `Épisode ${epNum}`;
  }

  return rawName;
}

function formatSeasonRawDebug(
  seriesId: string,
  seasonNum: number,
  action: string,
  params: Record<string, any>,
  data: any,
  rawItems: any[],
  realEpisodesCount: number
): string {
  const safeParams = { ...params };
  delete safeParams.mac;
  delete safeParams.token;
  delete safeParams.auth;
  delete safeParams.password;
  delete safeParams.serial_number;

  const topLevelKeys = data ? Object.keys(data) : [];
  const jsObj = data?.js;
  const jsKeys = (jsObj && typeof jsObj === 'object' && !Array.isArray(jsObj)) ? Object.keys(jsObj) : [];

  const episodeArrays: string[] = [];
  const seasonArrays: string[] = [];

  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        if (k.includes('ep') || k.includes('item') || k.includes('record') || k.includes('file') || k.includes('data')) {
          episodeArrays.push(k);
        }
        if (k.includes('season')) {
          seasonArrays.push(k);
        }
      }
    });
  }
  if (jsObj && typeof jsObj === 'object') {
    Object.entries(jsObj).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        if (k.includes('ep') || k.includes('item') || k.includes('record') || k.includes('file') || k.includes('data')) {
          episodeArrays.push(`js.${k}`);
        }
        if (k.includes('season')) {
          seasonArrays.push(`js.${k}`);
        }
      }
    });
  }

  const firstItemKeys = rawItems[0] && typeof rawItems[0] === 'object' ? Object.keys(rawItems[0]) : [];

  let debug = `===== STALKER SEASON RAW DEBUG =====\n\n`;
  debug += `Series ID:\n${seriesId}\n\n`;
  debug += `Selected season:\n${seasonNum}\n\n`;
  debug += `Request action:\n${action}\n\n`;
  debug += `Request parameters:\n${JSON.stringify(safeParams)}\n\n`;
  debug += `HTTP:\n200 OK\n\n`;
  debug += `RAW response structure:\n\n`;
  debug += `Top level keys:\n${JSON.stringify(topLevelKeys.concat(jsKeys.map(k => `js.${k}`)))} \n\n`;
  debug += `Items count:\n${rawItems.length}\n\n`;
  debug += `First item keys:\n${JSON.stringify(firstItemKeys)}\n\n`;
  debug += `Possible episode arrays:\n${JSON.stringify(episodeArrays)}\n\n`;
  debug += `Possible season arrays:\n${JSON.stringify(seasonArrays)}\n\n`;
  debug += `Detected real episodes:\n${realEpisodesCount}`;

  return debug;
}

export class StalkerSeriesService {
  private portalUrl: string;
  private mac: string;
  private token: string | null;
  private serverKey: string;

  constructor(portalUrl: string, mac: string, token: string | null = null, serverKey: string) {
    this.portalUrl = portalUrl;
    this.mac = mac;
    this.token = token;
    this.serverKey = serverKey;
  }

  public async fetchSeriesDetails(series: TVSeries, forceRefresh = false): Promise<StalkerSeriesDetailsResult> {
    const cleanSeriesId = series.id.replace(/^stalker-series-/, '').trim();

    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {}

    // 1. Check IndexedDB Cache first
    if (!forceRefresh) {
      try {
        const cached = await vodCacheService.getCachedSeriesDetails(this.serverKey, cleanSeriesId);
        if (cached && cached.seasons && cached.seasons.length > 0) {
          let diagnosticLog = `===== SERIES RAW STRUCTURE =====\n\n`;
          diagnosticLog += `Series ID: ${cleanSeriesId}\n`;
          diagnosticLog += `Series title: ${series.title}\n`;
          diagnosticLog += `Top-level items: CACHED (${cached.seasons.length} seasons)\n`;
          diagnosticLog += `Top-level format: Cached Seasons & Episodes\n`;
          diagnosticLog += `Detected seasons: ${cached.seasons.length}\n\n`;

          cached.seasons.forEach((s) => {
            diagnosticLog += `Season ${s.seasonNumber} (${s.title}):\n`;
            diagnosticLog += `episodes detected: ${s.episodes.length}\n`;
          });

          diagnosticLog += `\nSTATUS: READY (CACHE HIT)`;

          return {
            seasons: cached.seasons,
            diagnosticLog,
            cacheHit: true,
            success: true,
          };
        }
      } catch (err) {
        console.warn('[StalkerSeriesService] Cache check notice:', err);
      }
    }

    // 2. Fetch top-level series response from Stalker portal
    let rawItems: any[] = [];
    let pagesFetched = 0;

    const probes = [
      { type: 'series', action: 'get_ordered_list', params: { movie_id: cleanSeriesId } },
      { type: 'series', action: 'get_ordered_list', params: { series_id: cleanSeriesId } },
      { type: 'series', action: 'get_ordered_list', params: { category_id: cleanSeriesId } },
      { type: 'series', action: 'get_ordered_list', params: { id: cleanSeriesId } },
      { type: 'series', action: 'get_series_info', params: { series_id: cleanSeriesId, movie_id: cleanSeriesId } },
      { type: 'series', action: 'get_episodes', params: { series_id: cleanSeriesId, movie_id: cleanSeriesId } },
      { type: 'series', action: 'get_seasons', params: { series_id: cleanSeriesId, movie_id: cleanSeriesId } },
      { type: 'vod', action: 'get_ordered_list', params: { movie_id: cleanSeriesId } },
    ];

    for (const probe of probes) {
      try {
        const data = await rawStalkerRequest(
          this.portalUrl,
          this.mac,
          probe.type,
          probe.action,
          this.token,
          { ...probe.params, page: 1 }
        );

        pagesFetched++;
        const js = data?.js;
        let items: any[] = [];
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.records)) items = js.records;
        else if (Array.isArray(js?.items)) items = js.items;
        else if (Array.isArray(js?.episodes)) items = js.episodes;
        else if (Array.isArray(js?.seasons)) items = js.seasons;

        if (items.length > 0) {
          rawItems = [...items];

          const totalServerItems = js?.total_items || js?.max_page_items || items.length;
          const pageSize = items.length;
          if (totalServerItems > pageSize && pageSize > 0) {
            const totalPages = Math.ceil(totalServerItems / pageSize);
            for (let p = 2; p <= totalPages; p++) {
              try {
                const pageData = await rawStalkerRequest(
                  this.portalUrl,
                  this.mac,
                  probe.type,
                  probe.action,
                  this.token,
                  { ...probe.params, page: p }
                );
                pagesFetched++;
                const pJs = pageData?.js;
                let pItems: any[] = [];
                if (Array.isArray(pJs)) pItems = pJs;
                else if (Array.isArray(pJs?.data)) pItems = pJs.data;
                else if (Array.isArray(pJs?.records)) pItems = pJs.records;
                else if (Array.isArray(pJs?.items)) pItems = pJs.items;
                else if (Array.isArray(pJs?.episodes)) pItems = pJs.episodes;
                else if (Array.isArray(pJs?.seasons)) pItems = pJs.seasons;

                if (pItems.length > 0) {
                  rawItems.push(...pItems);
                }
              } catch {
                // Ignore single page error
              }
            }
          }

          break; // Stop probes once top-level items are found
        }
      } catch {
        // Probe failed, continue
      }
    }

    if (rawItems.length === 0) {
      const diagnosticLog = `===== SERIES RAW STRUCTURE =====\n\nSeries ID: ${cleanSeriesId}\nSeries title: ${series.title}\nTop-level items: 0\nDetected seasons: 0\n\nSTATUS: ERROR (No items returned from server)`;
      return {
        seasons: [],
        diagnosticLog,
        cacheHit: false,
        success: false,
        error: 'Impossible de récupérer les données de cette série sur le serveur.',
      };
    }

    // 3. Inspect rawItems structure & determine if they are Season Containers or Episode items
    const topLevelIsSeasonContainers = rawItems.some((item) => isSeasonContainerItem(item));

    const seasonFieldsSet = new Set<string>();
    const episodeFieldsSet = new Set<string>();

    rawItems.forEach((item) => {
      Object.keys(item).forEach((k) => {
        if (k.includes('season') || k.includes('series') || k === 'id' || k === 'name' || k === 'title') {
          seasonFieldsSet.add(k);
        }
        if (k.includes('episode') || k.includes('cmd') || k.includes('url') || k.includes('time') || k.includes('duration')) {
          episodeFieldsSet.add(k);
        }
      });
    });

    const seasonsMap = new Map<number, { name: string; episodes: TVSeriesEpisode[]; rawSeasonItem?: any }>();

    if (topLevelIsSeasonContainers) {
      // Top-level items are Season Containers (e.g. Season 1, Season 2)
      for (let sIdx = 0; sIdx < rawItems.length; sIdx++) {
        const seasonItem = rawItems[sIdx];
        const sNum = parseSeasonNum(seasonItem, sIdx + 1);
        const sName = seasonItem.name || seasonItem.title || `Saison ${sNum}`;

        // Check if episodes are embedded inside this season item
        let epItems: any[] = [];
        if (Array.isArray(seasonItem.episodes)) epItems = seasonItem.episodes;
        else if (Array.isArray(seasonItem.series)) epItems = seasonItem.series;
        else if (Array.isArray(seasonItem.files)) epItems = seasonItem.files;
        else if (Array.isArray(seasonItem.children)) epItems = seasonItem.children;
        else if (Array.isArray(seasonItem.data)) epItems = seasonItem.data;

        // If not embedded, we do NOT eager-fetch episodes during fetchSeriesDetails anymore.
        // They will be fetched on-demand (lazy-loaded) when the user clicks a season in the UI.

        // Ensure epItems contains ONLY real episodes
        const validEpItems = epItems.filter(item => isRealEpisode(item, sNum));

        const episodeObjs: TVSeriesEpisode[] = validEpItems.map((epItem, epIdx) => {
          const epNum = parseEpisodeNum(epItem, epIdx + 1);
          const rawCmd = (epItem.cmd || epItem.url || epItem.path || '').trim();

          let poster = epItem.screenshot_uri || epItem.poster || epItem.cover || epItem.logo || series.poster;
          if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
            poster = portalOrigin ? `${portalOrigin}/${poster.replace(/^\//, '')}` : `${this.portalUrl}/${poster}`;
          }

          return {
            id: `ep-${cleanSeriesId}-s${sNum}-e${epNum}-${epItem.id || epIdx}`,
            title: cleanEpisodeTitle(epItem, epNum, sNum),
            episodeNumber: epNum,
            seasonNumber: sNum,
            duration: epItem.time || epItem.duration || '45m',
            overview: epItem.description || epItem.plot || 'Épisode disponible sur votre serveur Stalker.',
            streamUrl: rawCmd,
            cmd: rawCmd,
            series: epItem.series || '',
            thumbnail: poster,
          };
        });

        seasonsMap.set(sNum, { name: sName, episodes: episodeObjs, rawSeasonItem: seasonItem });
      }
    } else {
      // Top-level items are flat Episode items
      const validEpItems = rawItems.filter(item => isRealEpisode(item));

      validEpItems.forEach((epItem, index) => {
        const sNum = parseSeasonNum(epItem, 1);
        const epNum = parseEpisodeNum(epItem, index + 1);
        const rawCmd = (epItem.cmd || epItem.url || epItem.path || '').trim();

        let poster = epItem.screenshot_uri || epItem.poster || epItem.cover || epItem.logo || series.poster;
        if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
          poster = portalOrigin ? `${portalOrigin}/${poster.replace(/^\//, '')}` : `${this.portalUrl}/${poster}`;
        }

        const episodeObj: TVSeriesEpisode = {
          id: `ep-${cleanSeriesId}-s${sNum}-e${epNum}-${epItem.id || index}`,
          title: cleanEpisodeTitle(epItem, epNum, sNum),
          episodeNumber: epNum,
          seasonNumber: sNum,
          duration: epItem.time || epItem.duration || '45m',
          overview: epItem.description || epItem.plot || 'Épisode disponible sur votre serveur Stalker.',
          streamUrl: rawCmd,
          cmd: rawCmd,
          series: epItem.series || '',
          thumbnail: poster,
        };

        if (!seasonsMap.has(sNum)) {
          seasonsMap.set(sNum, { name: `Saison ${sNum}`, episodes: [] });
        }
        seasonsMap.get(sNum)!.episodes.push(episodeObj);
      });
    }

    // Sort seasons & episodes cleanly
    const sortedSeasons: TVSeriesSeason[] = Array.from(seasonsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([sNum, sData]) => ({
        seasonNumber: sNum,
        title: sData.name || `Saison ${sNum}`,
        name: sData.name,
        episodes: sData.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
      }));

    // Generate Diagnostic Log as required by Requirement 8
    let diagnosticLog = `===== SERIES RAW STRUCTURE =====\n\n`;
    diagnosticLog += `Series ID: ${cleanSeriesId}\n`;
    diagnosticLog += `Series title: ${series.title}\n`;
    diagnosticLog += `Top-level items: ${rawItems.length}\n`;
    diagnosticLog += `Top-level format: ${topLevelIsSeasonContainers ? 'Season Containers' : 'Flat Episode List'}\n`;
    diagnosticLog += `Detected seasons: ${sortedSeasons.length}\n`;
    diagnosticLog += `Season fields: [${Array.from(seasonFieldsSet).join(', ')}]\n`;
    diagnosticLog += `Episode fields: [${Array.from(episodeFieldsSet).join(', ')}]\n\n`;

    sortedSeasons.forEach((s) => {
      diagnosticLog += `Season ${s.seasonNumber} (${s.title}):\n`;
      diagnosticLog += `episodes detected: ${s.episodes.length}\n`;
    });

    diagnosticLog += `\nSTATUS: READY`;

    // Save to IndexedDB cache
    if (sortedSeasons.length > 0) {
      vodCacheService.saveSeriesDetails(this.serverKey, cleanSeriesId, sortedSeasons).catch(() => {});
    }

    return {
      seasons: sortedSeasons,
      diagnosticLog,
      cacheHit: false,
      success: true,
    };
  }

  public async fetchSeasonEpisodes(
    series: TVSeries,
    seasonNum: number,
    seasonItem?: any
  ): Promise<{ episodes: TVSeriesEpisode[]; rawDebug: string }> {
    const cleanSeriesId = series.id.replace(/^stalker-series-/, '').trim();
    const seasonId = seasonItem?.id || seasonItem?.season_id || 'N/A';

    // 1. Check IndexedDB Cache first
    try {
      const cachedDetails = await vodCacheService.getCachedSeriesDetails(this.serverKey, cleanSeriesId);
      if (cachedDetails && cachedDetails.seasons) {
        const cachedSeason = cachedDetails.seasons.find((s: any) => s.seasonNumber === seasonNum);
        if (cachedSeason && cachedSeason.episodes && cachedSeason.episodes.length > 0) {
          const epCount = cachedSeason.episodes.length;
          const rawDebug = `===== SEASON EPISODES LOAD =====\n\nSeries ID:\n${cleanSeriesId}\n\nSeason:\n${seasonNum}\n\nSeason container ID:\n${seasonId}\n\nSource:\nCACHE\n\nRequest:\nSUCCESS\n\nPages fetched:\n0\n\nRaw items:\n${epCount}\n\nReal episodes detected:\n${epCount}\n\nEpisodes loaded:\n${epCount}\n\ncreate_link calls:\n0\n\nSTATUS:\nEPISODES_READY`;
          return { episodes: cachedSeason.episodes, rawDebug };
        }
      }
    } catch (err) {
      console.warn('[StalkerSeriesService] Error checking season cache:', err);
    }

    // 2. Fetch from Server
    let portalOrigin = '';
    try {
      portalOrigin = new URL(this.portalUrl).origin;
    } catch {}

    const subProbes = [
      { type: 'series', action: 'get_ordered_list', params: { season_id: seasonId !== 'N/A' ? seasonId : undefined, movie_id: cleanSeriesId, series_id: cleanSeriesId } },
      { type: 'series', action: 'get_ordered_list', params: { movie_id: seasonId !== 'N/A' ? seasonId : undefined } },
      { type: 'series', action: 'get_ordered_list', params: { season_id: seasonId !== 'N/A' ? seasonId : undefined } },
      { type: 'series', action: 'get_ordered_list', params: { season: seasonNum, movie_id: cleanSeriesId, series_id: cleanSeriesId } },
      { type: 'series', action: 'get_ordered_list', params: { category_id: seasonId !== 'N/A' ? seasonId : undefined } },
      { type: 'series', action: 'get_episodes', params: { season_id: seasonId !== 'N/A' ? seasonId : undefined, movie_id: cleanSeriesId, series_id: cleanSeriesId } },
      { type: 'series', action: 'get_episodes', params: { season: seasonNum, movie_id: cleanSeriesId, series_id: cleanSeriesId } },
      { type: 'vod', action: 'get_ordered_list', params: { movie_id: seasonId !== 'N/A' ? seasonId : undefined } },
    ].filter(p => p.params.movie_id || p.params.season_id || p.params.season);

    let rawItems: any[] = [];
    let realEpisodes: TVSeriesEpisode[] = [];
    let pagesFetched = 0;
    let success = false;

    for (const probe of subProbes) {
      try {
        const data = await rawStalkerRequest(
          this.portalUrl,
          this.mac,
          probe.type,
          probe.action,
          this.token,
          { ...probe.params, page: 1 }
        );
        pagesFetched++;

        const js = data?.js;
        let items: any[] = [];
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.records)) items = js.records;
        else if (Array.isArray(js?.items)) items = js.items;
        else if (Array.isArray(js?.episodes)) items = js.episodes;

        if (items.length > 0) {
          rawItems = [...items];

          const totalServerItems = js?.total_items || js?.max_page_items || items.length;
          const pageSize = items.length;
          if (totalServerItems > pageSize && pageSize > 0) {
            const totalPages = Math.ceil(totalServerItems / pageSize);
            for (let p = 2; p <= totalPages; p++) {
              try {
                const pData = await rawStalkerRequest(
                  this.portalUrl,
                  this.mac,
                  probe.type,
                  probe.action,
                  this.token,
                  { ...probe.params, page: p }
                );
                pagesFetched++;
                const pJs = pData?.js;
                let pItems: any[] = [];
                if (Array.isArray(pJs)) pItems = pJs;
                else if (Array.isArray(pJs?.data)) pItems = pJs.data;
                else if (Array.isArray(pJs?.records)) pItems = pJs.records;
                else if (Array.isArray(pJs?.items)) pItems = pJs.items;
                else if (Array.isArray(pJs?.episodes)) pItems = pJs.episodes;

                if (pItems.length > 0) rawItems.push(...pItems);
              } catch {
                // Ignore page fetch errors
              }
            }
          }

          const validItems = rawItems.filter((item) => isRealEpisode(item, seasonNum));

          realEpisodes = validItems.map((epItem, epIdx) => {
            const epNum = parseEpisodeNum(epItem, epIdx + 1);
            const rawCmd = (epItem.cmd || epItem.url || epItem.path || '').trim();

            let poster = epItem.screenshot_uri || epItem.poster || epItem.cover || epItem.logo || series.poster;
            if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
              poster = portalOrigin ? `${portalOrigin}/${poster.replace(/^\//, '')}` : `${this.portalUrl}/${poster}`;
            }

            return {
              id: `ep-${cleanSeriesId}-s${seasonNum}-e${epNum}-${epItem.id || epIdx}`,
              title: cleanEpisodeTitle(epItem, epNum, seasonNum),
              episodeNumber: epNum,
              seasonNumber: seasonNum,
              duration: epItem.time || epItem.duration || '45m',
              overview: epItem.description || epItem.plot || 'Épisode disponible sur votre serveur Stalker.',
              streamUrl: rawCmd,
              cmd: rawCmd,
              series: epItem.series || '',
              thumbnail: poster,
            };
          });

          if (realEpisodes.length > 0) {
            success = true;
            break;
          }
        }
      } catch (err) {
        // Probe failed, try next
      }
    }

    // 3. Save to IndexedDB Cache if fetched successfully
    if (success && realEpisodes.length > 0) {
      try {
        const cachedDetails = await vodCacheService.getCachedSeriesDetails(this.serverKey, cleanSeriesId);
        let updatedSeasons = cachedDetails?.seasons || series.seasons || [];
        
        if (updatedSeasons.length === 0) {
          updatedSeasons = [{
            seasonNumber: seasonNum,
            title: seasonItem?.name || seasonItem?.title || `Saison ${seasonNum}`,
            name: seasonItem?.name || seasonItem?.title || `Saison ${seasonNum}`,
            episodes: realEpisodes
          }];
        } else {
          const sIdx = updatedSeasons.findIndex((s: any) => s.seasonNumber === seasonNum);
          if (sIdx !== -1) {
            updatedSeasons[sIdx].episodes = realEpisodes;
          } else {
            updatedSeasons.push({
              seasonNumber: seasonNum,
              title: seasonItem?.name || seasonItem?.title || `Saison ${seasonNum}`,
              name: seasonItem?.name || seasonItem?.title || `Saison ${seasonNum}`,
              episodes: realEpisodes
            });
          }
        }
        await vodCacheService.saveSeriesDetails(this.serverKey, cleanSeriesId, updatedSeasons);
      } catch (err) {
        console.warn('[StalkerSeriesService] Error saving season episodes to IndexedDB:', err);
      }
    }

    const rawDebug = `===== SEASON EPISODES LOAD =====\n\nSeries ID:\n${cleanSeriesId}\n\nSeason:\n${seasonNum}\n\nSeason container ID:\n${seasonId}\n\nSource:\nSERVER\n\nRequest:\n${success ? 'SUCCESS' : 'FAILED'}\n\nPages fetched:\n${pagesFetched}\n\nRaw items:\n${rawItems.length}\n\nReal episodes detected:\n${realEpisodes.length}\n\nEpisodes loaded:\n${realEpisodes.length}\n\ncreate_link calls:\n0\n\nSTATUS:\nEPISODES_READY`;

    return { episodes: realEpisodes, rawDebug };
  }
}
