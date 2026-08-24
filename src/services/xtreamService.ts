import { Channel, VODItem, TVSeries, TVSeriesSeason, TVSeriesEpisode } from '../types/iptv';

export function extractCategoryFromName(name: string): string | null {
  if (!name) return null;
  const pipeMatch = name.match(/^([^|:]+)\s*[|:]\s*(.+)$/);
  if (pipeMatch) {
    const candidate = pipeMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 40) {
      return candidate;
    }
  }
  return null;
}

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') || 
  window.location.hostname.includes('github.pages') ||
  window.location.hostname.includes('pages.dev') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('vercel.app')
);

function getXtreamRequestUrl(serverUrl: string, username: string, password: string, action?: string, extraParams?: Record<string, string>): string {
  const queryParams = new URLSearchParams({
    username,
    password,
  });
  if (action) {
    queryParams.append('action', action);
  }
  if (extraParams) {
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        queryParams.append(k, String(v));
      }
    });
  }
  const targetUrl = `${serverUrl}/player_api.php?${queryParams.toString()}`;
  
  if (isStaticHost) {
    return `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
  }
  
  const proxyParams = new URLSearchParams({
    serverUrl,
    username,
    password,
  });
  if (action) {
    proxyParams.append('action', action);
  }
  if (extraParams) {
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        proxyParams.append(k, String(v));
      }
    });
  }
  return `/api/xtream/proxy?${proxyParams.toString()}`;
}

export class XtreamService {
  private serverUrl: string;
  private username: string;
  private password: string;

  constructor(serverUrl: string, username: string, password: string) {
    this.serverUrl = serverUrl;
    this.username = username;
    this.password = password;
  }

  public async authenticate(): Promise<{ success: boolean; userInfo?: any; serverInfo?: any; error?: string }> {
    try {
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const data = await res.json();
      if (data.user_info && data.user_info.auth === 1) {
        return {
          success: true,
          userInfo: data.user_info,
          serverInfo: data.server_info,
        };
      } else {
        return {
          success: false,
          error: data.user_info?.message || 'Identifiants Xtream Codes invalides ou compte expiré.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Connexion impossible au serveur Xtream (${err.message}).`,
      };
    }
  }

  public async getCategories(action: 'get_live_categories' | 'get_vod_categories' | 'get_series_categories'): Promise<Map<string, string>> {
    const categoryMap = new Map<string, string>();
    try {
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, action);
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach((cat: any) => {
          if (cat.category_id && cat.category_name) {
            categoryMap.set(String(cat.category_id), String(cat.category_name).trim());
          }
        });
      }
    } catch (err) {
      console.warn(`Error fetching Xtream categories (${action}):`, err);
    }
    return categoryMap;
  }

  public async getOrderedCategoriesList(action: 'get_live_categories' | 'get_vod_categories' | 'get_series_categories'): Promise<string[]> {
    const categories: string[] = [];
    try {
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, action);
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach((cat: any) => {
          const name = (cat.category_name || '').trim();
          if (name && !categories.includes(name)) {
            categories.push(name);
          }
        });
      }
    } catch (err) {
      console.warn(`Error fetching Xtream ordered categories list (${action}):`, err);
    }
    return categories;
  }

  public async getLiveStreams(): Promise<Channel[]> {
    try {
      const categoryMap = await this.getCategories('get_live_categories');
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, 'get_live_streams');
      const res = await fetch(url);
      const data = await res.json();

      if (Array.isArray(data)) {
        return data.map((item: any, index: number) => {
          const streamUrl = `${this.serverUrl}/live/${this.username}/${this.password}/${item.stream_id}.m3u8`;
          const backupStreamUrl = `${this.serverUrl}/${this.username}/${this.password}/${item.stream_id}.ts`;

          let catName = item.category_name || (item.category_id ? categoryMap.get(String(item.category_id)) : null);
          if (!catName || catName === 'Généraliste') {
            const extracted = extractCategoryFromName(item.name || '');
            if (extracted) catName = extracted;
          }
          if (!catName) catName = 'Généraliste';

          const isAdult = catName.toUpperCase().includes('ADULT') || catName.toUpperCase().includes('XXX') || catName.includes('18+') || item.name?.toUpperCase().includes('18+');
          return {
            id: `xtream-${item.stream_id}`,
            number: item.num || index + 1,
            name: item.name || `Canal ${index + 1}`,
            streamUrl,
            backupStreamUrl,
            logo: item.stream_icon,
            category: catName,
            epgId: item.epg_channel_id,
            resolution: item.name?.toUpperCase().includes('4K') ? '4K' : item.name?.toUpperCase().includes('FHD') ? 'FHD' : 'HD',
            isLocked: isAdult,
            hasCatchup: item.tv_archive === 1,
            catchupDays: item.tv_archive_duration || 7,
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching Xtream streams:', err);
      return [];
    }
  }

  public async getVOD(): Promise<VODItem[]> {
    try {
      const categoryMap = await this.getCategories('get_vod_categories');
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, 'get_vod_streams');
      const res = await fetch(url);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.vod_streams) ? data.vod_streams : (Array.isArray(data?.data) ? data.data : []));

      if (list.length > 0) {
        return list.map((item: any) => {
          let catName = item.category_name || (item.category_id ? categoryMap.get(String(item.category_id)) : null) || 'Films';
          return {
            id: `vod-${item.stream_id || item.id}`,
            title: item.name || item.title || 'Film sans titre',
            streamUrl: `${this.serverUrl}/movie/${this.username}/${this.password}/${item.stream_id}.${item.container_extension || 'mp4'}`,
            poster: item.stream_icon || item.cover || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
            category: catName,
            rating: item.rating ? `${item.rating}/10` : 'Tous publics',
            releaseYear: (item.year && !isNaN(parseInt(item.year, 10))) ? parseInt(item.year, 10) : 2024,
            duration: item.duration || '1h 30m',
            overview: item.plot || item.description || 'Aucune description disponible pour ce film.',
            genre: [catName || 'Cinéma'],
            addedDate: item.added,
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching Xtream VOD:', err);
      return [];
    }
  }

  public async getSeries(): Promise<TVSeries[]> {
    try {
      const categoryMap = await this.getCategories('get_series_categories');
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, 'get_series');
      const res = await fetch(url);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.series) ? data.series : (Array.isArray(data?.data) ? data.data : []));

      if (list.length > 0) {
        return list.map((item: any) => {
          let catName = item.category_name || (item.category_id ? categoryMap.get(String(item.category_id)) : null) || 'Séries TV';
          return {
            id: `series-${item.series_id || item.id}`,
            title: item.name || item.title || 'Série sans titre',
            poster: item.cover || item.stream_icon || 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
            backdrop: item.cover,
            category: catName,
            rating: item.rating ? `${item.rating}/10` : '12+',
            releaseYear: (item.releaseDate && !isNaN(parseInt(item.releaseDate, 10))) ? parseInt(item.releaseDate, 10) : 2024,
            overview: item.plot || item.description || 'Aucune description disponible.',
            genre: [catName || 'Drame'],
            totalSeasons: (item.seasons_count && !isNaN(parseInt(item.seasons_count, 10))) ? parseInt(item.seasons_count, 10) : 1,
            seasons: [],
          };
        });
      }
      return [];
    } catch (err) {
      console.error('Error fetching Xtream series:', err);
      return [];
    }
  }

  public async getSeriesInfo(seriesId: string): Promise<TVSeriesSeason[]> {
    try {
      const cleanId = String(seriesId).replace(/^series-/, '').trim();
      const url = getXtreamRequestUrl(this.serverUrl, this.username, this.password, 'get_series_info', {
        series_id: cleanId,
      });

      const res = await fetch(url);
      const data = await res.json();

      if (!data || typeof data !== 'object') {
        return [];
      }

      const seasonsMap = new Map<number, TVSeriesSeason>();

      // 1. Parse server seasons if provided
      const rawSeasons = Array.isArray(data.seasons) ? data.seasons : [];
      rawSeasons.forEach((s: any, idx: number) => {
        const sNum = parseInt(String(s.season_number ?? s.id ?? idx + 1), 10);
        const validSNum = isNaN(sNum) || sNum < 0 ? idx + 1 : sNum;
        const sName = s.name || s.title || `Saison ${validSNum}`;

        seasonsMap.set(validSNum, {
          seasonNumber: validSNum,
          title: sName,
          name: sName,
          episodes: [],
          rawSeasonItem: s,
        });
      });

      // 2. Parse server episodes
      const rawEpisodesObj = data.episodes;
      if (rawEpisodesObj && typeof rawEpisodesObj === 'object') {
        if (Array.isArray(rawEpisodesObj)) {
          // Flat array of episodes
          rawEpisodesObj.forEach((epItem: any, epIdx: number) => {
            const sNum = parseInt(String(epItem.season ?? epItem.season_number ?? 1), 10);
            const validSNum = isNaN(sNum) || sNum < 0 ? 1 : sNum;
            const epNum = parseInt(String(epItem.episode_num ?? epItem.episode_number ?? epIdx + 1), 10);
            const validEpNum = isNaN(epNum) || epNum <= 0 ? epIdx + 1 : epNum;

            const streamExt = epItem.container_extension || 'mp4';
            const streamId = epItem.id || epItem.stream_id || `${validSNum}-${validEpNum}`;
            const epStreamUrl = `${this.serverUrl}/series/${this.username}/${this.password}/${streamId}.${streamExt}`;

            let thumbnail = epItem.info?.movie_image || epItem.stream_icon || epItem.cover;
            let duration = epItem.info?.duration || epItem.duration;
            if (!duration && epItem.info?.duration_secs) {
              duration = `${Math.round(parseInt(epItem.info.duration_secs, 10) / 60)}m`;
            }

            const episodeObj: TVSeriesEpisode = {
              id: `xtream-ep-${cleanId}-s${validSNum}-e${validEpNum}-${streamId}`,
              title: epItem.title || epItem.name || `Épisode ${validEpNum}`,
              episodeNumber: validEpNum,
              seasonNumber: validSNum,
              duration: duration || '45m',
              overview: epItem.info?.plot || epItem.plot || epItem.description || '',
              streamUrl: epStreamUrl,
              thumbnail,
            };

            if (!seasonsMap.has(validSNum)) {
              seasonsMap.set(validSNum, {
                seasonNumber: validSNum,
                title: `Saison ${validSNum}`,
                name: `Saison ${validSNum}`,
                episodes: [],
              });
            }
            seasonsMap.get(validSNum)!.episodes.push(episodeObj);
          });
        } else {
          // Object keyed by season number e.g. { "1": [...], "2": [...] }
          Object.entries(rawEpisodesObj).forEach(([seasonKey, epList]) => {
            const sNum = parseInt(seasonKey, 10);
            const validSNum = isNaN(sNum) || sNum < 0 ? 1 : sNum;

            if (Array.isArray(epList)) {
              const parsedEpisodes: TVSeriesEpisode[] = epList.map((epItem: any, epIdx: number) => {
                const epNum = parseInt(String(epItem.episode_num ?? epItem.episode_number ?? epIdx + 1), 10);
                const validEpNum = isNaN(epNum) || epNum <= 0 ? epIdx + 1 : epNum;

                const streamExt = epItem.container_extension || 'mp4';
                const streamId = epItem.id || epItem.stream_id || `${validSNum}-${validEpNum}`;
                const epStreamUrl = `${this.serverUrl}/series/${this.username}/${this.password}/${streamId}.${streamExt}`;

                let thumbnail = epItem.info?.movie_image || epItem.stream_icon || epItem.cover;
                let duration = epItem.info?.duration || epItem.duration;
                if (!duration && epItem.info?.duration_secs) {
                  duration = `${Math.round(parseInt(epItem.info.duration_secs, 10) / 60)}m`;
                }

                return {
                  id: `xtream-ep-${cleanId}-s${validSNum}-e${validEpNum}-${streamId}`,
                  title: epItem.title || epItem.name || `Épisode ${validEpNum}`,
                  episodeNumber: validEpNum,
                  seasonNumber: validSNum,
                  duration: duration || '45m',
                  overview: epItem.info?.plot || epItem.plot || epItem.description || '',
                  streamUrl: epStreamUrl,
                  thumbnail,
                };
              });

              if (!seasonsMap.has(validSNum)) {
                seasonsMap.set(validSNum, {
                  seasonNumber: validSNum,
                  title: `Saison ${validSNum}`,
                  name: `Saison ${validSNum}`,
                  episodes: parsedEpisodes,
                });
              } else {
                seasonsMap.get(validSNum)!.episodes = parsedEpisodes;
              }
            }
          });
        }
      }

      // Sort seasons and episodes cleanly in server order
      const resultSeasons = Array.from(seasonsMap.values())
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .map((s) => ({
          ...s,
          episodes: s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
        }));

      return resultSeasons;
    } catch (err) {
      console.error('Error fetching Xtream series info:', err);
      return [];
    }
  }
}
