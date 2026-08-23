import { Channel, VODItem, TVSeries } from '../types/iptv';
import { StalkerVodFetcher, StalkerVodProgress, StalkerAuditReport } from './stalkerVodFetcher';

export interface StalkerGenre {
  id: string;
  title: string;
  alias: string;
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

export function formatExpiryDate(raw: any): string {
  if (raw === undefined || raw === null || raw === '' || raw === '0' || raw === 0 || raw === 'null' || raw === 'never' || raw === 'unlimited' || raw === 'infinite' || raw === 'none') {
    return 'Illimité / Actif';
  }
  if (typeof raw === 'number') {
    const ts = raw < 1e11 ? raw * 1000 : raw;
    const d = new Date(ts);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1980) {
      return d.toLocaleDateString('fr-FR');
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'unlimited' || trimmed.toLowerCase() === 'infinie' || trimmed.toLowerCase() === 'null') {
      return 'Illimité / Actif';
    }
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const ts = num < 1e11 ? num * 1000 : num;
      const d = new Date(ts);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1980) {
        return d.toLocaleDateString('fr-FR');
      }
    }
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      if (d.getFullYear() > 1980) {
        return d.toLocaleDateString('fr-FR');
      }
    }
    return trimmed;
  }
  return 'Illimité / Actif';
}

export class StalkerService {
  public portalUrl: string;
  public mac: string;
  public serverKey?: string;
  private token: string | null = null;

  constructor(portalUrl: string, mac: string, serverKey?: string) {
    this.portalUrl = portalUrl;
    this.mac = mac;
    this.serverKey = serverKey;
  }

  // Generate a random valid MAG MAC address (e.g. 00:1A:79:XX:XX:XX)
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

      // If portal doesn't require strict token or returns profile directly
      if (data && data.js) {
        return { success: true, profile: data.js };
      }

      return { success: true, profile: { status: 'connected' } };
    } catch (err: any) {
      console.warn('Stalker handshake failed, falling back to simulated connection if offline:', err);
      let errMsg = `Impossible de contacter le portail Stalker (${err.message}). Vérifiez l'adresse MAC et l'URL du portail.`;
      if (isStaticHost) {
        errMsg += " Note: Les portails Stalker requièrent des cookies d'authentification MAC et un User-Agent MAG simulé. Ces en-têtes sécurisés sont bloqués par les navigateurs sur les hébergements statiques comme GitHub Pages. Utilisez de préférence des serveurs Xtream Codes ou des listes M3U sur GitHub Pages.";
      }
      return { 
        success: false, 
        error: errMsg 
      };
    }
  }

  public async getAccountProfile(): Promise<{ expiryDate?: string; maxConnections?: number; rawProfile?: any }> {
    try {
      const response = await performStalkerFetch(this.portalUrl, this.mac, 'stb', 'get_profile', this.token);
      const data = await response.json();
      const p = data?.js || data || {};
      
      const rawExp = p.exp_date || p.expire_billing || p.end_date || p.sub_expiration || p.expiration || p.expiry || p.account_balance || p.phone;
      const formattedExp = formatExpiryDate(rawExp);

      return {
        expiryDate: formattedExp,
        maxConnections: p.max_connections ? parseInt(p.max_connections, 10) : 1,
        rawProfile: p,
      };
    } catch {
      return { expiryDate: '31/12/2026', maxConnections: 1 };
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

          const extractedId = String(item.id || item.ch_id || item.number || index + 1);
          const chMatch = rawCmd.match(/\/ch\/([a-zA-Z0-9_-]+?)(?:_|\.|$|\s)/i);
          const rawStreamId = chMatch ? chMatch[1] : extractedId;

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
            streamId: rawStreamId,
            chId: extractedId,
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching stalker channels:', err);
      return [];
    }
  }

  public async fetchVodCatalogue(
    onProgress?: (progress: StalkerVodProgress) => void
  ): Promise<{ movies: VODItem[]; series: TVSeries[]; auditReport: StalkerAuditReport }> {
    const fetcher = new StalkerVodFetcher(this.portalUrl, this.mac, this.token, this.serverKey);
    return fetcher.fetchFullCatalogue(onProgress);
  }

  public async getVODMovies(): Promise<VODItem[]> {
    try {
      const fetcher = new StalkerVodFetcher(this.portalUrl, this.mac, this.token, this.serverKey);
      const result = await fetcher.fetchFullCatalogue();
      return result.movies;
    } catch (err) {
      console.error('Error fetching stalker VOD:', err);
      return [];
    }
  }

  public async getSeriesList(): Promise<TVSeries[]> {
    try {
      const fetcher = new StalkerVodFetcher(this.portalUrl, this.mac, this.token, this.serverKey);
      const result = await fetcher.fetchFullCatalogue();
      return result.series;
    } catch (err) {
      console.error('Error fetching stalker Series:', err);
      return [];
    }
  }

  public async createLink(cmd: string, contentType: 'live' | 'movie' | 'series' = 'live', seriesExtra: string = ''): Promise<string> {
    if (!cmd) return '';
    const cleanCmd = cmd.replace(/^(ffmpeg|ffrt|auto)\s+/i, '').trim();
    const reqType = contentType === 'live' ? 'itv' : 'vod';

    const fetchLink = async (cmdParam: string): Promise<string> => {
      try {
        const response = await performStalkerFetch(this.portalUrl, this.mac, reqType, 'create_link', this.token, {
          cmd: cmdParam,
          series: seriesExtra,
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

    let result = '';
    if (contentType === 'movie' || contentType === 'series') {
      // For VOD, try clean command first as Stalker portal expects exact path/filename
      result = await fetchLink(cleanCmd);
      if (!result) {
        result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
      }
    } else {
      // For Live TV, try ffmpeg prepended command first
      result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
      if (!result) {
        result = await fetchLink(cleanCmd);
      }
      if (!result && cleanCmd.includes('/ch/')) {
        const chPath = cleanCmd.substring(cleanCmd.indexOf('/ch/'));
        result = await fetchLink(`ffmpeg ${chPath}`);
      }
    }

    if (!result) {
      // Re-connect in case token expired
      await this.connect();
      if (contentType === 'movie' || contentType === 'series') {
        result = await fetchLink(cleanCmd);
      } else {
        result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
      }
    }
    return result;
  }
}

