import { EPGProgram } from '../types/iptv';

export function parseXmltvDate(str: string): number {
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

export class EPGService {
  public static getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
    const now = Date.now();
    return programs.find((p) => now >= p.start && now < p.end) || programs[0] || null;
  }

  public static getNextProgram(programs: EPGProgram[]): EPGProgram | null {
    const now = Date.now();
    const currentIndex = programs.findIndex((p) => now >= p.start && now < p.end);
    if (currentIndex !== -1 && currentIndex + 1 < programs.length) {
      return programs[currentIndex + 1];
    }
    return programs.find((p) => p.start > now) || null;
  }

  public static getProgressPercentage(program: EPGProgram): number {
    const now = Date.now();
    if (now <= program.start) return 0;
    if (now >= program.end) return 100;
    const total = program.end - program.start;
    const elapsed = now - program.start;
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }

  public static formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  public static formatDuration(startMs: number, endMs: number): string {
    const totalMins = Math.round((endMs - startMs) / (60 * 1000));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 0) {
      return `${hours}h ${mins.toString().padStart(2, '0')}m`;
    }
    return `${mins} min`;
  }

  public static getRemainingMinutes(program: EPGProgram): number {
    const now = Date.now();
    if (now >= program.end) return 0;
    return Math.max(0, Math.round((program.end - now) / (60 * 1000)));
  }

  public static parseXmltvText(xmlString: string): Record<string, EPGProgram[]> {
    if (!xmlString || xmlString.trim().length === 0) return {};
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const result: Record<string, EPGProgram[]> = {};

    const channelMap = new Map<string, string[]>();
    const channelNodes = xmlDoc.querySelectorAll('channel');
    channelNodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) return;
      const aliases: string[] = [id.toLowerCase()];
      node.querySelectorAll('display-name').forEach((dn) => {
        if (dn.textContent) {
          const nameClean = dn.textContent.trim().toLowerCase();
          aliases.push(nameClean);
          // Remove accents & special chars for matching
          aliases.push(nameClean.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        }
      });
      channelMap.set(id, aliases);
    });

    const programmeNodes = xmlDoc.querySelectorAll('programme');
    programmeNodes.forEach((pNode, index) => {
      const channelAttr = pNode.getAttribute('channel');
      const startAttr = pNode.getAttribute('start');
      const stopAttr = pNode.getAttribute('stop');
      if (!channelAttr || !startAttr || !stopAttr) return;

      const titleNode = pNode.querySelector('title');
      const descNode = pNode.querySelector('desc');
      const categoryNode = pNode.querySelector('category');
      const ratingNode = pNode.querySelector('rating value');

      const title = titleNode?.textContent || 'Programme';
      const description = descNode?.textContent || '';
      const category = categoryNode?.textContent || 'Généraliste';
      const rating = ratingNode?.textContent || '';

      const start = parseXmltvDate(startAttr);
      const end = parseXmltvDate(stopAttr);

      const prog: EPGProgram = {
        id: `xmltv-${channelAttr}-${index}`,
        channelId: channelAttr,
        title,
        description,
        start,
        end,
        category,
        rating,
      };

      const keysToAssign = new Set<string>([channelAttr, channelAttr.toLowerCase()]);
      const aliases = channelMap.get(channelAttr) || [];
      aliases.forEach((a) => keysToAssign.add(a));

      keysToAssign.forEach((key) => {
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(prog);
      });
    });

    Object.keys(result).forEach((k) => {
      result[k].sort((a, b) => a.start - b.start);
    });

    return result;
  }

  public static async fetchXmltvFR(): Promise<Record<string, EPGProgram[]>> {
    try {
      const isStaticHost = typeof window !== 'undefined' && (
        window.location.hostname.includes('github.io') || 
        window.location.hostname.includes('render.com') ||
        window.location.hostname.includes('pages.dev')
      );

      const url = isStaticHost 
        ? 'https://corsproxy.io/?url=' + encodeURIComponent('https://xmltvfr.fr/xmltv.php')
        : '/api/epg/xmltv';

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xmlText = await res.text();
      return EPGService.parseXmltvText(xmlText);
    } catch (e) {
      console.warn('[EPGService] XMLTV FR fetch warning:', e);
      return {};
    }
  }
}
