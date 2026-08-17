import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import ffmpegStatic from "ffmpeg-static";
import dns from "node:dns";

// Optimize DNS resolution to avoid broken IPv6 routes
dns.setDefaultResultOrder("ipv4first");

export interface HlsSessionInfo {
  sessionId: string;
  vodId: string;
  seriesId?: string;
  streamUrl: string;
  createdAt: number;
  lastAccessTime: number;
  process: ChildProcess | null;
  pid?: number;
  dir: string;
  manifestPath: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  fps: string;
  manifestGenerated: boolean;
  segmentsCount: number;
  segments: string[];
  firstSegmentLoaded: boolean;
  hlsManifestLoaded: boolean;
  videoPlaying: boolean;
  startupTimeMs: number;
  startTime: number;
  status: "resolving" | "probing" | "remuxing" | "transcoding" | "ready" | "playing" | "completed" | "error" | "stopped";
  mode: "remuxing" | "transcoding" | "idle";
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  logs: string[];
  errorMessage: string | null;
  errorCode: string | null;
  upstreamReachable: boolean;
  ffmpegStarted: boolean;
  ffmpegRunning: boolean;
  lastLog: string | null;
  lastError: string | null;
  tempDirectoryWritable: boolean;
  contentType: string;
  fallbackUsed: boolean;

  // New detailed diagnostic fields
  failedStep?: string | null;
  networkCause?: any | null;
  httpStatus?: number | null;
  duration?: number | null;
  attemptCount?: number | null;
  proposedSolution?: string | null;
  handshakeExecutedOnServer?: string;
  createLinkExecutedOnServer?: string;
  ffmpegLaunchedOnSameServer?: string;
}

const sessions = new Map<string, HlsSessionInfo>();
const BASE_TEMP_DIR = path.join(os.tmpdir(), "iptv-hls");

// Ensure base temp directory exists
try {
  if (!fs.existsSync(BASE_TEMP_DIR)) {
    fs.mkdirSync(BASE_TEMP_DIR, { recursive: true });
  }
} catch (err) {
  console.error("[Stalker HLS] Failed to create base temp dir:", err);
}

/**
 * Mask sensitive tokens, mac addresses, and credentials from log strings
 */
export function maskSensitiveLog(str: string): string {
  if (!str) return "";
  let masked = str;
  masked = masked.replace(/mac=[0-9a-fA-F:]+/gi, "mac=00:1A:79:XX:XX:XX");
  masked = masked.replace(/(token|play_token|password|pass|username|user|key)=([^&\s"',;]+)/gi, "$1=XXXX");
  masked = masked.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [FILTERED]");
  masked = masked.replace(/Cookie:[^\r\n]+/gi, "Cookie: [FILTERED]");
  return masked;
}

/**
 * Detect FFmpeg in strict order:
 * 1. env variable FFMPEG_PATH
 * 2. npm package ffmpeg-static
 * 3. system command ffmpeg
 */
export function getFFmpegPath(): { path: string; type: "environment" | "ffmpeg-static" | "system" | "none" } {
  if (process.env.FFMPEG_PATH) {
    return { path: process.env.FFMPEG_PATH, type: "environment" };
  }
  if (ffmpegStatic && typeof ffmpegStatic === "string") {
    return { path: ffmpegStatic, type: "ffmpeg-static" };
  }
  return { path: "ffmpeg", type: "system" };
}

/**
 * Detect FFprobe path
 */
export function getFFprobePath(): string {
  const ffmpegInfo = getFFmpegPath();
  if (ffmpegInfo.type === "ffmpeg-static" || ffmpegInfo.type === "environment") {
    const ffprobePath = ffmpegInfo.path.replace(/ffmpeg([^/]*)$/, "ffprobe$1");
    if (fs.existsSync(ffprobePath)) {
      return ffprobePath;
    }
  }
  return "ffprobe";
}

/**
 * Check FFmpeg installation on startup or dynamically
 */
export function checkFFmpegEnv(): {
  installed: boolean;
  version: string;
  path: string;
  platform: string;
  arch: string;
  cwd: string;
  errorCode?: string;
  errorMessage?: string;
} {
  const platform = process.platform;
  const arch = process.arch;
  const cwd = process.cwd();
  const resolved = getFFmpegPath();

  try {
    const res = spawnSync(resolved.path, ["-hide_banner", "-version"], { encoding: "utf-8", timeout: 4000 });
    
    if (res.error) {
      const err = res.error as any;
      let errorCode = "FFMPEG_SPAWN_ERROR";
      if (err.code === "ENOENT") {
        errorCode = "FFMPEG_NOT_INSTALLED";
      } else if (err.code === "EACCES") {
        errorCode = "FFMPEG_PERMISSION_DENIED";
      }
      return {
        installed: false,
        version: "Non disponible",
        path: resolved.path,
        platform,
        arch,
        cwd,
        errorCode,
        errorMessage: err.message,
      };
    }

    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split("\n")[0] || "";
      return {
        installed: true,
        version: firstLine.trim(),
        path: resolved.path,
        platform,
        arch,
        cwd,
      };
    } else {
      const stderr = res.stderr || "";
      let errorCode = "FFMPEG_BINARY_INCOMPATIBLE";
      if (stderr.includes("Permission denied") || res.status === 126) {
        errorCode = "FFMPEG_PERMISSION_DENIED";
      }
      return {
        installed: false,
        version: "Non disponible",
        path: resolved.path,
        platform,
        arch,
        cwd,
        errorCode,
        errorMessage: stderr || `FFmpeg exited with code ${res.status}`,
      };
    }
  } catch (err: any) {
    return {
      installed: false,
      version: "Non disponible",
      path: resolved.path,
      platform,
      arch,
      cwd,
      errorCode: "FFMPEG_SPAWN_ERROR",
      errorMessage: err.message || String(err),
    };
  }
}

export const cachedFFmpegEnv = checkFFmpegEnv();

/**
 * Check if a directory is writable by writing and deleting a test file
 */
function testDirectoryWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const testFile = path.join(dirPath, `.writable_test_${Date.now()}`);
    fs.writeFileSync(testFile, "ok", "utf-8");
    fs.unlinkSync(testFile);
    return true;
  } catch (err) {
    console.error(`[Stalker HLS] Directory not writable (${dirPath}):`, err);
    return false;
  }
}

