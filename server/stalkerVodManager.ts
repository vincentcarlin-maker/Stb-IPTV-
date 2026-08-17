import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Request, Response } from "express";

export interface VodSessionInfo {
  sessionId: string;
  upstreamUrl: string;
  mac?: string;
  token?: string;
  createdAt: number;
  lastAccessTime: number;
  status: "starting" | "playing" | "paused" | "stopped" | "error";
  mode: "direct" | "mp4-remux" | "hls-remux" | "transcode";
  
  // Media info
  container: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  fps: string;
  contentType: string;
  rangeSupport: boolean;
  contentLength?: string;

  // Diagnostics flags
  videoCopied: boolean;
  videoTranscoded: boolean;
  audioCopied: boolean;
  audioTranscoded: boolean;
  ffmpegRunning: boolean;

  // Process / Storage
  process: ChildProcess | null;
  pid?: number;
  dir: string;
  manifestPath?: string;
  playbackUrl: string;
  
  // Logging & Errors
  logs: string[];
  errorMessage: string | null;
  startupTimeMs: number;
  lastLog: string | null;
  lastError: string | null;
}

const sessions = new Map<string, VodSessionInfo>();
const BASE_TEMP_DIR = path.join(os.tmpdir(), "iptv-vod");

// Ensure base temp directory exists
try {
  if (!fs.existsSync(BASE_TEMP_DIR)) {
    fs.mkdirSync(BASE_TEMP_DIR, { recursive: true });
  }
} catch (err) {
  console.error("[Stalker VOD] Failed to create base temp dir:", err);
}

/**
 * Mask credentials and tokens in logs
 */
