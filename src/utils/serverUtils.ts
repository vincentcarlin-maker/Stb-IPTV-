import { ServerProfile } from '../types/iptv';

/**
 * Generates a unique, isolated cache key for a given server profile.
 * Incorporates server.id, server.type, connection URL, MAC address, and username.
 * Guarantees that every added server has its own isolated partition in IndexedDB and storage.
 */
export function getServerCacheKey(server?: Partial<ServerProfile> | null): string {
  if (!server) return 'srv_unknown';

  // 1. Primary identifier: server.id (e.g. 'demo-public-streams', 'srv-1724329201920')
  const idPart = server.id ? String(server.id).replace(/[^a-zA-Z0-9.-]/g, '_') : 'noid';

  // 2. Server type
  const typePart = server.type || 'unknown';

  // 3. Endpoint/connection details
  let endpointPart = '';
  if (server.portalUrl) {
    endpointPart = server.portalUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
  } else if (server.m3uUrl) {
    endpointPart = server.m3uUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  const macPart = server.macAddress ? `_${server.macAddress.replace(/[^a-zA-Z0-9]/g, '')}` : '';
  const userPart = server.username ? `_${server.username.replace(/[^a-zA-Z0-9]/g, '')}` : '';

  return `${idPart}__${typePart}${macPart}${userPart}_${endpointPart}`.slice(0, 150);
}
