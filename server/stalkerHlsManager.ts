import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import ffmpegStatic from "ffmpeg-static";

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
}): Promise<{
  resolvedUrl: string;
  headers: Record<string, string>;
  userAgent: string;
  referer: string;
  contentType: string;
}> {
  const { cmd, seriesId, serverProfile } = params;
  const { portalUrl, macAddress, token } = serverProfile;

  let cleanUrl = portalUrl.trim();
  if (!cleanUrl.endsWith("/")) cleanUrl += "/";
  if (!cleanUrl.includes("load.php")) {
    cleanUrl += "server/load.php";
  }

  const cmdParam = cmd.trim();
  const queryParams = new URLSearchParams({
    type: seriesId ? "series" : "vod",
    action: "create_link",
    cmd: cmdParam,
    series: seriesId || "",
    forced_storage: "0",
    disable_ad: "0",
  });

  const fullUrl = `${cleanUrl}?${queryParams.toString()}`;
  const cookieHeader = `mac=${encodeURIComponent(macAddress)}; stb_lang=en; timezone=Europe/Paris`;
  const userAgent = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
  const referer = portalUrl;

  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Cookie": cookieHeader,
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    "Referer": referer,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  console.log(`[Resolve VOD] Fetching fresh link from Stalker portal: ${maskSensitiveLog(fullUrl)}`);

  const response = await fetch(fullUrl, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`PORTAL_HTTP_ERROR: Status ${response.status}`);
  }

  const data = await response.json();
  let resolvedUrl = "";

  if (data && data.js && typeof data.js.cmd === "string") {
    resolvedUrl = data.js.cmd;
  } else if (data && typeof data.cmd === "string") {
    resolvedUrl = data.cmd;
  } else {
    resolvedUrl = cmdParam;
  }

  // Clean prefixes
  resolvedUrl = resolvedUrl.replace(/^(ffmpeg|auto|ffrt)\s+/i, "").trim();

  if (!resolvedUrl.startsWith("http://") && !resolvedUrl.startsWith("https://")) {
    throw new Error(`INVALID_RESOLVED_URL: ${resolvedUrl}`);
  }

  console.log(`[Resolve VOD] Resolved URL: ${maskSensitiveLog(resolvedUrl)}. Verifying media headers...`);
  
  const testRes = await fetch(resolvedUrl, {
    headers: {
      "User-Agent": userAgent,
      "Referer": referer,
      "Cookie": cookieHeader,
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Authorization": token ? `Bearer ${token}` : "",
    },
    redirect: "follow",
  });

  if (testRes.status === 401) {
    throw new Error("VOD_LINK_EXPIRED");
  }
  if (testRes.status === 403) {
    throw new Error("VOD_UPSTREAM_FORBIDDEN");
  }

  const contentType = testRes.headers.get("content-type") || "";
  
  if (testRes.body) {
    try {
      await testRes.body.cancel();
    } catch (_) {}
  }

  if (contentType.toLowerCase().includes("text/html") || contentType.toLowerCase().includes("application/json")) {
    console.error(`[Resolve VOD] Error: Resolved URL is not media (Content-Type: ${contentType})`);
    throw new Error("VOD_UPSTREAM_NOT_MEDIA");
  }

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
    contentType,
  };
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
      console.warn(`[Resolve VOD Attempt ${attempt}/${maxAttempts} failed]:`, err.message);
      
      if (err.message === "VOD_LINK_EXPIRED" || err.message === "VOD_UPSTREAM_FORBIDDEN" || err.message === "PORTAL_HTTP_ERROR") {
        if (attempt < maxAttempts) {
          console.log("[Resolve VOD] Link expired or forbidden, retrying handshake...");
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
      }

      session.status = "error";
      session.errorCode = err.message || "RESOLVE_FAILED";
      if (err.message === "VOD_UPSTREAM_NOT_MEDIA") {
        session.errorMessage = "Le serveur IPTV a renvoyé du contenu HTML/JSON au lieu d'un flux vidéo valide (VOD_UPSTREAM_NOT_MEDIA).";
      } else if (err.message === "VOD_LINK_EXPIRED") {
        session.errorMessage = "Le lien VOD de votre fournisseur a expiré (VOD_LINK_EXPIRED).";
      } else if (err.message === "VOD_UPSTREAM_FORBIDDEN") {
        session.errorMessage = "Accès refusé par le serveur IPTV (VOD_UPSTREAM_FORBIDDEN).";
      } else {
        session.errorMessage = `Échec de résolution de la source VOD : ${err.message}`;
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