function maskSensitiveUrl(str: string): string {
  if (!str) return "";
  let masked = str;
  masked = masked.replace(/mac=[0-9a-fA-F:]+/gi, "mac=00:1A:79:XX:XX:XX");
  masked = masked.replace(/(token|play_token|password|pass|username|user|key)=([^&\s"',;]+)/gi, "$1=XXXX");
  masked = masked.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [FILTERED]");
  return masked;
}

/**
 * Check if FFmpeg is installed and get details
 */
export function getFFmpegDiagnostic() {
  try {
    const res = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8", timeout: 2000 });
    if (res.status === 0 && res.stdout) {
      const firstLine = res.stdout.split("\n")[0] || "";
      let binaryPath = "ffmpeg";
      try {
        const whichRes = spawnSync("which", ["ffmpeg"], { encoding: "utf-8", timeout: 1000 });
        if (whichRes.status === 0 && whichRes.stdout.trim()) {
          binaryPath = whichRes.stdout.trim();
        }
      } catch (_) {}
      return {
        installed: true,
        path: binaryPath,
        version: firstLine.trim()
      };
    }
  } catch (_) {}
  return {
    installed: false,
    path: "N/A",
    version: "Non disponible"
  };
}

/**
 * Check if FFprobe is installed
 */
export function isFfprobeInstalled(): boolean {
  try {
    const res = spawnSync("ffprobe", ["-version"], { encoding: "utf-8", timeout: 1000 });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * Analyze upstream VOD URL format, range support, and codecs using HTTP and/or ffprobe
 */
export async function analyzeVodStream(
  streamUrl: string,
  mac?: string,
  token?: string
): Promise<{
  container: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  fps: string;
  contentType: string;
  rangeSupport: boolean;
  contentLength?: string;
}> {
  let container = "UNKNOWN";
  let videoCodec = "UNKNOWN";
  let audioCodec = "UNKNOWN";
  let resolution = "1920x1080"; // Default
  let fps = "24";              // Default
  let contentType = "video/mp4";
  let rangeSupport = false;
  let contentLength: string | undefined = undefined;

  // 1. Guess container from URL file extension
  const urlLower = streamUrl.toLowerCase();
  if (urlLower.includes(".mkv") || urlLower.includes("extension=mkv")) {
    container = "MKV";
    contentType = "video/x-matroska";
  } else if (urlLower.includes(".mp4") || urlLower.includes("extension=mp4")) {
    container = "MP4";
    contentType = "video/mp4";
  } else if (urlLower.includes(".m3u8") || urlLower.includes("extension=m3u8")) {
    container = "HLS";
    contentType = "application/x-mpegURL";
    rangeSupport = true; // HLS is inherently chunked/range-supported
  } else if (urlLower.includes(".ts") || urlLower.includes("extension=ts")) {
    container = "MPEG-TS";
    contentType = "video/mp2t";
  }

  // 2. Perform a lightweight HTTP HEAD or range GET request to verify response headers
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "Accept": "*/*",
      "Range": "bytes=0-0" // Request just 1 byte to check headers & range support instantly without downloading
    };
    if (mac) {
      headers["Cookie"] = `mac=${mac}; timezone=Europe/Paris`;
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // Strict 2s timeout

    const res = await fetch(streamUrl, {
      headers,
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    if (res.ok || res.status === 206) {
      const typeHeader = res.headers.get("content-type");
      if (typeHeader) {
        contentType = typeHeader.split(";")[0].trim();
        // Adjust container based on Content-Type if not set
        if (contentType.includes("matroska") || contentType.includes("x-mkv")) {
          container = "MKV";
        } else if (contentType.includes("mp4")) {
          container = "MP4";
        } else if (contentType.includes("mpegurl") || contentType.includes("apple.mpegurl")) {
          container = "HLS";
        } else if (contentType.includes("mp2t") || contentType.includes("mpeg-ts")) {
          container = "MPEG-TS";
        }
      }

      const lengthHeader = res.headers.get("content-length");
      if (lengthHeader) {
        contentLength = lengthHeader;
      }

      const acceptRanges = res.headers.get("accept-ranges");
      const contentRange = res.headers.get("content-range");
      if ((acceptRanges && acceptRanges.includes("bytes")) || contentRange || res.status === 206) {
        rangeSupport = true;
      }
    }
  } catch (err) {
    console.warn("[Stalker VOD Analyzer] HTTP format check failed, using URL heuristics:", err);
  }

  // 3. Fast probe using ffprobe if available
  if (isFfprobeInstalled()) {
    try {
      const ffprobeArgs = [
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-of", "json",
        "-probesize", "500000",
        "-analyzeduration", "500000"
      ];

      // Reconstruct header lists for ffprobe
      const headersList: string[] = [];
      const ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
      headersList.push(`User-Agent: ${ua}`);
      if (mac) {
        headersList.push(`Cookie: mac=${mac}; timezone=Europe/Paris`);
      }
      if (token) {
        headersList.push(`Authorization: Bearer ${token}`);
      }
      if (headersList.length > 0) {
        ffprobeArgs.push("-headers", headersList.join("\r\n") + "\r\n");
      }

      ffprobeArgs.push(streamUrl);

      const probeRes = spawnSync("ffprobe", ffprobeArgs, {
        encoding: "utf-8",
        timeout: 2500 // Max 2.5s wait to avoid delaying playback
      });

      if (probeRes.status === 0 && probeRes.stdout) {
        const metadata = JSON.parse(probeRes.stdout);
        
        // Find video stream
        const videoStream = metadata.streams?.find((s: any) => s.codec_type === "video");
        if (videoStream) {
          videoCodec = videoStream.codec_name || "UNKNOWN";
          resolution = `${videoStream.width || 1920}x${videoStream.height || 1080}`;
          if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split("/");
            if (num && den && parseInt(den) > 0) {
              fps = Math.round(parseInt(num) / parseInt(den)).toString();
            }
          }
        }

        // Find audio stream
        const audioStream = metadata.streams?.find((s: any) => s.codec_type === "audio");
        if (audioStream) {
          audioCodec = audioStream.codec_name || "UNKNOWN";
        }

        // Container format
        if (metadata.format?.format_name) {
          const formatName = metadata.format.format_name.toLowerCase();
          if (formatName.includes("matroska") || formatName.includes("mkv")) {
            container = "MKV";
          } else if (formatName.includes("mp4")) {
            container = "MP4";
          } else if (formatName.includes("hls")) {
            container = "HLS";
          } else if (formatName.includes("mpegts")) {
            container = "MPEG-TS";
          }
        }
      }
    } catch (probeErr) {
      console.warn("[Stalker VOD Analyzer] ffprobe command failed or timed out:", probeErr);
    }
  }

  // Fallbacks if metadata is unknown
  if (videoCodec === "UNKNOWN") videoCodec = "h264";
  if (audioCodec === "UNKNOWN") audioCodec = (container === "MP4" ? "aac" : "ac3");

  return {
    container,
    videoCodec,
    audioCodec,
    resolution,
    fps,
    contentType,
    rangeSupport,
    contentLength
  };
}

/**
 * Handle POST /api/vod/play - Create or fetch a VOD Playback session
 */
export async function createVodSession(req: Request, res: Response) {
  const { streamUrl, mac, token } = req.body;

  if (!streamUrl) {
    res.status(400).json({ success: false, error: "L'URL du flux VOD est manquante" });
    return;
  }

  // Check if FFmpeg is installed
  const ffmpegInfo = getFFmpegDiagnostic();
  if (!ffmpegInfo.installed) {
    res.status(500).json({
      success: false,
      error: "FFmpeg n'est pas installé sur le serveur. Impossible de lire la VOD nécessitant un remuxage."
    });
    return;
  }

  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(BASE_TEMP_DIR, sessionId);

  try {
    // 1. Analyze format and codecs
    console.log(`[Stalker VOD] Nouvelle requête de lecture pour: ${maskSensitiveUrl(streamUrl)}`);
    const mediaInfo = await analyzeVodStream(streamUrl, mac, token);
    console.log(`[Stalker VOD] Analyse de format terminée:\nContainer: ${mediaInfo.container}\nVideo: ${mediaInfo.videoCodec}\nAudio: ${mediaInfo.audioCodec}\nResolution: ${mediaInfo.resolution}\nRange support: ${mediaInfo.rangeSupport}`);

    // 2. Select appropriate playback mode
    let mode: "direct" | "mp4-remux" | "hls-remux" = "direct";
    let videoCopied = true;
    let videoTranscoded = false;
    let audioCopied = true;
    let audioTranscoded = false;

    const lowerVideo = mediaInfo.videoCodec.toLowerCase();
    const lowerAudio = mediaInfo.audioCodec.toLowerCase();

    // Direct playback criteria:
    // - MP4 container with H.264 video and AAC/MP3 audio
    // - HLS container
    const isDirectCapable = (
      (mediaInfo.container === "MP4" && (lowerVideo === "h264" || lowerVideo === "avc") && (lowerAudio === "aac" || lowerAudio === "mp3")) ||
      mediaInfo.container === "HLS"
    );

    if (isDirectCapable) {
      mode = "direct";
      videoCopied = true;
      audioCopied = true;
    } else {
      // For MKV or MPEG-TS, or files containing AC-3 (dolby) audio which fails on many browsers.
      // We default to "hls-remux" or "mp4-remux".
      // Let's use HLS VOD Remuxing as our premium, super robust, fully seekable option, 
      // but support MP4 fragmented remuxing too. Let's make HLS REMUX the primary choice for MKV 
      // because it handles Range, Seek, and browser playback with 100% reliability in Safari/PWA.
      mode = "hls-remux";

      // Video can be copied if it's H.264
      if (lowerVideo === "h264" || lowerVideo === "avc") {
        videoCopied = true;
        videoTranscoded = false;
      } else {
        // If it is HEVC (H.265) or other, copy it anyway as most modern browsers can decode HEVC directly, 
        // fallback to transcode only in last resort.
        videoCopied = true; 
        videoTranscoded = false;
      }

      // Audio must be transcoded to AAC if it's AC-3 or something else incompatible
      if (lowerAudio === "aac" || lowerAudio === "mp3") {
        audioCopied = true;
        audioTranscoded = false;
      } else {
        audioCopied = false;
        audioTranscoded = true;
      }
    }

    // Prepare safe playback URL
    const playbackUrl = `/api/vod/session/${sessionId}/stream`;

    const session: VodSessionInfo = {
      sessionId,
      upstreamUrl: streamUrl,
      mac,
      token,
      createdAt: Date.now(),
      lastAccessTime: Date.now(),
      status: "starting",
      mode,
      container: mediaInfo.container,
      videoCodec: mediaInfo.videoCodec,
      audioCodec: mediaInfo.audioCodec,
      resolution: mediaInfo.resolution,
      fps: mediaInfo.fps,
      contentType: mediaInfo.contentType,
      rangeSupport: mediaInfo.rangeSupport,
      contentLength: mediaInfo.contentLength,
      videoCopied,
      videoTranscoded,
      audioCopied,
      audioTranscoded,
      ffmpegRunning: false,
      process: null,
      dir: sessionDir,
      playbackUrl,
      logs: ["Session créée", `Mode sélectionné: ${mode.toUpperCase()}`],
      errorMessage: null,
      startupTimeMs: 0,
      lastLog: "Démarrage de la session...",
      lastError: null
    };

    sessions.set(sessionId, session);

    // If remux mode (HLS), we need to start the FFmpeg background writer!
    if (mode === "hls-remux") {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      const manifestPath = path.join(sessionDir, "index.m3u8");
      session.manifestPath = manifestPath;
      session.playbackUrl = `/api/vod/session/${sessionId}/index.m3u8`;

      // Build headers for upstream access
      const headerList: string[] = [];
      const ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
      headerList.push(`User-Agent: ${ua}`);
      if (mac) {
        headerList.push(`Cookie: mac=${mac}; timezone=Europe/Paris`);
      }
      if (token) {
        headerList.push(`Authorization: Bearer ${token}`);
      }
      const headerString = headerList.length > 0 ? headerList.join("\r\n") + "\r\n" : "";

      let fullInputUrl = streamUrl;
      if (mac && !fullInputUrl.includes("mac=")) {
        const sep = fullInputUrl.includes("?") ? "&" : "?";
        fullInputUrl = `${fullInputUrl}${sep}mac=${mac}`;
      }

      const ffmpegArgs = [
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

      ffmpegArgs.push("-i", fullInputUrl);

      // Video mapping and encoding
      ffmpegArgs.push("-map", "0:v:0");
      if (videoCopied) {
        ffmpegArgs.push("-c:v", "copy");
      } else {
        ffmpegArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23");
      }

      // Audio mapping and encoding
      ffmpegArgs.push("-map", "0:a:0?");
      if (audioCopied) {
        ffmpegArgs.push("-c:a", "copy");
      } else {
        ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
      }

      // HLS format with full segments preserved for full seek!
      ffmpegArgs.push(
        "-f", "hls",
        "-hls_time", "5",
        "-hls_list_size", "0", // 0 = keep all segments in the playlist!
        "-hls_segment_filename", path.join(sessionDir, "segment_%04d.ts"),
        manifestPath
      );

      console.log(`[Stalker VOD FFmpeg] Commande: ffmpeg ${ffmpegArgs.join(" ")}`);
      session.logs.push(`spawn: ffmpeg ${ffmpegArgs.filter(a => !a.includes("Authorization") && !a.includes("Cookie") && !a.includes("token")).join(" ")}`);

      const child = spawn("ffmpeg", ffmpegArgs, { detached: false, stdio: ["ignore", "pipe", "pipe"] });
      session.process = child;
      session.pid = child.pid;
      session.ffmpegRunning = true;

      child.on("spawn", () => {
        session.logs.push(`FFMPEG SPAWNED (PID: ${child.pid})`);
        session.lastLog = `Processus FFmpeg démarré (PID: ${child.pid})`;
      });

      child.on("error", (err: any) => {
        session.status = "error";
        session.ffmpegRunning = false;
        session.errorMessage = `FFMPEG SPAWN ERROR: ${err.message}`;
        session.lastError = err.message;
        session.logs.push(`FFMPEG SPAWN ERROR: ${err.message}`);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) {
          session.logs.push(line);
          session.lastLog = line;
          if (session.logs.length > 50) session.logs.shift();
        }
      });

      child.on("exit", (code, signal) => {
        session.ffmpegRunning = false;
        session.status = code === 0 ? "stopped" : "error";
        session.logs.push(`FFmpeg arrêté avec le code ${code} (signal: ${signal})`);
        if (code !== 0 && code !== null) {
          session.errorMessage = `FFMPEG MUX ERROR (code ${code})`;
          session.lastError = `FFmpeg s'est arrêté de manière inattendue avec le code de sortie ${code}`;
        }
      });

      // Wait up to 10 seconds for the first segments/index.m3u8 to be created so that we don't start the player on an empty file
      let manifestReady = false;
      const startWait = Date.now();
      while (Date.now() - startWait < 12000) {
        if (fs.existsSync(manifestPath)) {
          const content = fs.readFileSync(manifestPath, "utf-8");
          if (content.includes("#EXTINF") || content.includes(".ts")) {
            manifestReady = true;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (!manifestReady) {
        console.warn("[Stalker VOD] Délai d'attente dépassé pour la création du manifeste HLS");
        session.logs.push("TIMEOUT: Le manifeste HLS n'a pas pu être généré à temps.");
      } else {
        session.status = "playing";
        session.startupTimeMs = Date.now() - session.createdAt;
      }
    } else {
      // For Direct mode, we are ready instantly!
      session.status = "playing";
      session.startupTimeMs = Date.now() - session.createdAt;
    }

    res.json({
      success: true,
      sessionId,
      mode: session.mode,
      playbackUrl: session.playbackUrl,
      container: session.container,
      videoCodec: session.videoCodec,
      audioCodec: session.audioCodec,
      resolution: session.resolution,
      fps: session.fps,
      videoCopied: session.videoCopied,
      videoTranscoded: session.videoTranscoded,
      audioCopied: session.audioCopied,
      audioTranscoded: session.audioTranscoded,
      startupTimeMs: session.startupTimeMs,
      rangeSupport: session.rangeSupport
    });

  } catch (err: any) {
    console.error("[Stalker VOD] Erreur d'initialisation de session:", err);
    res.status(500).json({ success: false, error: `Erreur d'initialisation VOD: ${err.message}` });
  }
}

/**
 * Handle GET /api/vod/session/:sessionId/status
 */
export function getVodSessionStatus(req: Request, res: Response) {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ success: false, error: "Session VOD introuvable" });
    return;
  }

  session.lastAccessTime = Date.now();

  res.json({
    success: true,
    sessionId: session.sessionId,
    status: session.status,
    mode: session.mode,
    container: session.container,
    videoCodec: session.videoCodec,
    audioCodec: session.audioCodec,
    resolution: session.resolution,
    fps: session.fps,
    contentType: session.contentType,
    rangeSupport: session.rangeSupport,
    videoCopied: session.videoCopied,
    videoTranscoded: session.videoTranscoded,
    audioCopied: session.audioCopied,
    audioTranscoded: session.audioTranscoded,
    ffmpegRunning: session.ffmpegRunning,
    playbackUrl: session.playbackUrl,
    startupTimeMs: session.startupTimeMs,
    errorMessage: session.errorMessage,
    lastLog: session.lastLog,
    lastError: session.lastError,
    logs: session.logs.slice(-20)
  });
}

/**
 * Handle GET /api/vod/session/:sessionId/stream - Streams direct VOD proxy with full HTTP Range seek support
 */
export async function streamVodDirect(req: Request, res: Response) {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).send("Session VOD introuvable");
    return;
  }

  session.lastAccessTime = Date.now();

  // If session is MP4 Fragmented Remux (optional streaming pipe)
  if (session.mode === "mp4-remux" || session.mode === "transcode") {
    // Pipe fragmented MP4 live!
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "none"); // Piping can't seek directly via ranges

    const headersList: string[] = [];
    const ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    headersList.push(`User-Agent: ${ua}`);
    if (session.mac) {
      headersList.push(`Cookie: mac=${session.mac}; timezone=Europe/Paris`);
    }
    if (session.token) {
      headersList.push(`Authorization: Bearer ${session.token}`);
    }

    const ffmpegArgs = [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "quiet",
      "-reconnect", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5"
    ];

    if (headersList.length > 0) {
      ffmpegArgs.push("-headers", headersList.join("\r\n") + "\r\n");
    }

    let fullInputUrl = session.upstreamUrl;
    if (session.mac && !fullInputUrl.includes("mac=")) {
      const sep = fullInputUrl.includes("?") ? "&" : "?";
      fullInputUrl = `${fullInputUrl}${sep}mac=${session.mac}`;
    }

    ffmpegArgs.push("-i", fullInputUrl);
    ffmpegArgs.push("-map", "0:v:0");
    ffmpegArgs.push("-c:v", "copy");
    ffmpegArgs.push("-map", "0:a:0?");
    
    if (session.audioCopied) {
      ffmpegArgs.push("-c:a", "copy");
    } else {
      ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
    }

    ffmpegArgs.push(
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1"
    );

    console.log(`[Stalker VOD MP4 Live Pipe] Démarrage du flux remuxé pour la session ${sessionId}`);
    const child = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "pipe", "ignore"] });
    session.process = child;
    session.pid = child.pid;
    session.ffmpegRunning = true;

    req.on("close", () => {
      console.log(`[Stalker VOD] Connexion client fermée, arrêt du processus de streaming MP4`);
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      session.ffmpegRunning = false;
    });

    child.stdout.pipe(res);
    return;
  }

  // Else, Direct Mode Proxy Stream with Range handling
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "Accept": "*/*"
  };

  if (session.mac) {
    headers["Cookie"] = `mac=${session.mac}; timezone=Europe/Paris`;
    headers["X-User-Agent"] = "Model: MAG250; Link: WiFi";
  }
  if (session.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  // Forward the Range header from browser to the upstream server
  if (req.headers.range) {
    headers["Range"] = req.headers.range as string;
  }

  try {
    const controller = new AbortController();
    
    // Stop proxy on client disconnect
    req.on("close", () => {
      controller.abort();
    });

    let targetUrl = session.upstreamUrl;
    if (session.mac && !targetUrl.includes("mac=")) {
      const sep = targetUrl.includes("?") ? "&" : "?";
      targetUrl = `${targetUrl}${sep}mac=${session.mac}`;
    }

    const response = await fetch(targetUrl, {
      headers,
      signal: controller.signal
    });

    // Forward status code (e.g. 206 Partial Content)
    res.status(response.status);

    // Forward essential response headers
    const headersToForward = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control"
    ];

    for (const h of headersToForward) {
      const val = response.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!response.body) {
      res.end();
      return;
    }

    // Pipe response body chunks to the express response
    const reader = response.body.getReader();
    
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          res.write(value);
        }
      } catch (err) {
        // Handle stream read errors or abort
        res.end();
      }
    };

    await pump();

  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.error(`[Stalker VOD Direct Proxy Error] ${err.message}`);
    }
    if (!res.headersSent) {
      res.status(502).send("Erreur de proxy de diffusion directe");
    }
  }
}

