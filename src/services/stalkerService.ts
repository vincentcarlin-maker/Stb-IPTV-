import { Channel, VODItem, TVSeries } from '../types/iptv';

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
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

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

  constructor(portalUrl: string, mac: string) {
    this.portalUrl = portalUrl;
    this.mac = mac;
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
      return { 
        success: false, 
        error: `Impossible de contacter le portail Stalker (${err.message}). Vérifiez l'adresse MAC et l'URL du portail.` 
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

  public async getVODMovies(): Promise<VODItem[]> {
    try {
      let portalOrigin = '';
      try {
        portalOrigin = new URL(this.portalUrl).origin;
      } catch {
        portalOrigin = '';
      }

      // Try get_ordered_list first, then fallback to get_all_records
      const actions = ['get_ordered_list', 'get_all_records'];
      let items: any[] = [];

      for (const act of actions) {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'vod', act, this.token);

        const data = await response.json();
        const js = data?.js;
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.records)) items = js.records;
        else if (Array.isArray(js?.items)) items = js.items;
        if (items.length > 0) break;
      }

      if (items.length > 0) {
        return items.map((item: any, index: number) => {
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

          return {
            id: `stalker-vod-${item.id || index}`,
            title: item.name || item.o_name || item.title || `Film Stalker ${index + 1}`,
            streamUrl: streamUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
            cmd: rawCmd,
            poster: poster || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
            backdrop: poster,
            category: item.category_name || item.genre_name || 'Films VOD',
            rating: item.rating ? `${item.rating}/10` : 'Tous publics',
            releaseYear: item.year ? parseInt(item.year, 10) : 2024,
            duration: item.time || item.duration || '1h 45m',
            overview: item.description || item.plot || 'Film disponible sur votre serveur Stalker.',
            genre: [item.genre_name || item.category_name || 'Cinéma'],
            director: item.director,
            cast: item.actors ? item.actors.split(',') : undefined,
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching stalker VOD:', err);
      return [];
    }
  }

  public async getSeriesList(): Promise<TVSeries[]> {
    try {
      const actions = ['get_ordered_list', 'get_all_records'];
      let items: any[] = [];

      for (const act of actions) {
        const response = await performStalkerFetch(this.portalUrl, this.mac, 'series', act, this.token);

        const data = await response.json();
        const js = data?.js;
        if (Array.isArray(js)) items = js;
        else if (Array.isArray(js?.data)) items = js.data;
        else if (Array.isArray(js?.records)) items = js.records;
        else if (Array.isArray(js?.items)) items = js.items;
        if (items.length > 0) break;
      }

      if (items.length > 0) {
        return items.map((item: any, index: number) => ({
          id: `stalker-series-${item.id || index}`,
          title: item.name || item.title || `Série ${index + 1}`,
          poster: item.screenshot_uri || item.poster || item.cover || 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
          category: item.category_name || 'Séries TV',
          rating: item.rating ? `${item.rating}/10` : '12+',
          releaseYear: item.year ? parseInt(item.year, 10) : 2024,
          overview: item.description || item.plot || 'Série TV disponible sur votre serveur Stalker.',
          genre: [item.category_name || 'Séries'],
          totalSeasons: item.total_seasons ? parseInt(item.total_seasons, 10) : 1,
          seasons: [],
        }));
      }
      return [];
    } catch (err) {
      console.error('Error fetching stalker Series:', err);
      return [];
    }
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
      // Re-connect in case token expired
      await this.connect();
      result = await fetchLink(cmd.startsWith('ffmpeg ') ? cmd : `ffmpeg ${cmd}`);
    }
    return result;
  }
}

