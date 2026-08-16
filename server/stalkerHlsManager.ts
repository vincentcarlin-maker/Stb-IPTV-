import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export interface HlsSessionInfo {
  sessionId: string;
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
  status: "starting" | "running" | "stopped" | "error";
  exitCode: number | null;
  logs: string[];
  errorMessage: string | null;
  upstreamReachable: boolean;
  ffmpegStarted: boolean;
  ffmpegRunning: boolean;
  lastLog: string | null;
  lastError: string | null;
  tempDirectoryWritable: boolean;
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
 * 1. Check FFmpeg installation and version on startup with full diagnostics
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

  try {
    const res = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8", timeout: 4000 });
    if (res.error) {
      const err = res.error as any;
      console.log("\n===== FFMPEG ENV CHECK =====");
      console.log("ffmpeg found: Non");
      console.log(`error.code: ${err.code || "UNKNOWN"}`);
      console.log(`error.message: ${err.message}`);
      console.log(`process.platform: ${platform}`);
      console.log(`process.arch: ${arch}`);
      console.log(`working directory: ${cwd}`);
      console.log("============================\n");
      return {
        installed: false,
        version: "Non disponible",
        path: "",
        platform,
        arch,
        cwd,
        errorCode: err.code || "UNKNOWN",
        errorMessage: err.message,
      };
    }

    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split("\n")[0] || "";
      let binaryPath = "/usr/bin/ffmpeg";
      try {
        const whichRes = spawnSync("which", ["ffmpeg"], { encoding: "utf-8", timeout: 2000 });
        if (whichRes.status === 0 && whichRes.stdout.trim()) {
          binaryPath = whichRes.stdout.trim();
        }
      } catch (_) {}

      console.log("\n===== FFMPEG ENV CHECK =====");
      console.log("ffmpeg found: Oui");
      console.log(`ffmpeg path: ${binaryPath}`);
      console.log(`ffmpeg version: ${firstLine.trim()}`);
      console.log(`process.platform: ${platform}`);
      console.log(`process.arch: ${arch}`);
      console.log(`working directory: ${cwd}`);
      console.log("============================\n");

      return {
        installed: true,
        version: firstLine.trim(),
        path: binaryPath,
        platform,
        arch,
        cwd,
      };
    } else {
      console.log("\n===== FFMPEG ENV CHECK =====");
      console.log("ffmpeg found: Non");
      console.log(`error.code: EXIT_${res.status}`);
      console.log(`error.message: ${res.stderr || "Unknown failure"}`);
      console.log(`process.platform: ${platform}`);
      console.log(`process.arch: ${arch}`);
      console.log(`working directory: ${cwd}`);
      console.log("============================\n");
      return {
        installed: false,
        version: "Non disponible",
        path: "",
        platform,
        arch,
        cwd,
        errorCode: `EXIT_${res.status}`,
        errorMessage: res.stderr || "FFmpeg returned non-zero exit code",
      };
    }
  } catch (err: any) {
    console.log("\n===== FFMPEG ENV CHECK =====");
    console.log("ffmpeg found: Non");
    console.log(`error.code: ${err.code || "UNKNOWN"}`);
    console.log(`error.message: ${err.message}`);
    console.log(`process.platform: ${platform}`);
    console.log(`process.arch: ${arch}`);
    console.log(`working directory: ${cwd}`);
    console.log("============================\n");
    return {
      installed: false,
      version: "Non disponible",
      path: "",
      platform,
      arch,
      cwd,
      errorCode: err.code || "UNKNOWN",
      errorMessage: err.message,
    };
  }
}

// Perform initial check on module load
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
 * Start a new HLS remux session for a Stalker MPEG-TS stream
 */