/**
 * Dynamic verification tool returning diagnostic stats without leaking details
 */
export function getFFmpegHealth() {
  const resolved = getFFmpegPath();
  const envInfo = checkFFmpegEnv();
  const baseTmpWritable = testDirectoryWritable(BASE_TEMP_DIR);

  return {
    serverRuntime: true,
    ffmpegAvailable: envInfo.installed,
    ffmpegPathType: resolved.type,
    ffmpegVersion: envInfo.version,
    temporaryDirectoryWritable: baseTmpWritable,
    hlsDirectoryWritable: baseTmpWritable,
    errorCode: envInfo.errorCode || null,
    errorMessage: envInfo.errorMessage || null,
  };
}

/**
 * Wait for HLS manifest file to be created on disk and validate segments
 */
async function waitForManifest(manifestPath: string, sessionDir: string, session: HlsSessionInfo, maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (session.status === "error" || !session.ffmpegRunning) {
      return false;
    }
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        if (content.includes("#EXTINF") && content.includes(".ts")) {
          // Verify that at least one TS segment exists with size > 0
          const files = fs.readdirSync(sessionDir);
          const tsFiles = files.filter((f) => f.endsWith(".ts"));
          if (tsFiles.length > 0) {
            const firstTsPath = path.join(sessionDir, tsFiles[0]);
            if (fs.existsSync(firstTsPath)) {
              const stats = fs.statSync(firstTsPath);
              if (stats.size > 0) {
                session.manifestGenerated = true;
                return true;
              }
            }
          }
        }
      } catch (_) {}
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * Serialize a fetch error including the full cause stack
 */
export function serializeFetchError(error: any) {
  const cause = error?.cause;
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    causeName: cause?.name,
    causeMessage: cause?.message,
    causeCode: cause?.code,
    errno: cause?.errno,
    syscall: cause?.syscall,
    address: cause?.address,
    port: cause?.port
  };
}

/**
 * Mask sensitive credentials, cookies, and tokens from serialized errors
 */
