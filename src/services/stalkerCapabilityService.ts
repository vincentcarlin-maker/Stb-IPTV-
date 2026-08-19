import { StalkerService } from './stalkerService';

export interface StalkerServerCapabilities {
  portalKey: string;             // Hostname / path identifier without credentials
  portalUrlMasked: string;       // Safe masked URL for diagnostics
  nativeHlsSupported?: boolean;  // true = HLS server supported, false = TS only / unsupported, undefined = unknown
  originalExtension: string;     // e.g. "ts"
  preferredExtension: string;    // "m3u8" | "ts" | "unknown"
  requiresProxy?: boolean;
  lastChecked: number;           // timestamp in ms
  confidence?: 'high' | 'probed' | 'fallback' | 'manual';
  testedChannelId?: string;
  channelOverrides?: Record<string, boolean>; // e.g. { "12345": false }
}

export interface StalkerHlsAudit {
  originalUrlMasked: string;
  finalUrlMasked: string;
  originalExtension: string;
  serverPreferredExtension: string;
  requestedExtension: string;
  onlyExtensionChanged: boolean;
  playTokenPreserved: boolean;
  macPreserved: boolean;
  streamIdPreserved: boolean;
  hostnameMatch: boolean;
  portMatch: boolean;
}

const STORAGE_KEY = 'istb_stalker_capabilities_v1';
const EXPIRATION_TIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class StalkerCapabilityService {
  /**
   * Derive a clean, sanitized portal key from portal URL (e.g. "mag.server.net:8080/c")
   * NEVER contains MAC, username, password, or token.
   */
  public static getPortalKey(portalUrl: string): string {
    if (!portalUrl) return 'unknown_portal';
    try {
      const url = new URL(portalUrl);
      const host = url.hostname.toLowerCase();
      const port = url.port ? `:${url.port}` : '';
      const path = url.pathname.replace(/\/+$/, '');
      return `${host}${port}${path}`;
    } catch {
      return portalUrl.replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase();
    }
  }

  /**
   * Return a safe masked portal URL for diagnostics
   */
  public static maskPortalUrl(portalUrl: string): string {
    if (!portalUrl) return 'MASKED_PORTAL';
    try {
      const url = new URL(portalUrl);
      return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/***`;
    } catch {
      return 'MASKED_PORTAL';
    }
  }

  /**
   * Load all saved portal capabilities from local storage
   */
  public static getAllCapabilities(): Record<string, StalkerServerCapabilities> {
    if (typeof window === 'undefined') return {};
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  /**
   * Retrieve capabilities for a specific portal
   */
  public static getCapabilities(portalUrl: string): StalkerServerCapabilities | null {
    if (!portalUrl) return null;
    const key = this.getPortalKey(portalUrl);
    const all = this.getAllCapabilities();
    return all[key] || null;
  }

  /**
   * Check if a capability profile has expired (> 7 days)
   */
  public static isExpired(cap: StalkerServerCapabilities | null): boolean {
    if (!cap) return true;
    if (cap.nativeHlsSupported === undefined) return true;
    const now = Date.now();
    return (now - (cap.lastChecked || 0)) > EXPIRATION_TIME_MS;
  }

  /**
   * Persist capability profile
   */
  public static saveCapabilities(cap: StalkerServerCapabilities): void {
    if (typeof window === 'undefined' || !cap.portalKey) return;
    try {
      const all = this.getAllCapabilities();
      all[cap.portalKey] = {
        ...all[cap.portalKey],
        ...cap,
        lastChecked: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('[StalkerCapability] Failed to save capability to localStorage:', e);
    }
  }

  /**
   * Clear capabilities for a specific portal or all portals
   */
  public static clearCapabilities(portalUrl?: string): void {
    if (typeof window === 'undefined') return;
    try {
      if (!portalUrl) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        const key = this.getPortalKey(portalUrl);
        const all = this.getAllCapabilities();
        delete all[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      }
    } catch (e) {
      console.warn('[StalkerCapability] Failed to clear capabilities:', e);
    }
  }

  /**
   * Set channel specific override (e.g. if a single channel fails HLS on a HLS-capable portal)
   */
  public static setChannelOverride(portalUrl: string, channelId: string, nativeHlsSupported: boolean): void {
    if (!portalUrl || !channelId) return;
    const key = this.getPortalKey(portalUrl);
    const all = this.getAllCapabilities();
    const existing = all[key] || {
      portalKey: key,
      portalUrlMasked: this.maskPortalUrl(portalUrl),
      originalExtension: 'ts',
      preferredExtension: nativeHlsSupported ? 'm3u8' : 'ts',
      lastChecked: Date.now(),
    };

    const overrides = existing.channelOverrides || {};
    overrides[channelId] = nativeHlsSupported;

    existing.channelOverrides = overrides;
    all[key] = existing;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  /**
   * Test HLS capability for a Stalker portal with a dedicated probe link
   * Protects the player's play_token by probing separately and verifying the true HLS manifest.
   */
  public static async testHlsCapability(
    stalkerService: StalkerService,
    sampleCmd: string
  ): Promise<StalkerServerCapabilities> {
    const portalUrl = (stalkerService as any).portalUrl || '';
    const portalKey = this.getPortalKey(portalUrl);
    const portalUrlMasked = this.maskPortalUrl(portalUrl);

    const defaultCap: StalkerServerCapabilities = {
      portalKey,
      portalUrlMasked,
      nativeHlsSupported: false,
      originalExtension: 'ts',
      preferredExtension: 'ts',
      lastChecked: Date.now(),
      confidence: 'fallback',
    };

    try {
      // 1. Generate a dedicated probe link using create_link
      const probeUrl = await stalkerService.createLink(sampleCmd);
      if (!probeUrl) {
        this.saveCapabilities(defaultCap);
        return defaultCap;
      }

      let parsedProbe: URL;
      try {
        parsedProbe = new URL(probeUrl);
      } catch {
        this.saveCapabilities(defaultCap);
        return defaultCap;
      }

      const origExt = parsedProbe.searchParams.get('extension') || 'ts';
      defaultCap.originalExtension = origExt;

      // Check if URL structure matches /play/live.php
      if (!parsedProbe.pathname.includes('/play/live.php') || origExt !== 'ts') {
        defaultCap.nativeHlsSupported = false;
        defaultCap.preferredExtension = origExt;
        this.saveCapabilities(defaultCap);
        return defaultCap;
      }

      // 2. Build test URL with extension=m3u8 using standard URL API
      parsedProbe.searchParams.set('extension', 'm3u8');
      const probeM3u8Url = parsedProbe.toString();

      // 3. Perform a lightweight probe request through stream proxy
      const isStaticDeploy = typeof window !== 'undefined' && (
        window.location.hostname.includes('github.io') || 
        window.location.hostname.includes('github.pages') ||
        window.location.hostname.includes('pages.dev') ||
        window.location.hostname.includes('netlify.app') ||
        window.location.hostname.includes('vercel.app')
      );

      const targetFetchUrl = isStaticDeploy
        ? `https://corsproxy.io/?url=${encodeURIComponent(probeM3u8Url)}`
        : `/api/proxy/stream?url=${encodeURIComponent(probeM3u8Url)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(targetFetchUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Range': 'bytes=0-1024',
        }
      }).finally(() => clearTimeout(timeoutId));

      if (response.ok || response.status === 206) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const textSample = await response.text().catch(() => '');

        const isHls = 
          contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.includes('application/x-mpegurl') ||
          contentType.includes('audio/x-mpegurl') ||
          textSample.trim().startsWith('#EXTM3U');

        if (isHls) {
          const cap: StalkerServerCapabilities = {
            portalKey,
            portalUrlMasked,
            nativeHlsSupported: true,
            originalExtension: 'ts',
            preferredExtension: 'm3u8',
            lastChecked: Date.now(),
            confidence: 'probed',
          };
          this.saveCapabilities(cap);
          return cap;
        }
      }

      // If probe failed or returned non-HLS content
      defaultCap.nativeHlsSupported = false;
      defaultCap.preferredExtension = 'ts';
      defaultCap.confidence = 'fallback';
      this.saveCapabilities(defaultCap);
      return defaultCap;
    } catch (err) {
      console.warn('[StalkerCapability] Auto-detection probe error:', err);
      this.saveCapabilities(defaultCap);
      return defaultCap;
    }
  }

  /**
   * Safely transforms a Stalker Live create_link URL into HLS (m3u8) if capabilities allow.
   * STRICT: ONLY changes extension parameter using URL API.
   */
  public static transformStalkerLiveUrl(
    dynamicUrl: string,
    capabilities: StalkerServerCapabilities | null,
    channelId?: string
  ): { finalUrl: string; audit: StalkerHlsAudit; transformed: boolean } {
    let finalUrl = dynamicUrl;
    let transformed = false;

    let originalExtension = 'ts';
    let requestedExtension = 'ts';
    let serverPreferredExtension = capabilities?.preferredExtension || 'm3u8';
    let macPreserved = true;
    let streamIdPreserved = true;
    let playTokenPreserved = true;
    let onlyExtensionChanged = true;
    let hostnameMatch = true;
    let portMatch = true;

    try {
      const parsed = new URL(dynamicUrl);
      originalExtension = parsed.searchParams.get('extension') || 'ts';
      requestedExtension = originalExtension;

      // Check channel override first
      const channelOverride = channelId && capabilities?.channelOverrides?.[channelId];
      const shouldAttemptHls = channelOverride !== false && (capabilities?.nativeHlsSupported !== false);

      if (
        shouldAttemptHls &&
        parsed.pathname.includes('/play/live.php') &&
        originalExtension === 'ts'
      ) {
        const macBefore = parsed.searchParams.get('mac');
        const streamBefore = parsed.searchParams.get('stream');
        const tokenBefore = parsed.searchParams.get('play_token') || parsed.searchParams.get('token');
        const hostBefore = parsed.hostname;
        const portBefore = parsed.port;

        // Perform safe URL transformation using searchParams.set
        parsed.searchParams.set('extension', 'm3u8');
        finalUrl = parsed.toString();
        transformed = true;
        requestedExtension = 'm3u8';

        const macAfter = parsed.searchParams.get('mac');
        const streamAfter = parsed.searchParams.get('stream');
        const tokenAfter = parsed.searchParams.get('play_token') || parsed.searchParams.get('token');
        const hostAfter = parsed.hostname;
        const portAfter = parsed.port;

        macPreserved = macBefore === macAfter;
        streamIdPreserved = streamBefore === streamAfter;
        playTokenPreserved = tokenBefore === tokenAfter;
        hostnameMatch = hostBefore === hostAfter;
        portMatch = portBefore === portAfter;
        onlyExtensionChanged = macPreserved && streamIdPreserved && playTokenPreserved && hostnameMatch && portMatch;
      }
    } catch (e) {
      console.warn('[StalkerCapability] URL parse error:', e);
    }

    const maskParams = (urlStr: string) => {
      return urlStr
        .replace(/(mac=)[^&]+/i, '$1MASKED')
        .replace(/(play_token=)[^&]+/i, '$1MASKED')
        .replace(/(token=)[^&]+/i, '$1MASKED');
    };

    const audit: StalkerHlsAudit = {
      originalUrlMasked: maskParams(dynamicUrl),
      finalUrlMasked: maskParams(finalUrl),
      originalExtension,
      serverPreferredExtension,
      requestedExtension,
      onlyExtensionChanged,
      playTokenPreserved,
      macPreserved,
      streamIdPreserved,
      hostnameMatch,
      portMatch,
    };

    return { finalUrl, audit, transformed };
  }

  /**
   * Log Stalker Server Capabilities diagnostic according to specifications
   */
  public static logCapabilitiesDiagnostic(
    capabilities: StalkerServerCapabilities | null,
    source: 'cache' | 'automatic-test' | 'channel-override' | 'manual' = 'cache'
  ): void {
    if (!capabilities) return;

    const dateStr = capabilities.lastChecked
      ? new Date(capabilities.lastChecked).toLocaleString('fr-FR')
      : 'Inconnue';

    console.log(`===== STALKER SERVER CAPABILITIES =====
Portal:
${capabilities.portalUrlMasked || capabilities.portalKey}

Capability cached:
${source === 'cache' ? 'Oui' : 'Non'}

Native HLS tested:
${capabilities.confidence === 'probed' || source === 'automatic-test' ? 'Oui' : 'Non'}

Native HLS supported:
${capabilities.nativeHlsSupported ? 'Oui' : 'Non'}

Preferred extension:
${capabilities.preferredExtension || (capabilities.nativeHlsSupported ? 'm3u8' : 'ts')}

Capability source:
${source}

Last check:
${dateStr}`);
  }

  /**
   * Log Stalker Playback Strategy diagnostic according to specifications
   */
  public static logPlaybackStrategyDiagnostic(params: {
    channelId: string;
    audit: StalkerHlsAudit;
    selectedPlayer: 'Safari Native HLS' | 'HLS.js' | 'Fallback Player';
    state: 'playing' | 'loading' | 'error';
  }): void {
    const { channelId, audit, selectedPlayer, state } = params;

    console.log(`===== STALKER PLAYBACK STRATEGY =====
Channel ID:
${channelId}

create_link:
Success

Original extension:
${audit.originalExtension}

Server preferred extension:
${audit.serverPreferredExtension}

Final requested extension:
${audit.requestedExtension}

Only extension changed:
${audit.onlyExtensionChanged ? 'Oui' : 'Non'}

play_token preserved:
${audit.playTokenPreserved ? 'Oui' : 'Non'}

MAC preserved:
${audit.macPreserved ? 'Oui' : 'Non'}

Stream ID preserved:
${audit.streamIdPreserved ? 'Oui' : 'Non'}

Selected player:
${selectedPlayer}

State:
${state}`);
  }
}