export async function startHlsSession(params: {
  streamUrl: string;
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
}> {
  // Stop existing active sessions to guarantee only 1 IPTV connection is active at a time
  for (const [id, s] of sessions.entries()) {
    if (s.status === "running" || s.status === "starting") {
      stopHlsSession(id);
    }
  }

  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(BASE_TEMP_DIR, sessionId);
  const tempWritable = testDirectoryWritable(sessionDir);
  const manifestPath = path.join(sessionDir, "index.m3u8");
  const timestamp = new Date().toISOString();

  // 2. Log Start Banner
  console.log("\n===== FFMPEG START =====");
  console.log(`sessionId: ${sessionId}`);
  console.log(`timestamp: ${timestamp}`);
  console.log(`upstream URL received: ${params.streamUrl ? "Oui" : "Non"}`);
  console.log(`output directory: ${sessionDir}`);
  console.log(`TEMP DIRECTORY WRITABLE: ${tempWritable ? "Oui" : "Non"}`);
  console.log("========================\n");

  // Construct FFmpeg headers if needed
  const headerList: string[] = [];
  const ua = params.userAgent || "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
  headerList.push(`User-Agent: ${ua}`);

  if (params.referer) {
    headerList.push(`Referer: ${params.referer}`);
  }
  if (params.mac) {
    headerList.push(`Cookie: mac=${encodeURIComponent(params.mac)}; timezone=Europe/Paris`);
  }
  if (params.token) {
    headerList.push(`Authorization: Bearer ${params.token}`);
  }

  const headerString = headerList.length > 0 ? headerList.join("\r\n") + "\r\n" : "";

  let fullUrl = params.streamUrl.trim();
  if (params.mac && !fullUrl.includes("mac=")) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    fullUrl = `${fullUrl}${sep}mac=${encodeURIComponent(params.mac)}`;
  }
  if (params.playToken && !fullUrl.includes("play_token=") && !fullUrl.includes("token=")) {
    const sep = fullUrl.includes("?") ? "&" : "?";
    fullUrl = `${fullUrl}${sep}play_token=${encodeURIComponent(params.playToken)}`;
  }

  const ffmpegArgs: string[] = [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "info",
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
  ];

  if (headerString) {
    ffmpegArgs.push("-headers", headerString);
  }

  ffmpegArgs.push(
    "-i", fullUrl,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-c:a", "copy",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+append_list",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(sessionDir, "segment_%03d.ts"),
    manifestPath
  );

  // 3. Log sanitized command arguments
  console.log("binary: ffmpeg");
  console.log("arguments:");
  for (let i = 0; i < ffmpegArgs.length; i++) {
    const arg = ffmpegArgs[i];
    if (arg === fullUrl) {
      console.log(`- [UPSTREAM_URL_MASKED]`);
    } else if (ffmpegArgs[i - 1] === "-headers") {
      console.log(`- [HEADERS_MASKED]`);
    } else {
      console.log(`- ${arg}`);
    }
  }
  console.log("");

  const startTime = Date.now();
  const session: HlsSessionInfo = {
    sessionId,
    streamUrl: fullUrl,
    createdAt: startTime,
    lastAccessTime: startTime,
    process: null,
    dir: sessionDir,
    manifestPath,
    videoCodec: "Detecting (H.264 expected)...",
    audioCodec: "Detecting (AAC expected)...",
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
    status: "starting",
    exitCode: null,
    logs: [`[init] Démarrage de FFmpeg avec destination ${sessionDir}`],
    errorMessage: null,
    upstreamReachable: false,
    ffmpegStarted: false,
    ffmpegRunning: false,
    lastLog: "Démarrage de FFmpeg...",
    lastError: null,
    tempDirectoryWritable: tempWritable,
  };

  sessions.set(sessionId, session);

  try {
    // 4. Spawn FFmpeg process
    const child = spawn("ffmpeg", ffmpegArgs, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.process = child;
    session.pid = child.pid;

    // 11. 10-second spawn / error timeout
    const spawnTimeoutTimer = setTimeout(() => {
      if (!session.ffmpegStarted && session.status === "starting") {
        console.error("[Stalker HLS] FFMPEG START TIMEOUT: Aucun événement spawn ni error reçu après 10s");
        session.status = "error";
        session.errorMessage = "FFMPEG START TIMEOUT: Aucun événement spawn ni error après 10s";
        session.lastError = session.errorMessage;
        session.logs.push("FFMPEG START TIMEOUT: Aucun événement reçu après 10 secondes.");
      }
    }, 10000);

    // 4 & 5. Listen to lifecycle events
    child.on("spawn", () => {
      clearTimeout(spawnTimeoutTimer);
      session.ffmpegStarted = true;
      session.ffmpegRunning = true;
      session.status = "running";
      console.log(`FFMPEG SPAWNED\nPID: ${child.pid}`);
      session.logs.push(`FFMPEG SPAWNED (PID: ${child.pid})`);
      session.lastLog = `FFMPEG SPAWNED (PID: ${child.pid})`;
    });

    child.on("error", (err: any) => {
      clearTimeout(spawnTimeoutTimer);
      session.status = "error";
      session.ffmpegRunning = false;
      session.errorMessage = `FFMPEG SPAWN ERROR [${err.code || "UNKNOWN"}]: ${err.message}`;
      session.lastError = session.errorMessage;
      console.error(`FFMPEG SPAWN ERROR\ncode: ${err.code || "UNKNOWN"}\nmessage: ${err.message}`);
      session.logs.push(`FFMPEG SPAWN ERROR: ${err.code || ""} ${err.message}`);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const rawStr = chunk.toString();
      const str = maskSensitiveLog(rawStr).trim();
      if (str) {
        console.log(`stdout: ${str}`);
        session.logs.push(`[stdout] ${str}`);
        session.lastLog = str;
        if (session.logs.length > 80) session.logs.shift();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const rawStr = chunk.toString();
      const maskedStr = maskSensitiveLog(rawStr).trim();
      if (!maskedStr) return;

      console.log(`stderr: ${maskedStr}`);
      session.logs.push(maskedStr);
      session.lastLog = maskedStr;
      if (session.logs.length > 80) session.logs.shift();

      // Detect upstream reachable
      if (rawStr.includes("Input #0") || rawStr.includes("Stream #0:") || rawStr.includes("Opening '") || rawStr.includes("video:") || rawStr.includes("fps,")) {
        session.upstreamReachable = true;
      }

      // Detect video codec
      const videoMatch = rawStr.match(/Stream #0:\d+.*Video:\s*([^,\n]+)/i);
      if (videoMatch && videoMatch[1]) {
        session.videoCodec = videoMatch[1].trim();
        session.upstreamReachable = true;
      }

      // Detect audio codec
      const audioMatch = rawStr.match(/Stream #0:\d+.*Audio:\s*([^,\n]+)/i);
      if (audioMatch && audioMatch[1]) {
        session.audioCodec = audioMatch[1].trim();
      }

      // Detect resolution and fps
      const resMatch = rawStr.match(/(\d{3,4}x\d{3,4})/);
      if (resMatch && resMatch[1]) {
        session.resolution = resMatch[1];
      }
      const fpsMatch = rawStr.match(/(\d+(?:\.\d+)?)\s*fps/i);
      if (fpsMatch && fpsMatch[1]) {
        session.fps = `${fpsMatch[1]} fps`;
      }

      // Detect common HTTP errors
      if (rawStr.includes("401 Unauthorized") || rawStr.includes("HTTP error 401")) {
        session.errorMessage = "HTTP 401: Token ou MAC non autorisé par le serveur Stalker";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("403 Forbidden") || rawStr.includes("HTTP error 403")) {
        session.errorMessage = "HTTP 403: Accès interdit par le portail IPTV";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("404 Not Found") || rawStr.includes("HTTP error 404")) {
        session.errorMessage = "HTTP 404: Flux introuvable sur le serveur";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("456") || rawStr.includes("HTTP error 456")) {
        session.errorMessage = "HTTP 456: Limite de connexions simultanées atteinte";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("503 Service Unavailable") || rawStr.includes("HTTP error 503")) {
        session.errorMessage = "HTTP 503: Serveur IPTV indisponible";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("Connection refused")) {
        session.errorMessage = "Connexion refusée par le serveur IPTV";
        session.lastError = session.errorMessage;
        session.status = "error";
      } else if (rawStr.includes("Connection timed out") || rawStr.includes("Operation timed out")) {
        session.errorMessage = "Timeout lors de la connexion au serveur IPTV";
        session.lastError = session.errorMessage;
        session.status = "error";
      }
    });

    child.on("exit", (code, signal) => {
      session.exitCode = code;
      session.ffmpegRunning = false;
      session.status = code === 0 ? "stopped" : (session.status === "error" ? "error" : "stopped");
      if (code !== 0 && !session.errorMessage) {
        session.errorMessage = `FFmpeg s'est arrêté (code=${code}${signal ? `, signal=${signal}` : ""})`;
        session.lastError = session.errorMessage;
      }
      console.log(`FFMPEG EXITED: code=${code}, signal=${signal}`);
      session.logs.push(`FFMPEG EXITED: code=${code}${signal ? ` signal=${signal}` : ""}`);
    });

    child.on("close", (code) => {
      session.ffmpegRunning = false;
      console.log(`FFMPEG CLOSED: code=${code}`);
      session.logs.push(`FFMPEG CLOSED: code=${code}`);
    });

    // 6. Return IMMEDIATELY without awaiting exit
    return {
      success: true,
      sessionId,
      ffmpegStarted: true,
      pid: child.pid,
      manifestUrl: `/api/test/stalker-hls/${sessionId}/index.m3u8`,
      tempDirectoryWritable: tempWritable,
    };
  } catch (err: any) {
    session.status = "error";
    session.errorMessage = `Erreur de lancement FFmpeg: ${err.message}`;
    session.lastError = session.errorMessage;
    console.error(`FFMPEG SPAWN ERROR\ncode: ${err.code || "UNKNOWN"}\nmessage: ${err.message}`);
    return {
      success: false,
      sessionId,
      ffmpegStarted: false,
      tempDirectoryWritable: tempWritable,
      manifestUrl: "",
      error: err.message,
    };
  }
}

/**
 * 7. Get the current real-time status of a session
 */
export function getSessionStatus(sessionId: string): {
  sessionExists: boolean;
  ffmpegStarted: boolean;
  ffmpegPid?: number;
  ffmpegRunning: boolean;
  manifestExists: boolean;
  segmentCount: number;
  lastLog: string | null;
  lastError: string | null;
  status?: string;
  exitCode?: number | null;
  upstreamReachable?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  fps?: string;
  videoTranscoding?: boolean;
  audioTranscoding?: boolean;
  mode?: string;
  manifestGenerated?: boolean;
  segmentsCount?: number;
  segments?: string[];
  firstSegmentLoaded?: boolean;
  hlsManifestLoaded?: boolean;
  videoPlaying?: boolean;
  startupTimeMs?: number;
  manifestUrl?: string;
  errorMessage?: string | null;
  logs?: string[];
  lastAccessTime?: number;
  tempDirectoryWritable?: boolean;
} {
  const s = sessions.get(sessionId);
  if (!s) {
    return {
      sessionExists: false,
      ffmpegStarted: false,
      ffmpegRunning: false,
      manifestExists: false,
      segmentCount: 0,
      lastLog: null,
      lastError: "Session introuvable",
    };
  }

  // Scan directory for generated manifest and segments
  let manifestExists = false;
  let segments: string[] = [];

  try {
    if (fs.existsSync(s.manifestPath)) {
      manifestExists = true;
      s.manifestGenerated = true;
      if (s.startupTimeMs === 0) {
        s.startupTimeMs = Date.now() - s.startTime;
      }
    }
    if (fs.existsSync(s.dir)) {
      const files = fs.readdirSync(s.dir);
      segments = files.filter((f) => f.endsWith(".ts"));
      s.segmentsCount = segments.length;
      s.segments = segments;
    }
  } catch (err) {
    // Ignore read errors
  }

  return {
    sessionExists: true,
    ffmpegStarted: s.ffmpegStarted,
    ffmpegPid: s.pid,
    ffmpegRunning: s.ffmpegRunning,
    manifestExists,
    segmentCount: segments.length,
    lastLog: s.lastLog,
    lastError: s.lastError || s.errorMessage,
    status: s.status,
    exitCode: s.exitCode,
    upstreamReachable: s.upstreamReachable,
    videoCodec: s.videoCodec,
    audioCodec: s.audioCodec,
    resolution: s.resolution,
    fps: s.fps,
    videoTranscoding: false,
    audioTranscoding: false,
    mode: "REMUX ONLY (-c copy)",
    manifestGenerated: manifestExists,
    segmentsCount: segments.length,
    segments,
    firstSegmentLoaded: s.firstSegmentLoaded,
    hlsManifestLoaded: s.hlsManifestLoaded,
    videoPlaying: s.videoPlaying,
    startupTimeMs: s.startupTimeMs,
    manifestUrl: `/api/test/stalker-hls/${s.sessionId}/index.m3u8`,
    errorMessage: s.errorMessage,
    logs: s.logs.slice(-30),
    lastAccessTime: s.lastAccessTime,
    tempDirectoryWritable: s.tempDirectoryWritable,
  };
}

/**
 * Stop a session, kill FFmpeg, and delete temp directory
 */
export function stopHlsSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;

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

  // Delete temp folder
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

/**
 * Clean up all sessions (on server exit or periodic cleanup)
 */
export function cleanupAllSessions() {
  for (const id of sessions.keys()) {
    stopHlsSession(id);
  }
}

/**
 * Background garbage collector: cleans up abandoned sessions inactive for > 45s
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastAccessTime > 45000) {
      console.log(`[Stalker HLS] Cleaning up inactive session ${id}`);
      stopHlsSession(id);
    }
  }
}, 10000);

// Process exit hooks
process.on("SIGINT", cleanupAllSessions);
process.on("SIGTERM", cleanupAllSessions);
process.on("exit", cleanupAllSessions);