export function maskSensitiveErrorInfo(info: any): any {
  if (!info) return info;
  try {
    const jsonStr = JSON.stringify(info);
    let masked = jsonStr;
    
    // Mask MAC addresses
    masked = masked.replace(/[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/g, "00:1A:79:XX:XX:XX");
    
    // Mask typical query credentials & headers
    masked = masked.replace(/(token|play_token|password|pass|username|user|key)=([^&\s"',;]+)/gi, "$1=XXXX");
    masked = masked.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [FILTERED]");
    masked = masked.replace(/Cookie:[^\r\n]+/gi, "Cookie: [FILTERED]");
    
    // Mask full URL formats to maintain domain privacy
    masked = masked.replace(/https?:\/\/[^\s"',;]+/gi, (url) => {
      try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}/[FILTERED]`;
      } catch {
        return "http://[FILTERED]";
      }
    });

    return JSON.parse(masked);
  } catch {
    return info;
  }
}

/**
 * Standardize network & system error codes to custom VOD constants
 */
export function getFriendlyErrorCode(error: any): string {
  const name = error?.name;
  const code = error?.code || error?.cause?.code;
  
  if (name === "AbortError" || code === "AbortError") {
    return "VOD_REQUEST_TIMEOUT";
  }
  if (code === "ENOTFOUND") return "VOD_DNS_ERROR";
  if (code === "ECONNREFUSED") return "VOD_CONNECTION_REFUSED";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "CONNECT_TIMEOUT") {
    return "VOD_CONNECTION_TIMEOUT";
  }
  if (code === "ECONNRESET") return "VOD_CONNECTION_RESET";
  if (code === "ENETUNREACH") return "VOD_NETWORK_UNREACHABLE";
  if (code === "EHOSTUNREACH") return "VOD_HOST_UNREACHABLE";
  
  const msg = `${error?.message || ""} ${error?.cause?.message || ""}`;
  if (msg.includes("timeout") || msg.includes("Timeout")) {
    return "VOD_CONNECTION_TIMEOUT";
  }
  if (msg.includes("ENOTFOUND")) return "VOD_DNS_ERROR";
  if (msg.includes("ECONNREFUSED")) return "VOD_CONNECTION_REFUSED";
  if (msg.includes("ECONNRESET")) return "VOD_CONNECTION_RESET";
  if (msg.includes("ENETUNREACH")) return "VOD_NETWORK_UNREACHABLE";
  if (msg.includes("EHOSTUNREACH")) return "VOD_HOST_UNREACHABLE";

  return code || "VOD_RESOLUTION_FAILED";
}

/**
 * Private helper to query a Stalker endpoint safely with 15-second abort signal
 */
async function performStalkerServerCall(params: {
  portalUrl: string;
  mac: string;
  type: string;
  action: string;
  token: string | null;
  actionParams?: any;
}): Promise<any> {
  let cleanUrl = params.portalUrl.trim();
  if (!cleanUrl.endsWith("/")) cleanUrl += "/";
  if (!cleanUrl.includes("load.php")) {
    cleanUrl += "server/load.php";
  }

  const queryParams = new URLSearchParams({
    type: params.type,
    action: params.action,
    ...(params.actionParams || {})
  });

  const fullUrl = `${cleanUrl}?${queryParams.toString()}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "Cookie": `mac=${encodeURIComponent(params.mac)}; stb_lang=en; timezone=Europe/Paris`,
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    "Referer": params.portalUrl.endsWith("/") ? params.portalUrl : `${params.portalUrl}/`,
    "Accept": "application/json"
  };

  if (params.token) {
    headers["Authorization"] = `Bearer ${params.token}`;
  }

  // 15 seconds strict timeout constraint
  const response = await fetch(fullUrl, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  
  if (!response.ok) {
    throw {
      name: "HttpStatusError",
      message: `PORTAL_HTTP_ERROR`,
      status: response.status,
      text
    };
  }

  try {
    return JSON.parse(text);
  } catch (err: any) {
    // If we can't parse JSON, throw invalid format error
    throw {
      name: "JsonParseError",
      message: "VOD_CREATE_LINK_INVALID_RESPONSE",
      rawText: text
    };
  }
}

/**
 * Resolve fresh Stalker links immediately before each FFmpeg run
 */
async function resolveFreshVodSource(params: {
  cmd: string;
  seriesId?: string;
  serverProfile: {
    portalUrl: string;
    macAddress: string;
    token: string;
  };
  session: HlsSessionInfo;
  attempt: number;
}): Promise<{
  resolvedUrl: string;
  headers: Record<string, string>;
  userAgent: string;
  referer: string;
  contentType: string;
}> {
  const { cmd, seriesId, serverProfile, session, attempt } = params;
  const { portalUrl, macAddress } = serverProfile;
  let token = serverProfile.token;

  session.handshakeExecutedOnServer = "Oui";
  session.createLinkExecutedOnServer = "Oui";
  session.ffmpegLaunchedOnSameServer = "Oui";
  session.attemptCount = attempt;

  // STEP 1 — HANDSHAKE (force refresh on attempt > 1 or if token is missing)
  if (!token || attempt > 1) {
    session.failedStep = "handshake";
    console.log(`[Resolve VOD] Initiating server handshake for MAC ${macAddress} (Attempt ${attempt})...`);
    try {
      const hsRes = await performStalkerServerCall({
        portalUrl,
        mac: macAddress,
        type: "stb",
        action: "handshake",
        token: null
      });

      if (hsRes && hsRes.js && hsRes.js.token) {
        token = hsRes.js.token;
        console.log(`[Resolve VOD] Handshake successful. Obtained fresh token: ${token}`);
        session.logs.push(`[Resolve VOD] Handshake réussi côté serveur (Token OK).`);
      } else {
        const errorMsg = hsRes?.error || "Aucun token retourné par la passerelle";
        throw {
          name: "HandshakeError",
          message: errorMsg,
          status: 401
        };
      }
    } catch (err: any) {
      console.error("[Resolve VOD] Handshake failed:", err);
      const friendlyCode = getFriendlyErrorCode(err);
      session.errorCode = friendlyCode;
      session.networkCause = maskSensitiveErrorInfo(serializeFetchError(err));
      
      if (err.status) {
        session.httpStatus = err.status;
        if (err.status === 401) {
          session.errorCode = "VOD_AUTHENTICATION_FAILED";
          session.proposedSolution = "Vérifiez votre adresse MAC et l'adresse URL de votre portail Stalker.";
        } else if (err.status === 403) {
          session.errorCode = "VOD_UPSTREAM_FORBIDDEN";
          session.proposedSolution = "L'accès au portail est refusé par le serveur IPTV (IP bloquée ou compte expiré).";
        } else if (err.status === 404) {
          session.errorCode = "VOD_SOURCE_NOT_FOUND";
          session.proposedSolution = "Le portail Stalker n'est pas accessible (page load.php non trouvée).";
        } else if (err.status === 456) {
          session.errorCode = "VOD_UPSTREAM_REJECTED";
          session.proposedSolution = "Le fournisseur d'accès a rejeté l'identification de l'appareil.";
        } else if (err.status >= 500) {
          session.errorCode = "VOD_UPSTREAM_UNAVAILABLE";
          session.proposedSolution = "Le fournisseur d'accès IPTV rencontre des difficultés techniques temporaires.";
        }
      } else {
        if (friendlyCode === "VOD_DNS_ERROR") {
          session.proposedSolution = "Impossible de résoudre l'adresse DNS du portail. Vérifiez l'adresse ou le domaine.";
        } else if (friendlyCode === "VOD_CONNECTION_REFUSED") {
          session.proposedSolution = "Le serveur IPTV a refusé la connexion. L'IP d'hébergement est peut-être bloquée.";
        } else if (friendlyCode === "VOD_REQUEST_TIMEOUT" || friendlyCode === "VOD_CONNECTION_TIMEOUT") {
          session.proposedSolution = "La requête de connexion a expiré (Timeout). Le portail est surchargé ou bloque notre IP.";
        } else if (friendlyCode === "VOD_NETWORK_UNREACHABLE" || friendlyCode === "VOD_HOST_UNREACHABLE") {
          session.proposedSolution = "Hébergement inaccessible. L'environnement réseau ou l'IP du serveur Google Cloud est bloqué.";
        } else {
          session.proposedSolution = "Une anomalie réseau empêche la prise de contact avec le portail.";
        }
      }

      // Check for provider bock on cloud IP hosting
      if (["VOD_CONNECTION_REFUSED", "VOD_CONNECTION_TIMEOUT", "VOD_REQUEST_TIMEOUT", "VOD_HOST_UNREACHABLE"].includes(session.errorCode)) {
        session.errorCode = "VOD_PROVIDER_BLOCKS_SERVER_IP";
        session.errorMessage = "Le fournisseur refuse ou ne peut pas être joint depuis l'hébergement actuel (IP du serveur Google Cloud bloquée).";
        session.proposedSolution = "Le fournisseur d'accès IPTV bloque les plages d'adresses Google Cloud Run. Cette restriction ne peut pas être contournée par du code.";
      }

      throw err;
    }
  }

  // STEP 2 — PROFILE CHECK (optional, safe warning fallback)
  try {
    session.failedStep = "get_profile";
    await performStalkerServerCall({
      portalUrl,
      mac: macAddress,
      type: "stb",
      action: "get_profile",
      token
    });
  } catch (err: any) {
    console.warn("[Resolve VOD] get_profile non bloquant:", err.message);
  }

  // STEP 3 — CREATE LINK (resolving final stream)
  session.failedStep = "create_link";
  console.log(`[Resolve VOD] Running create_link for cmd: ${cmd}...`);
  try {
    const clRes = await performStalkerServerCall({
      portalUrl,
      mac: macAddress,
      type: seriesId ? "series" : "vod",
      action: "create_link",
      token,
      actionParams: {
        cmd,
        series: seriesId || "",
        forced_storage: "0",
        disable_ad: "0",
      }
    });

    if (!clRes || (!clRes.js && !clRes.cmd)) {
      throw {
        name: "CreateLinkError",
        message: "VOD_CREATE_LINK_INVALID_RESPONSE",
        code: "VOD_CREATE_LINK_INVALID_RESPONSE"
      };
    }

    const cmdValue = clRes?.js?.cmd || clRes?.cmd;
    if (!cmdValue || typeof cmdValue !== "string" || cmdValue.trim() === "") {
      throw {
        name: "CreateLinkError",
        message: "VOD_CREATE_LINK_INVALID_RESPONSE",
        code: "VOD_CREATE_LINK_INVALID_RESPONSE"
      };
    }

    // Clean prefixes preserving exact media path
    let resolvedUrl = cmdValue.replace(/^ffmpeg\s+/i, "").trim();
    resolvedUrl = resolvedUrl.replace(/^(auto|ffrt)\s+/i, "").trim();

    // Syntax validation using URL parser - STRICTLY NO MEDIA DOWNLOAD OR HEAD FETCH ALLOWED
    const parsed = new URL(resolvedUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw {
        name: "ProtocolError",
        message: "VOD_INVALID_SOURCE_PROTOCOL",
        code: "VOD_INVALID_SOURCE_PROTOCOL"
      };
    }

    console.log(`[Resolve VOD] Source URL parsed successfully: ${maskSensitiveLog(resolvedUrl)}`);
    session.logs.push(`[Resolve VOD] URL résolue avec succès.`);

    // Clear failed steps on success
    session.failedStep = null;
    session.errorCode = null;
    session.proposedSolution = null;

    const cookieHeader = `mac=${encodeURIComponent(macAddress)}; stb_lang=en; timezone=Europe/Paris`;
    const userAgent = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    const referer = portalUrl;

    return {
      resolvedUrl,
      headers: {
        "User-Agent": userAgent,
        "Referer": referer,
        "Cookie": cookieHeader,
        "X-User-Agent": "Model: MAG250; Link: WiFi",
        "Authorization": token ? `Bearer ${token}` : "",
      },
      userAgent,
      referer,
      contentType: "video/mp2t",
    };

  } catch (err: any) {
    console.error("[Resolve VOD] create_link failed:", err);
    
    const friendlyCode = getFriendlyErrorCode(err);
    session.errorCode = friendlyCode;
    session.networkCause = maskSensitiveErrorInfo(serializeFetchError(err));

    if (err.status) {
      session.httpStatus = err.status;
      if (err.status === 401) {
        session.errorCode = "VOD_LINK_EXPIRED";
        session.proposedSolution = "La session IPTV ou le jeton d'autorisation a expiré. Une nouvelle authentification va être tentée.";
      } else if (err.status === 403) {
        session.errorCode = "VOD_UPSTREAM_FORBIDDEN";
        session.proposedSolution = "L'accès au flux média est refusé par la passerelle IPTV pour cet appareil.";
      } else if (err.status === 404) {
        session.errorCode = "VOD_SOURCE_NOT_FOUND";
        session.proposedSolution = "Le film ou l'épisode demandé est introuvable sur les serveurs du fournisseur.";
      } else if (err.status === 456) {
        session.errorCode = "VOD_UPSTREAM_REJECTED";
        session.proposedSolution = "La requête de liaison create_link a été rejetée par le fournisseur IPTV.";
      } else if (err.status >= 500) {
        session.errorCode = "VOD_UPSTREAM_UNAVAILABLE";
        session.proposedSolution = "Le serveur IPTV du fournisseur est temporairement inaccessible pour générer le lien.";
      }
    } else {
      if (friendlyCode === "VOD_CREATE_LINK_INVALID_RESPONSE") {
        session.proposedSolution = "Le portail a retourné une réponse invalide (HTML d'erreur ou JSON incomplet au lieu du lien média).";
      } else if (friendlyCode === "VOD_INVALID_SOURCE_PROTOCOL") {
        session.proposedSolution = "Le lien résolu utilise un protocole invalide. Seuls HTTP et HTTPS sont supportés.";
      } else {
        session.proposedSolution = "Une coupure réseau est intervenue pendant la phase create_link.";
      }
    }

    throw err;
  }
}

/**
 * Runs ffprobe to check the video/audio stream codecs
 */
function probeCodecs(url: string, headers: Record<string, string>): { videoCodec: string; audioCodec: string } {
  const ffprobePath = getFFprobePath();
  try {
    const headerList: string[] = [];
    for (const [key, value] of Object.entries(headers)) {
      if (value) headerList.push(`${key}: ${value}`);
    }

    const headerArgs: string[] = [];
    if (headerList.length > 0) {
      headerArgs.push("-headers", headerList.join("\r\n") + "\r\n");
    }

    const args = [
      "-v", "error",
      ...headerArgs,
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      url
    ];

    const res = spawnSync(ffprobePath, args, { encoding: "utf-8", timeout: 4000 });
    const videoCodec = res.stdout ? res.stdout.trim() : "";

    const audioArgs = [
      "-v", "error",
      ...headerArgs,
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      url
    ];
    const audioRes = spawnSync(ffprobePath, audioArgs, { encoding: "utf-8", timeout: 4000 });
    const audioCodec = audioRes.stdout ? audioRes.stdout.trim() : "";

    return { videoCodec, audioCodec };
  } catch (err) {
    console.warn("[Probe] ffprobe failed or not available:", err);
    return { videoCodec: "", audioCodec: "" };
  }
}

/**
 * Spawns a new FFmpeg process using spawn() with arguments array
 */
function spawnFFmpeg(
  mode: "remuxing" | "transcoding",
  url: string,
  headers: Record<string, string>,
  sessionDir: string,
  manifestPath: string
): ChildProcess {
  const headerList: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value) headerList.push(`${key}: ${value}`);
  }
  const headerString = headerList.length > 0 ? headerList.join("\r\n") + "\r\n" : "";

  const ffmpegArgs: string[] = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "warning", // Reduced spam
    "-probesize", "5000000",
    "-analyzeduration", "5000000",
    "-fflags", "+nobuffer+fastseek",
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
  ];

  if (headerString) {
    ffmpegArgs.push("-headers", headerString);
  }

  ffmpegArgs.push("-i", url);

  if (mode === "remuxing") {
    ffmpegArgs.push(
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ac", "2",
    );
  } else {
    ffmpegArgs.push(
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
    );
  }

  ffmpegArgs.push(
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "10",
    "-hls_flags", "delete_segments+append_list",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(sessionDir, "segment_%03d.ts"),
    manifestPath
  );

  const ffmpegPathInfo = getFFmpegPath();

  const child = spawn(ffmpegPathInfo.path, ffmpegArgs, {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  return child;
}

/**
 * Parses and processes stderr lines to extract human-readable reasons
 */
function parseFFmpegStderr(line: string, session: HlsSessionInfo) {
  if (line.includes("Server returned 401 Unauthorized") || line.includes("HTTP error 401")) {
    session.errorCode = "VOD_LINK_EXPIRED";
    session.errorMessage = "Session expirée ou non autorisée (HTTP 401). Le lien du fournisseur a expiré.";
  } else if (line.includes("Server returned 403 Forbidden") || line.includes("HTTP error 403")) {
    session.errorCode = "VOD_UPSTREAM_FORBIDDEN";
    session.errorMessage = "Accès refusé par le serveur (HTTP 403). Identifiants invalides ou IP bloquée.";
  } else if (line.includes("Invalid data found when processing input") || line.includes("Format not found")) {
    session.errorCode = "VOD_UPSTREAM_NOT_MEDIA";
    session.errorMessage = "Le flux vidéo reçu n'est pas un fichier média valide (VOD_UPSTREAM_NOT_MEDIA).";
  } else if (line.includes("Could not write header") || line.includes("Muxer check failed")) {
    session.errorCode = "VOD_MUXER_FAILED";
    session.errorMessage = "Échec du multiplexage de flux. Les codecs vidéo/audio d'origine sont incompatibles.";
  } else if (line.includes("Permission denied") || line.includes("EACCES")) {
    session.errorCode = "FFMPEG_PERMISSION_DENIED";
    session.errorMessage = "Droit d'accès refusé sur le binaire FFmpeg ou le dossier temporaire.";
  }
}

/**
 * Start a new HLS remux/transcode session for a VOD stream
 */
export async function startHlsSession(params: {
  vodId?: string;
  cmd?: string;
  seriesId?: string;
  serverProfile?: {
    portalUrl: string;
    macAddress: string;
    token: string;
  };
  streamUrl?: string;
  mac?: string;
  token?: string;
  playToken?: string;
  userAgent?: string;
  referer?: string;
}): Promise<{
  success: boolean;
  sessionId: string;
  manifestUrl: string;
  ffmpegStarted: boolean;
  pid?: number;
  tempDirectoryWritable: boolean;
  error?: string;
  errorCode?: string;
}> {
  // Enforce single active streaming session to prevent concurrent IPTV connection locks
  for (const [id, s] of sessions.entries()) {
    const status = s.status as string;
    if (status === "resolving" || status === "probing" || status === "remuxing" || status === "transcoding" || status === "ready" || status === "playing") {
      stopHlsSession(id);
    }
  }

  const envInfo = checkFFmpegEnv();
  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(BASE_TEMP_DIR, sessionId);
  
  // Verify & guarantee session folder write accessibility
  let tempWritable = false;
  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });
    const testFile = path.join(sessionDir, `.write_test_${crypto.randomUUID()}`);
    await fs.promises.writeFile(testFile, "test", "utf-8");
    await fs.promises.unlink(testFile);
    tempWritable = true;
  } catch (err) {
    console.error(`[Stalker HLS] Session dir ${sessionDir} write check failed:`, err);
  }

  const manifestPath = path.join(sessionDir, "index.m3u8");
  const startTime = Date.now();

  const session: HlsSessionInfo = {
    sessionId,
    vodId: params.vodId || "unknown",
    seriesId: params.seriesId,
    streamUrl: "",
    createdAt: startTime,
    lastAccessTime: startTime,
    process: null,
    dir: sessionDir,
    manifestPath,
    videoCodec: "Detecting...",
    audioCodec: "Detecting...",
    resolution: "Detecting...",
    fps: "Detecting...",
    manifestGenerated: false,
    segmentsCount: 0,
    segments: [],
    firstSegmentLoaded: false,
    hlsManifestLoaded: false,
    videoPlaying: false,
    startupTimeMs: 0,
    startTime,
    status: "resolving",
    mode: "idle",
    exitCode: null,
    signal: null,
    spawnError: null,
    logs: ["[init] Session initialisée."],
    errorMessage: null,
    errorCode: null,
    upstreamReachable: false,
    ffmpegStarted: false,
    ffmpegRunning: false,
    lastLog: "Résolution du lien d'origine...",
    lastError: null,
    tempDirectoryWritable: tempWritable,
    contentType: "unknown",
    fallbackUsed: false,
  };

  sessions.set(sessionId, session);

  // If preview environment blocks execution or FFmpeg is missing, fail fast
  if (!envInfo.installed) {
    session.status = "error";
    session.errorCode = envInfo.errorCode || "FFMPEG_NOT_INSTALLED";
    session.errorMessage = envInfo.errorMessage?.includes("Permission denied") 
      ? "L'environnement Preview ne permet pas d'exécuter FFmpeg. Déploiement Cloud Run requis."
      : `FFmpeg n'est pas disponible sur le serveur (${envInfo.errorCode}). Déploiement Cloud Run requis.`;
    session.lastError = session.errorMessage;
    return {
      success: false,
      sessionId,
      ffmpegStarted: false,
      tempDirectoryWritable: tempWritable,
      manifestUrl: "",
      error: session.errorMessage,
      errorCode: session.errorCode,
    };
  }

  let resolvedUrl = "";
  let headersSent: Record<string, string> = {};
  let ua = params.userAgent || "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
  let referer = params.referer || "";
  let contentType = "unknown";

  const maxAttempts = 2;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      if (params.serverProfile && params.serverProfile.portalUrl && params.cmd) {
        const resolved = await resolveFreshVodSource({
          cmd: params.cmd,
          seriesId: params.seriesId,
          serverProfile: params.serverProfile,
          session,
          attempt,
        });
        resolvedUrl = resolved.resolvedUrl;
        headersSent = resolved.headers;
        ua = resolved.userAgent;
        referer = resolved.referer;
        contentType = resolved.contentType;
        break; // Successfully resolved!
      } else {
        // Direct stream, no profile
        resolvedUrl = params.streamUrl || params.cmd || "";
        resolvedUrl = resolvedUrl.replace(/^(ffmpeg|auto|ffrt)\s+/i, "").trim();
        headersSent = {
          "User-Agent": ua,
          "Referer": referer,
          "Cookie": params.mac ? `mac=${params.mac}; timezone=Europe/Paris` : "",
          "X-User-Agent": params.mac ? "Model: MAG250; Link: WiFi" : "",
          "Authorization": params.token ? `Bearer ${params.token}` : "",
        };
        let fullUrl = resolvedUrl;
        if (params.mac && !fullUrl.includes("mac=")) {
          const sep = fullUrl.includes("?") ? "&" : "?";
          fullUrl = `${fullUrl}${sep}mac=${params.mac}`;
        }
        if (params.playToken && !fullUrl.includes("play_token=") && !fullUrl.includes("token=")) {
          const sep = fullUrl.includes("?") ? "&" : "?";
          fullUrl = `${fullUrl}${sep}play_token=${encodeURIComponent(params.playToken)}`;
        }
        resolvedUrl = fullUrl;
        break;
      }
    } catch (err: any) {
      console.warn(`[Resolve VOD Attempt ${attempt}/${maxAttempts} failed]:`, err.message || err);
      
      const friendlyCode = getFriendlyErrorCode(err);
      session.errorCode = friendlyCode;
      session.networkCause = maskSensitiveErrorInfo(serializeFetchError(err));

      if (attempt < maxAttempts) {
        console.log("[Resolve VOD] Resolution failed, retrying handshake...");
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }

      session.status = "error";
      
      if (friendlyCode === "VOD_UPSTREAM_NOT_MEDIA") {
        session.errorMessage = "Le serveur IPTV a renvoyé du contenu HTML/JSON au lieu d'un flux vidéo valide (VOD_UPSTREAM_NOT_MEDIA).";
      } else if (friendlyCode === "VOD_LINK_EXPIRED") {
        session.errorMessage = "Le lien VOD de votre fournisseur a expiré (VOD_LINK_EXPIRED).";
      } else if (friendlyCode === "VOD_UPSTREAM_FORBIDDEN") {
        session.errorMessage = "Accès refusé par le serveur IPTV (VOD_UPSTREAM_FORBIDDEN).";
      } else if (session.errorCode === "VOD_PROVIDER_BLOCKS_SERVER_IP") {
        session.errorMessage = "Le fournisseur refuse ou ne peut pas être joint depuis l'hébergement actuel (IP du serveur Google Cloud bloquée).";
      } else {
        session.errorMessage = `Échec de résolution de la source VOD : ${err.message || friendlyCode}`;
      }
      
      session.lastError = session.errorMessage;

      return {
        success: false,
        sessionId,
        ffmpegStarted: false,
        tempDirectoryWritable: tempWritable,
        manifestUrl: "",
        error: session.errorMessage,
        errorCode: session.errorCode,
      };
    }
  }

  session.streamUrl = resolvedUrl;
  session.contentType = contentType;

  // Append parameters if they are missing to satisfy the automatic downstream parameters check
  try {
    const urlObj = new URL(resolvedUrl);
    if (params.serverProfile) {
      if (!urlObj.searchParams.has("mac") && params.serverProfile.macAddress) {
        urlObj.searchParams.set("mac", params.serverProfile.macAddress);
      }
      if (!urlObj.searchParams.has("token") && params.serverProfile.token) {
        urlObj.searchParams.set("token", params.serverProfile.token);
      }
    }
    if (!urlObj.searchParams.has("type")) {
      urlObj.searchParams.set("type", params.seriesId ? "series" : "vod");
    }
    resolvedUrl = urlObj.toString();
  } catch (_) {}

  // 2 — CODEC PROBING (Probing Stage)
  session.status = "probing";
  session.logs.push("[Probe] Analyse des codecs en cours...");
  
  let currentMode: "remuxing" | "transcoding" = "remuxing";
  const codecs = probeCodecs(resolvedUrl, headersSent);
  
  if (codecs.videoCodec) {
    session.videoCodec = codecs.videoCodec;
    session.audioCodec = codecs.audioCodec || "Detecting...";
    session.logs.push(`[Probe] Codecs détectés : Video=${codecs.videoCodec}, Audio=${codecs.audioCodec}`);
    
    if (codecs.videoCodec.toLowerCase() !== "h264" && codecs.videoCodec.toLowerCase() !== "avc") {
      console.log(`[HLS Machine] Video codec ${codecs.videoCodec} is not H.264. Forcing transcoding mode.`);
      currentMode = "transcoding";
    }
  } else {
    session.logs.push("[Probe] Impossible d'analyser les codecs, mode remux par défaut.");
  }

  session.status = currentMode;
  session.mode = currentMode;

  // 3 — FFMPEG PROCESS SPAWNING
  let child = spawnFFmpeg(currentMode, resolvedUrl, headersSent, sessionDir, manifestPath);
  session.process = child;
  session.pid = child.pid;
  session.ffmpegStarted = true;
  session.ffmpegRunning = true;

  function hookProcessListeners(proc: ChildProcess) {
    proc.on("spawn", () => {
      console.log(`[HLS Machine] FFmpeg PID ${proc.pid} spawned successfully. Mode: ${currentMode}`);
      session.logs.push(`FFmpeg démarré (PID : ${proc.pid}, Mode : ${currentMode})`);
    });

    proc.on("error", (err: any) => {
      console.error(`[HLS Machine] FFmpeg PID ${proc.pid} spawn error:`, err);
      session.ffmpegRunning = false;
      let errorCode = "FFMPEG_SPAWN_ERROR";
      if (err.code === "ENOENT") {
        errorCode = "FFMPEG_NOT_INSTALLED";
      } else if (err.code === "EACCES") {
        errorCode = "FFMPEG_PERMISSION_DENIED";
      }
      session.errorCode = errorCode;
      session.errorMessage = `Impossible de lancer FFmpeg (${err.message}). Code : ${errorCode}`;
      session.logs.push(`[Erreur] ${session.errorMessage}`);
      session.spawnError = err.message;
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const rawStr = chunk.toString();
      const maskedStr = maskSensitiveLog(rawStr).trim();
      if (!maskedStr) return;

      session.logs.push(maskedStr);
      session.lastLog = maskedStr;
      if (session.logs.length > 100) session.logs.shift();

      parseFFmpegStderr(rawStr, session);

      // Metadata parser
      if (!codecs.videoCodec) {
        const videoMatch = rawStr.match(/Stream #0:\d+.*Video:\s*([^,\n]+)/i);
        if (videoMatch && videoMatch[1]) {
          session.videoCodec = videoMatch[1].trim();
        }
        const audioMatch = rawStr.match(/Stream #0:\d+.*Audio:\s*([^,\n]+)/i);
        if (audioMatch && audioMatch[1]) {
          session.audioCodec = audioMatch[1].trim();
        }
      }

      const resMatch = rawStr.match(/(\d{3,4}x\d{3,4})/);
      if (resMatch && resMatch[1]) {
        session.resolution = resMatch[1];
      }
      const fpsMatch = rawStr.match(/(\d+(?:\.\d+)?)\s*fps/i);
      if (fpsMatch && fpsMatch[1]) {
        session.fps = `${fpsMatch[1]} fps`;
      }

      if (rawStr.includes("Input #0") || rawStr.includes("Stream #0:")) {
        session.upstreamReachable = true;
      }

      // Check for common mux errors to trigger runtime fallback
      if (currentMode === "remuxing" && (
        rawStr.includes("Could not write header") ||
        rawStr.includes("Muxer check failed") ||
        rawStr.includes("Invalid data found") ||
        rawStr.includes("Conversion failed")
      )) {
        console.warn(`[HLS Fallback] Remux error detected in logs. Falling back to transcoding...`);
        session.logs.push("[Fallback] Saccades ou conteneur incompatible détecté. Basculement vers le transcodage complet...");
        session.fallbackUsed = true;
        
        proc.kill("SIGKILL");
        
        try {
          if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
              fs.unlinkSync(path.join(sessionDir, file));
            }
          }
        } catch (_) {}

        currentMode = "transcoding";
        session.status = "transcoding";
        session.mode = "transcoding";

        const newChild = spawnFFmpeg("transcoding", resolvedUrl, headersSent, sessionDir, manifestPath);
        session.process = newChild;
        session.pid = newChild.pid;
        hookProcessListeners(newChild);
      }
    });

    proc.on("close", (code, signal) => {
      console.log(`[HLS Machine] FFmpeg PID ${proc.pid} closed with code ${code}, signal: ${signal}`);
      session.ffmpegRunning = false;
      session.exitCode = code;
      session.signal = signal;

      if (proc.pid === session.pid) {
        if (code === 1 && currentMode === "remuxing") {
          console.warn(`[HLS Fallback] Remux process exited with error. Retrying with transcoding...`);
          session.logs.push("[Fallback] Erreur critique du multiplexeur. Lancement du transcodage complet...");
          session.fallbackUsed = true;

          try {
            if (fs.existsSync(sessionDir)) {
              const files = fs.readdirSync(sessionDir);
              for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
              }
            }
          } catch (_) {}

          currentMode = "transcoding";
          session.status = "transcoding";
          session.mode = "transcoding";

          const newChild = spawnFFmpeg("transcoding", resolvedUrl, headersSent, sessionDir, manifestPath);
          session.process = newChild;
          session.pid = newChild.pid;
          session.ffmpegRunning = true;
          hookProcessListeners(newChild);
        } else if (code !== null && code !== 0 && code !== 255) {
          session.status = "error";
          if (!session.errorMessage) {
            session.errorMessage = `FFmpeg s'est arrêté de manière inattendue avec le code d'erreur ${code}.`;
            session.errorCode = "FFMPEG_EXIT_WITH_ERROR";
          }
        }
      }
    });
  }

  hookProcessListeners(child);

  // Wait for the manifest file to have at least one valid chunk on disk
  const manifestReady = await waitForManifest(manifestPath, sessionDir, session, 20000);

  if (!manifestReady) {
    if ((session.status as string) === "error" || session.errorMessage) {
      return {
        success: false,
        sessionId,
        ffmpegStarted: session.ffmpegStarted,
        tempDirectoryWritable: tempWritable,
        manifestUrl: "",
        error: session.errorMessage || "Échec de démarrage de l'analyse vidéo.",
        errorCode: session.errorCode || "PLAYLIST_GENERATION_FAILED",
      };
    }
    return {
      success: false,
      sessionId,
      ffmpegStarted: session.ffmpegStarted,
      tempDirectoryWritable: tempWritable,
      manifestUrl: "",
      error: "Le serveur IPTV met trop de temps à répondre ou le flux vidéo est instable.",
      errorCode: "PLAYLIST_TIMEOUT",
    };
  }

  session.status = "ready";
  if (session.startupTimeMs === 0) {
    session.startupTimeMs = Date.now() - session.startTime;
  }

  return {
    success: true,
    sessionId,
    ffmpegStarted: true,
    pid: session.pid,
    manifestUrl: `/api/vod/hls/${sessionId}/index.m3u8`,
    tempDirectoryWritable: tempWritable,
  };
}

