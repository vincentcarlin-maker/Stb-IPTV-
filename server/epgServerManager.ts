import zlib from 'node:zlib';
import { SaxesParser } from 'saxes';

export interface ServerEPGProgram {
  id: string;
  channelId: string;
  title: string;
  subTitle?: string;
  description?: string;
  start: number; // ms timestamp
  end: number;   // ms timestamp
  category?: string;
  episodeNum?: string;
  rating?: string;
  icon?: string;
}

export interface ServerEPGChannel {
  id: string;
  displayNames: string[];
  icon?: string;
}

export interface EPGStatus {
  status: 'idle' | 'updating' | 'error';
  lastUpdated: string | null;
  lastEtag: string | null;
  lastModifiedHeader: string | null;
  channelCount: number;
  programCount: number;
  defaultUrl: string;
  officialSourceUrl: string;
  error?: string;
}

function parseXmltvTimestamp(str: string): number {
  if (!str) return Date.now();
  const clean = str.trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return Date.now();
  const [_, y, m, d, hh, mm, ss, tz] = match;
  let iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  if (tz) {
    iso += `${tz.slice(0, 3)}:${tz.slice(3)}`;
  } else {
    iso += 'Z';
  }
  const parsed = Date.parse(iso);
  return isNaN(parsed) ? Date.now() : parsed;
}

function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fr\s*\|?|fhd|hd|uhd|4k|hevc|sd|vip|raw|1080p|720p|h\.?265)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_CHANNEL_ALIASES: Record<string, string[]> = {
  'tf1': ['tf 1', 'tf1 hd', 'tf1 fhd', 'tf1 4k', 'tf1 fr', 'tf1.fr'],
  'france2': ['france 2', 'fr2', 'france 2 hd', 'france 2 fhd', 'france 2 4k', 'france2.fr'],
  'france3': ['france 3', 'fr3', 'france 3 hd', 'france 3 fhd', 'france3.fr'],
  'canalplus': ['canal+', 'canal +', 'canal plus', 'canal+ hd', 'canalplus.fr'],
  'france5': ['france 5', 'fr5', 'france 5 hd', 'france5.fr'],
  'm6': ['m6 hd', 'm6 fhd', 'm6 4k', 'm6.fr'],
  'arte': ['arte fr', 'arte hd', 'arte france', 'arte.fr'],
  'c8': ['c 8', 'c8 hd', 'd8', 'c8.fr'],
  'w9': ['w 9', 'w9 hd', 'w9.fr'],
  'tmc': ['tmc hd', 'tmc.fr'],
  'tfx': ['nt1', 'tfx hd', 'tfx.fr'],
  'nrj12': ['nrj 12', 'nrj12 hd', 'nrj12.fr'],
  'lcp': ['lcp an', 'public senat', 'lcp.fr'],
  'france4': ['france 4', 'fr4', 'france4.fr'],
  'bfmtv': ['bfm tv', 'bfm tv hd', 'bfm news', 'bfmtv.fr'],
  'cnews': ['c news', 'i-tele', 'itele', 'cnews.fr'],
  'cstar': ['c star', 'd17', 'cstar.fr'],
  'gulli': ['gulli hd', 'gulli.fr'],
  'tf1seriesfilms': ['tf1 series films', 'hd1', 'tf1 séries films', 'tf1seriesfilms.fr'],
  'lequipe': ['l equipe', "l'equipe", "l'equipe 21", "l'équipe 21", 'lequipe.fr'],
  '6ter': ['6 ter', '6ter hd', '6ter.fr'],
  'rmcstory': ['rmc story', 'numéro 23', 'numero 23', 'rmcstory.fr'],
  'rmcdecouverte': ['rmc découverte', 'rmc decouverte', 'rmc decouverte 24', 'rmcdecouverte.fr'],
  'cherie25': ['chérie 25', 'cherie 25', 'cherie25.fr'],
  'lci': ['lci hd', 'lci.fr'],
  'franceinfo': ['france info', 'franceinfo:', 'franceinfo.fr'],
};

export class EPGServerManager {
  private static instance: EPGServerManager;

  private OFFICIAL_GZ_URL = 'https://xmltvfr.fr/xmltv/xmltv.xml.gz';
  private DISPLAY_URL = 'https://xmltvfr.fr/xmltv/xmltv.xml';

