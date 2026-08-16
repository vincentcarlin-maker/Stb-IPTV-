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
 * Check FFmpeg installation and version
 */
export function getFFmpegInfo(): { installed: boolean; version: string; path: string } {
  try {
    const res = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8", timeout: 3000 });
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split("\n")[0] || "";
      return {
        installed: true,
        version: firstLine.trim(),
        path: "/usr/bin/ffmpeg",
      };
    }
  } catch (err) {
    // try which
  }
  return {
    installed: false,
    version: "Non disponible",
    path: "",
  };
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
}): Promise<{ success: boolean; sessionId: string; manifestUrl: string; info: Partial<HlsSessionInfo> }> {
  // Stop existing active sessions to guarantee only 1 IPTV connection is active at a time
  for (const [id, s] of sessions.entries()) {
    if (s.status === "running" || s.status === "starting") {
      stopHlsSession(id);
    }
  }

  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(BASE_TEMP_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const manifestPath = path.join(sessionDir, "index.m3u8");

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
    logs: [],
    errorMessage: null,
    upstreamReachable: false,
  };

  try {
    const child = spawn("ffmpeg", ffmpegArgs, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.process = child;
    session.pid = child.pid;
    session.status = "running";
    sessions.set(sessionId, session);

    child.stdout.on("data", (chunk: Buffer) => {
      const str = maskSensitiveLog(chunk.toString());
      session.logs.push(str);
      if (session.logs.length > 80) session.logs.shift();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const rawStr = chunk.toString();
      const maskedStr = maskSensitiveLog(rawStr);
      session.logs.push(maskedStr);
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
        session.status = "error";
      } else if (rawStr.includes("403 Forbidden") || rawStr.includes("HTTP error 403")) {
        session.errorMessage = "HTTP 403: Accès interdit par le portail IPTV";
        session.status = "error";
      } else if (rawStr.includes("404 Not Found") || rawStr.includes("HTTP error 404")) {
        session.errorMessage = "HTTP 404: Flux introuvable sur le serveur";
        session.status = "error";
      } else if (rawStr.includes("456") || rawStr.includes("HTTP error 456")) {
        session.errorMessage = "HTTP 456: Limite de connexions simultanées atteinte";
        session.status = "error";
      } else if (rawStr.includes("503 Service Unavailable") || rawStr.includes("HTTP error 503")) {
        session.errorMessage = "HTTP 503: Serveur IPTV indisponible";
        session.status = "error";
      } else if (rawStr.includes("Connection refused")) {
        session.errorMessage = "Connexion refusée par le serveur IPTV";
        session.status = "error";
      } else if (rawStr.includes("Connection timed out") || rawStr.includes("Operation timed out")) {
        session.errorMessage = "Timeout lors de la connexion au serveur IPTV";
        session.status = "error";
      }
    });

    child.on("close", (code) => {
      session.exitCode = code;
      session.status = code === 0 ? "stopped" : (session.status === "error" ? "error" : "stopped");
      if (code !== 0 && !session.errorMessage) {
        session.errorMessage = `FFmpeg s'est arrêté avec le code ${code}`;
      }
    });

    child.on("error", (err) => {
      session.status = "error";
      session.errorMessage = `Erreur FFmpeg: ${err.message}`;
    });

    return {
      success: true,
      sessionId,
      manifestUrl: `/api/test/stalker-hls/${sessionId}/index.m3u8`,
      info: {
        sessionId,
        pid: child.pid,
        status: "running",
        manifestGenerated: false,
      },
    };
  } catch (err: any) {
    session.status = "error";
    session.errorMessage = err.message;
    return {
      success: false,
      sessionId,
      manifestUrl: "",
      info: { errorMessage: err.message },
    };
  }
}

/**
 * Get the current real-time status of a session
 */
export function getSessionStatus(sessionId: string): {
  found: boolean;
  session?: Partial<HlsSessionInfo> & {
    manifestUrl: string;
    videoTranscoding: boolean;
    audioTranscoding: boolean;
    mode: string;
    segments: string[];
  };
} {
  const s = sessions.get(sessionId);
  if (!s) {
    return { found: false };
  }

  // Scan directory for generated manifest and segments
  let manifestGenerated = false;
  let segments: string[] = [];

  try {
    if (fs.existsSync(s.manifestPath)) {
      manifestGenerated = true;
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
    found: true,
    session: {
      sessionId: s.sessionId,
      pid: s.pid,
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
      manifestGenerated,
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
    },
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

// Process exit hook
process.on("SIGINT", cleanupAllSessions);
process.on("SIGTERM", cleanupAllSessions);
process.on("exit", cleanupAllSessions);