/**
 * Get active session status and stream details
 */
export function getSessionStatus(sessionId: string) {
  const s = sessions.get(sessionId);
  const resolved = getFFmpegPath();
  const envInfo = checkFFmpegEnv();

  if (!s) {
    return {
      sessionExists: false,
      ffmpegStarted: false,
      ffmpegRunning: false,
      manifestExists: false,
      segmentCount: 0,
      lastLog: null,
      lastError: "Session introuvable",
      status: "stopped",
      exitCode: null,
      signal: null,
      upstreamReachable: false,
      videoCodec: "Unknown",
      audioCodec: "Unknown",
      resolution: "Unknown",
      fps: "Unknown",
      videoTranscoding: false,
      audioTranscoding: false,
      mode: "none",
      manifestGenerated: false,
      segmentsCount: 0,
      segments: [],
      firstSegmentLoaded: false,
      hlsManifestLoaded: false,
      videoPlaying: false,
      startupTimeMs: 0,
      manifestUrl: "",
      errorMessage: "Session introuvable ou expirée",
      errorCode: "SESSION_NOT_FOUND",
      logs: [],
      lastAccessTime: 0,
      tempDirectoryWritable: false,
      serverRuntime: true,
      ffmpegAvailable: envInfo.installed,
      ffmpegPathType: resolved.type,
      ffmpegVersion: envInfo.version,
    };
  }

  let manifestExists = false;
  let segments: string[] = [];

  try {
    if (fs.existsSync(s.manifestPath)) {
      manifestExists = true;
      s.manifestGenerated = true;
    }
    if (fs.existsSync(s.dir)) {
      const files = fs.readdirSync(s.dir);
      segments = files.filter((f) => f.endsWith(".ts"));
      s.segmentsCount = segments.length;
      s.segments = segments;
    }
  } catch (_) {}

  return {
    sessionExists: true,
    sessionId: s.sessionId,
    vodId: s.vodId,
    seriesId: s.seriesId,
    ffmpegStarted: s.ffmpegStarted,
    ffmpegPid: s.pid,
    ffmpegRunning: s.ffmpegRunning,
    manifestExists,
    segmentCount: segments.length,
    lastLog: s.lastLog,
    lastError: s.lastError || s.errorMessage,
    status: s.status,
    exitCode: s.exitCode,
    signal: s.signal,
    spawnError: s.spawnError,
    upstreamReachable: s.upstreamReachable,
    videoCodec: s.videoCodec,
    audioCodec: s.audioCodec,
    resolution: s.resolution,
    fps: s.fps,
    videoTranscoding: s.mode === "transcoding",
    audioTranscoding: true,
    mode: s.mode === "remuxing" ? "Copie directe (H.264 Remux)" : "Transcodage complet (H.264 / AAC Fallback)",
    manifestGenerated: manifestExists,
    segmentsCount: segments.length,
    segments,
    firstSegmentLoaded: s.firstSegmentLoaded,
    hlsManifestLoaded: s.hlsManifestLoaded,
    videoPlaying: s.videoPlaying,
    startupTimeMs: s.startupTimeMs,
    manifestUrl: `/api/vod/hls/${s.sessionId}/index.m3u8`,
    errorMessage: s.errorMessage,
    errorCode: s.errorCode,
    logs: s.logs,
    lastAccessTime: s.lastAccessTime,
    tempDirectoryWritable: s.tempDirectoryWritable,
    fallbackUsed: s.fallbackUsed,
    contentType: s.contentType,

    // New diagnostic payload fields
    failedStep: s.failedStep || null,
    networkCause: s.networkCause || null,
    httpStatus: s.httpStatus || null,
    duration: s.duration || (Date.now() - s.startTime),
    attemptCount: s.attemptCount || 1,
    proposedSolution: s.proposedSolution || null,
    handshakeExecutedOnServer: s.handshakeExecutedOnServer || "Non",
    createLinkExecutedOnServer: s.createLinkExecutedOnServer || "Non",
    ffmpegLaunchedOnSameServer: s.ffmpegLaunchedOnSameServer || "Non",

    // Server-level diagnostics
    serverRuntime: true,
    ffmpegAvailable: envInfo.installed,
    ffmpegPathType: resolved.type,
    ffmpegVersion: envInfo.version,
  };
}