  private status: EPGStatus = {
    status: 'idle',
    lastUpdated: null,
    lastEtag: null,
    lastModifiedHeader: null,
    channelCount: 0,
    programCount: 0,
    defaultUrl: 'https://xmltvfr.fr/xmltv/xmltv.xml',
    officialSourceUrl: 'https://xmltvfr.fr/xmltv/xmltv.xml.gz',
  };

  private channelsMap = new Map<string, ServerEPGChannel>();
  private programmesMap = new Map<string, ServerEPGProgram[]>(); // channelId or alias key -> programmes
  private lastFetchTime = 0;
  private updateLock = false;

  private constructor() {}

  public static getInstance(): EPGServerManager {
    if (!EPGServerManager.instance) {
      EPGServerManager.instance = new EPGServerManager();
    }
    return EPGServerManager.instance;
  }

  public getStatus(): EPGStatus {
    return { ...this.status };
  }

  public getChannels(): ServerEPGChannel[] {
    return Array.from(this.channelsMap.values());
  }

  public getProgrammesForChannel(channelQuery: string, fromMs?: number, toMs?: number): ServerEPGProgram[] {
    if (!channelQuery) return [];
    const keyClean = channelQuery.trim().toLowerCase();
    const keyNorm = normalizeName(keyClean);

    let list = this.programmesMap.get(channelQuery) ||
               this.programmesMap.get(keyClean) ||
               this.programmesMap.get(keyNorm) || [];

    if (list.length === 0) {
      // Check alias matches
      for (const [aliasKey, aliasList] of Object.entries(DEFAULT_CHANNEL_ALIASES)) {
        if (aliasKey === keyNorm || aliasList.some(a => normalizeName(a) === keyNorm)) {
          list = this.programmesMap.get(aliasKey) || [];
          if (list.length > 0) break;
        }
      }
    }

    if (fromMs !== undefined || toMs !== undefined) {
      const from = fromMs || 0;
      const to = toMs || Number.MAX_SAFE_INTEGER;
      return list.filter(p => p.end >= from && p.start <= to);
    }

    return list;
  }