/**
 * Handle GET /api/vod/session/:sessionId/index.m3u8 - Serve the generated HLS playlist
 */
export function serveVodHlsManifest(req: Request, res: Response) {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session || !session.manifestPath) {
    res.status(404).send("Manifeste HLS VOD introuvable");
    return;
  }

  session.lastAccessTime = Date.now();

  try {
    if (!fs.existsSync(session.manifestPath)) {
      res.status(404).send("Manifeste HLS VOD en cours de création...");
      return;
    }

    let m3u8Content = fs.readFileSync(session.manifestPath, "utf-8");
    
    // Replace segment filenames with local session endpoints so that the browser routes
    // through our proxy to fetch the generated segments.
    // e.g. segment_0001.ts -> /api/vod/session/:sessionId/segment_0001.ts
    m3u8Content = m3u8Content.replace(/segment_(\d+)\.ts/g, `/api/vod/session/${sessionId}/segment_$1.ts`);

    res.setHeader("Content-Type", "application/x-mpegURL");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(m3u8Content);
  } catch (err: any) {
    res.status(500).send(`Erreur de lecture du manifeste HLS: ${err.message}`);
  }
}

/**
 * Handle GET /api/vod/session/:sessionId/:segment - Serve HLS .ts video segment
 */
export function serveVodHlsSegment(req: Request, res: Response) {
  const { sessionId, segment } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).send("Session VOD introuvable");
    return;
  }

  session.lastAccessTime = Date.now();

  const segmentPath = path.join(session.dir, segment);

  try {
    if (!fs.existsSync(segmentPath)) {
      res.status(404).send("Segment HLS VOD introuvable");
      return;
    }

    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Access-Control-Allow-Origin", "*");
    
    const stream = fs.createReadStream(segmentPath);
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).send(`Erreur de lecture du segment: ${err.message}`);
  }
}