/**
 * Stop HLS session, kill process and clean files
 */
export function stopHlsSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;

  s.status = "stopped";
  if (s.process && !s.process.killed) {
    try {
      s.process.kill("SIGTERM");
      setTimeout(() => {
        if (s.process && !s.process.killed) {
          try {
            s.process.kill("SIGKILL");
          } catch (_) {}
        }
      }, 1000);
    } catch (_) {}
  }

  try {
    if (fs.existsSync(s.dir)) {
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[Stalker HLS] Failed to clean dir for session ${sessionId}:`, err);
  }

  sessions.delete(sessionId);
  return true;
}

export function updateSessionAccess(sessionId: string, isManifest = false) {
  const s = sessions.get(sessionId);
  if (s) {
    s.lastAccessTime = Date.now();
    if (isManifest) {
      s.hlsManifestLoaded = true;
    } else {
      s.firstSegmentLoaded = true;
    }
    s.videoPlaying = true;
    s.status = "playing";
  }
}

export function cleanupAllSessions() {
  console.log("[Stalker HLS] Nettoyage global de toutes les sessions actives...");
  for (const id of sessions.keys()) {
    stopHlsSession(id);
  }
}

// Abandoned sessions GC
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastAccessTime > 120000) { // 2 minutes inactivity timeout
      console.log(`[Stalker HLS] Inactivité détectée (>2min) sur la session ${id}. Fermeture...`);
      stopHlsSession(id);
    }
  }
}, 15000);

process.on("SIGINT", cleanupAllSessions);
process.on("SIGTERM", cleanupAllSessions);
process.on("exit", cleanupAllSessions);