  public async refresh(force = false): Promise<EPGStatus> {
    if (this.updateLock) {
      return this.status;
    }

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const now = Date.now();
    if (!force && this.lastFetchTime > 0 && now - this.lastFetchTime < SIX_HOURS_MS) {
      return this.status;
    }

    this.updateLock = true;
    this.status.status = 'updating';

    try {
      const startTime = Date.now();
      const headers: Record<string, string> = {
        'User-Agent': 'iSTB-Pro-EPGServer/2.0 (gzip)',
        'Accept-Encoding': 'gzip, deflate',
      };

      if (this.status.lastEtag) {
        headers['If-None-Match'] = this.status.lastEtag;
      }
      if (this.status.lastModifiedHeader) {
        headers['If-Modified-Since'] = this.status.lastModifiedHeader;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000); // 45s timeout for 18MB download

      const res = await fetch(this.OFFICIAL_GZ_URL, {
        headers,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (res.status === 304) {
        this.status.status = 'idle';
        this.status.lastUpdated = new Date().toISOString();
        this.lastFetchTime = now;
        this.updateLock = false;
        console.log('[EPGServerManager] HTTP 304 Not Modified. Kept current EPG cache.');
        return this.status;
      }

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');

      // Streaming setup
      const gunzip = zlib.createGunzip();
      const saxParser = new SaxesParser({ xmlns: false });

      const newChannelsMap = new Map<string, ServerEPGChannel>();
      const newProgrammesMap = new Map<string, ServerEPGProgram[]>();

      let currentElement = '';
      let currentChannel: Partial<ServerEPGChannel> | null = null;
      let currentProgramme: Partial<ServerEPGProgram> | null = null;
      let textContent = '';

      const minAllowedStart = now - 6 * 60 * 60 * 1000; // keep programs started in last 6h
      const maxAllowedStart = now + 7 * 24 * 60 * 60 * 1000; // keep programs up to 7 days ahead

      saxParser.on('opentag', (node) => {
        currentElement = node.name;
        textContent = '';

        if (node.name === 'channel') {
          const id = (node.attributes.id as string) || '';
          currentChannel = { id, displayNames: [] };
        } else if (node.name === 'programme') {
          const channelId = (node.attributes.channel as string) || '';
          const startStr = (node.attributes.start as string) || '';
          const stopStr = (node.attributes.stop as string) || '';

          const start = parseXmltvTimestamp(startStr);
          const end = parseXmltvTimestamp(stopStr);

          if (end >= minAllowedStart && start <= maxAllowedStart) {
            currentProgramme = {
              id: `p-${channelId}-${start}`,
              channelId,
              start,
              end,
              title: '',
            };
          } else {
            currentProgramme = null;
          }
        } else if (node.name === 'icon') {
          const src = (node.attributes.src as string) || '';
          // Only store HTTPS icons to prevent mixed content
          if (src && src.startsWith('https://')) {
            if (currentProgramme) {
              currentProgramme.icon = src;
            } else if (currentChannel) {
              currentChannel.icon = src;
            }
          }
        }
      });

      saxParser.on('text', (text) => {
        textContent += text;
      });

      saxParser.on('closetag', (node) => {
        const val = textContent.trim();

        if (currentChannel) {
          if (node.name === 'display-name' && val) {
            currentChannel.displayNames?.push(val);
          } else if (node.name === 'channel') {
            if (currentChannel.id) {
              newChannelsMap.set(currentChannel.id, currentChannel as ServerEPGChannel);
            }
            currentChannel = null;
          }
        }

        if (currentProgramme) {
          if (node.name === 'title') {
            currentProgramme.title = val || 'Programme';
          } else if (node.name === 'sub-title') {
            currentProgramme.subTitle = val;
          } else if (node.name === 'desc') {
            currentProgramme.description = val;
          } else if (node.name === 'category') {
            currentProgramme.category = val;
          } else if (node.name === 'episode-num') {
            currentProgramme.episodeNum = val;
          } else if (node.name === 'programme') {
            if (currentProgramme.channelId && currentProgramme.title) {
              const prog = currentProgramme as ServerEPGProgram;
              const chId = prog.channelId;

              // Store under primary channel ID
              if (!newProgrammesMap.has(chId)) {
                newProgrammesMap.set(chId, []);
              }
              newProgrammesMap.get(chId)!.push(prog);

              // Index under lowercase channel ID & normalized name
              const chIdLower = chId.toLowerCase();
              if (chIdLower !== chId) {
                if (!newProgrammesMap.has(chIdLower)) newProgrammesMap.set(chIdLower, []);
                newProgrammesMap.get(chIdLower)!.push(prog);
              }
            }
            currentProgramme = null;
          }
        }
      });

      // Stream decompression and parsing
      // @ts-ignore
      const bodyNodeStream = res.body.pipe ? res.body : Readable.fromWeb(res.body as any);

      await new Promise<void>((resolve, reject) => {
        bodyNodeStream
          .pipe(gunzip)
          .on('data', (chunk: Buffer) => {
            try {
              saxParser.write(chunk.toString('utf-8'));
            } catch (err) {
              // Ignore non-fatal XML fragment warnings
            }
          })
          .on('end', () => {
            saxParser.close();
            resolve();
          })
          .on('error', (err: any) => {
            reject(err);
          });
      });

      // Index channels and programs with normalized aliases
      let totalProgs = 0;
      newProgrammesMap.forEach((progs, chKey) => {
        progs.sort((a, b) => a.start - b.start);
        totalProgs += progs.length;

        // Associate aliases
        const keyNorm = normalizeName(chKey);
        for (const [aliasKey, aliasList] of Object.entries(DEFAULT_CHANNEL_ALIASES)) {
          if (aliasKey === keyNorm || aliasList.some(a => normalizeName(a) === keyNorm)) {
            if (!newProgrammesMap.has(aliasKey)) {
              newProgrammesMap.set(aliasKey, progs);
            }
          }
        }
      });

      // Commit memory update
      this.channelsMap = newChannelsMap;
      this.programmesMap = newProgrammesMap;
      this.lastFetchTime = Date.now();

      this.status = {
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        lastEtag: etag || null,
        lastModifiedHeader: lastModified || null,
        channelCount: newChannelsMap.size,
        programCount: totalProgs,
        defaultUrl: this.DISPLAY_URL,
        officialSourceUrl: this.OFFICIAL_GZ_URL,
      };

      const durationMs = Date.now() - startTime;
      console.log(`[EPGServerManager] Refreshed XMLTV EPG in ${durationMs}ms. Channels: ${newChannelsMap.size}, Programmes: ${totalProgs}`);

    } catch (err: any) {
      console.warn('[EPGServerManager] Refresh warning:', err.message);
      this.status.status = 'error';
      this.status.error = err.message;
    } finally {
      this.updateLock = false;
    }

    return this.status;
  }
}