/**
 * Handle POST /api/vod/session/:sessionId/stop - Stop session and clean up
 */
export function stopVodSessionEndpoint(req: Request, res: Response) {
  const { sessionId } = req.params;
  const success = stopVodSession(sessionId);
  res.json({ success });
}

/**
 * Stop a VOD session, kill FFmpeg, and delete its temp folder
 */
export function stopVodSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;

  console.log(`[Stalker VOD] Arrêt et nettoyage de la session ${sessionId}`);

  if (s.process && !s.process.killed) {
    try {
      s.process.kill("SIGKILL");
    } catch (_) {}
  }

  // Delete folder
  try {
    if (fs.existsSync(s.dir)) {
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[Stalker VOD] Échec du nettoyage de dossier pour la session ${sessionId}:`, err);
  }

  sessions.delete(sessionId);
  return true;
}

/**
 * Clean up all active VOD sessions (on exit or periodic)
 */
export function cleanupAllVodSessions() {
  for (const id of sessions.keys()) {
    stopVodSession(id);
  }
}

// Auto-clean inactive sessions every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    // Clean up if inactive for more than 45 seconds
    if (now - s.lastAccessTime > 45000) {
      console.log(`[Stalker VOD Garbage Collector] Nettoyage automatique de la session inactive: ${id}`);
      stopVodSession(id);
    }
  }
}, 10000);

// Register process exit hooks
process.on("SIGINT", cleanupAllVodSessions);
process.on("SIGTERM", cleanupAllVodSessions);
process.on("exit", cleanupAllVodSessions);
