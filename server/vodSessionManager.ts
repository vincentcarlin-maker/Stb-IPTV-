import { spawn, ChildProcess, execFile } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export interface VodResolutionDiagnostic {
  contentType: string;
  movieId: string;
  originalCmd: string;
  originalCmdMasked: string;
  originalCmdEmpty: 'YES' | 'NO';
  createLinkCalled: 'YES' | 'NO';
  createLinkStatus: 'SUCCESS' | 'FAILED';
  createLinkResponseReceived: 'YES' | 'NO';
  createLinkRawUrl: string;
  resolvedPathname: string;
  resolvedStream: string;
  resolvedType: string;
  hasPlayToken: boolean;
  hasTypeMovie: boolean;
  usesLivePhp: boolean;
  urlValidForVod: boolean;
  validationError?: string;
}

export function analyzeVodUrl(rawUrl: string, originalCmd?: string): VodResolutionDiagnostic {
  let contentType = 'MOVIE';
  if (
    (originalCmd && (originalCmd.includes('type=series') || originalCmd.includes('/series/'))) ||
    rawUrl.includes('type=series') || 
    rawUrl.includes('/series/')
  ) {
    contentType = 'SERIES';
  }

  let resolvedPathname = 'N/A';
  let resolvedStream = 'N/A';
  let resolvedType = 'N/A';
  let hasPlayToken = false;
  let hasTypeMovie = false;
  let usesLivePhp = false;
  let urlValidForVod = true;
  let validationError = '';
  let createLinkStatus: 'SUCCESS' | 'FAILED' = (rawUrl && rawUrl.startsWith('http')) ? 'SUCCESS' : 'FAILED';

  try {
    const parsed = new URL(rawUrl);
    resolvedPathname = parsed.pathname || 'N/A';

    const streamParam = parsed.searchParams.get('stream');
    if (streamParam) {
      resolvedStream = streamParam;
    }

    const typeParam = parsed.searchParams.get('type');
    if (typeParam) {
      resolvedType = typeParam;
    }

    hasPlayToken = parsed.searchParams.has('play_token') || rawUrl.includes('play_token=');
    hasTypeMovie = resolvedType === 'movie';
    usesLivePhp = parsed.pathname.includes('/play/live.php') || rawUrl.includes('live.php');

    if (usesLivePhp) {
      urlValidForVod = false;
      validationError = "Movie resolved to Live URL";
    } else if (contentType === 'MOVIE') {
      if (!parsed.pathname.includes('/play/movie.php')) {
        urlValidForVod = false;
        validationError = "NOT_A_MOVIE_URL";
      } else if (!streamParam || streamParam === "" || streamParam === ".") {
        urlValidForVod = false;
        validationError = "INVALID_MOVIE_STREAM";
      } else if (!typeParam || typeParam === "") {
        urlValidForVod = false;
        validationError = "MISSING_MOVIE_TYPE";
      }
    }
  } catch (e) {
    urlValidForVod = false;
    if (rawUrl.includes('/play/live.php') || rawUrl.includes('live.php')) {
      usesLivePhp = true;
      validationError = "Movie resolved to Live URL";
    } else {
      validationError = "INVALID_MOVIE_STREAM";
    }
  }

  let movieId = 'N/A';
  if (resolvedStream !== 'N/A' && resolvedStream !== '.') {
    movieId = resolvedStream;
  } else {
    const match = rawUrl.match(/\/(\d+\.[a-zA-Z0-9]+)/) || rawUrl.match(/stream=([^&]+)/i);
    if (match && match[1] && match[1] !== '.') {
      movieId = match[1];
    }
  }

  const maskedCmd = sanitizeSensitiveData(originalCmd || "");
  const originalCmdEmpty = originalCmd ? "NO" : "YES";
  const createLinkCalled = originalCmd ? "YES" : "NO";
  const createLinkResponseReceived = (rawUrl && rawUrl.startsWith('http')) ? "YES" : "NO";
  const createLinkRawUrl = sanitizeSensitiveData(rawUrl || "N/A");

  return {
    contentType,
    movieId,
    originalCmd: originalCmd || "",
    originalCmdMasked: maskedCmd,
    originalCmdEmpty: originalCmdEmpty as 'YES' | 'NO',
    createLinkCalled: createLinkCalled as 'YES' | 'NO',
    createLinkStatus,
    createLinkResponseReceived: createLinkResponseReceived as 'YES' | 'NO',
    createLinkRawUrl,
    resolvedPathname,
    resolvedStream,
    resolvedType,
    hasPlayToken,
    hasTypeMovie,
    usesLivePhp,
    urlValidForVod,
    validationError
  };
}

export interface VodDiagnostic {
  ffprobeStatus: 'SUCCESS' | 'FAILED' | 'ANALYZING';
  container: string;
  videoCodec: string;
  videoProfile: string;
  videoLevel?: string;
  pixFmt?: string;
  resolution?: string;
  width?: number;
  height?: number;
  hdr?: 'YES' | 'NO';
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  videoBitrate?: string;
  audioCodec: string;
  audioChannels: string | number;
  audioBitrate?: string;
  strategy: 'DIRECT' | 'REMUX_COPY_COPY' | 'VIDEO_COPY_AUDIO_AAC' | 'HEVC_COPY_COPY' | 'HEVC_COPY_AUDIO_AAC' | 'TRANSCODE_4K_TO_1080P_H264' | 'TRANSCODE_H264_AAC' | 'PROBE_FAILED' | 'ANALYZING' | string;
  videoTranscoding: boolean;
  audioTranscoding: boolean;
  output: string;
  videoTag?: string;
  segmentsReady: number;
  ffmpegStarted: 'YES' | 'NO';
  ffmpegExitCode?: number | string;
  ffmpegLastError?: string;
  ffmpegSpeed: string;
  timeToPlayable: string;
  timeToFirstSegment?: string;
  player: string;
  status: 'PREPARING' | 'READY' | 'PLAYING' | 'ERROR' | 'STOPPED';
  errorDetails?: string;
  probeError?: string;
  sourceHttp?: string;
  hevcCopyResult?: 'SUCCESS' | 'FAILED' | 'N/A';
  vodResolutionDiag?: VodResolutionDiagnostic;
}

export function sanitizeSensitiveData(str: string): string {
  if (!str) return "";
  return str
    .replace(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/g, "$1XX:XX:XX")
    .replace(/(mac=)[^&;\s]+/gi, "$1[MASKED]")
    .replace(/(play_token=)[^&;\s]+/gi, "$1[MASKED]")
    .replace(/(token=)[^&;\s]+/gi, "$1[MASKED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[MASKED]")
    .replace(/(Cookie:\s*)[^\r\n]+/gi, "$1[MASKED]")
    .replace(/(cookies?":\s*")[^"]+"/gi, '$1[MASKED]"');
}

export interface VodSession {
  sessionId: string;
  sourceUrl: string;
  headers?: Record<string, string>;
  sessionDir: string;
  masterM3u8Path: string;
  ffmpegProcess?: ChildProcess | null;
  createdAt: number;
  lastAccessedAt: number;
  ready: boolean;
  diagnostic: VodDiagnostic;
  rawProbeJson?: any;
}

const BASE_TEMP_DIR = path.join("/tmp", "vod-sessions");

class VodSessionManager {
  private static instance: VodSessionManager;
  private sessions: Map<string, VodSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    if (!fs.existsSync(BASE_TEMP_DIR)) {
      try {
        fs.mkdirSync(BASE_TEMP_DIR, { recursive: true });
      } catch (e: any) {
        console.warn("[VodSessionManager] Warning creating temp dir:", e.message);
      }
    }
    this.startCleanupTask();
  }

  public static getInstance(): VodSessionManager {
    if (!VodSessionManager.instance) {
      VodSessionManager.instance = new VodSessionManager();
    }
    return VodSessionManager.instance;
  }

  /**
   * Run ffprobe on the stream URL to analyze video, audio, container
   */
  public async probeStream(streamUrl: string, headers?: Record<string, string>): Promise<{
    success: boolean;
    format: any;
    streams: any[];
    probeError?: string;
    sourceHttp?: string;
  }> {
    const cleanUrl = (streamUrl || '').trim();

    if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
      const msg = sanitizeSensitiveData(`URL de flux invalide (non HTTP/HTTPS): ${cleanUrl.substring(0, 30)}`);
      console.warn("[ffprobe Warning]", msg);
      return { success: false, format: {}, streams: [], probeError: msg };
    }

    let userAgent = headers?.['User-Agent'] || headers?.['user-agent'];
    if (!userAgent || /Mozilla|Chrome|Safari|Firefox|Edge/i.test(userAgent)) {
      userAgent = "VLC/3.0.18 LibVLC/3.0.18";
    }

    const runProbeOnce = (): Promise<{
      success: boolean;
      format: any;
      streams: any[];
      probeError?: string;
      sourceHttp?: string;
    }> => {
      return new Promise((resolve) => {
        const ffprobeArgs: string[] = [
          "-v", "error",
          "-user_agent", userAgent,
          "-reconnect", "1",
          "-reconnect_at_eof", "1",
          "-reconnect_streamed", "1",
          "-rw_timeout", "15000000"
        ];

        if (headers) {
          const headerLines: string[] = [];
          for (const [k, v] of Object.entries(headers)) {
            if (k.toLowerCase() !== 'user-agent' && k.toLowerCase() !== 'host') {
              headerLines.push(`${k}: ${v}`);
            }
          }
          if (headerLines.length > 0) {
            ffprobeArgs.push("-headers", headerLines.join("\r\n") + "\r\n");
          }
        }

        ffprobeArgs.push(
          "-show_entries", "stream=index,codec_type,codec_name,codec_long_name,profile,level,pix_fmt,width,height,color_space,color_transfer,color_primaries,bit_rate,channels,channel_layout,sample_rate",
          "-show_entries", "format=format_name,duration,bit_rate,size",
          "-of", "json",
          cleanUrl
        );

        execFile("ffprobe", ffprobeArgs, { timeout: 16000 }, (error, stdout, stderr) => {
          const rawError = (stderr || error?.message || "").trim();

          // Extract HTTP status if present in error message (e.g. 502, 503, 403, 404)
          let sourceHttp: string | undefined = undefined;
          const httpMatch = rawError.match(/(?:Server returned|HTTP error|response code|status code|HTTP\/1\.[01])\s*(\d{3})/i);
          if (httpMatch) {
            sourceHttp = httpMatch[1];
          }

          if (error || rawError || !stdout) {
            const sanitizedErr = sanitizeSensitiveData(rawError || error?.message || "Échec de la commande ffprobe ou délai expiré");
            console.warn("[ffprobe Warning] Probe failed:", sanitizedErr);
            resolve({
              success: false,
              format: {},
              streams: [],
              probeError: sanitizedErr,
              sourceHttp
            });
            return;
          }

          try {
            const parsed = JSON.parse(stdout);
            const streams = parsed.streams || [];
            if (!Array.isArray(streams) || streams.length === 0) {
              resolve({
                success: false,
                format: parsed.format || {},
                streams: [],
                probeError: "Aucune piste média renvoyée par ffprobe",
                sourceHttp: "200"
              });
              return;
            }

            resolve({
              success: true,
              format: parsed.format || {},
              streams,
              probeError: undefined,
              sourceHttp: "200"
            });
          } catch (e: any) {
            const sanitizedParseErr = sanitizeSensitiveData(`Erreur d'analyse JSON ffprobe: ${e.message}`);
            console.warn("[ffprobe Error]", sanitizedParseErr);
            resolve({
              success: false,
              format: {},
              streams: [],
              probeError: sanitizedParseErr,
              sourceHttp
            });
          }
        });
      });
    };

    // First attempt
    let result = await runProbeOnce();

    // If source returned HTTP 502/503 or transient network failure, retry up to 2 times
    if (!result.success && (result.sourceHttp === '502' || result.sourceHttp === '503')) {
      console.warn(`[ffprobe] Source returned HTTP ${result.sourceHttp}, retrying probe in 1s (Attempt 2/3)...`);
      await new Promise((r) => setTimeout(r, 1000));
      result = await runProbeOnce();

      if (!result.success && (result.sourceHttp === '502' || result.sourceHttp === '503')) {
        console.warn(`[ffprobe] Source returned HTTP ${result.sourceHttp}, retrying probe in 1.5s (Attempt 3/3)...`);
        await new Promise((r) => setTimeout(r, 1500));
        result = await runProbeOnce();
      }
    }

    return result;
  }

  /**
   * Determine optimal streaming strategy based on container, video codec, audio codec
   */
  private determineStrategy(probeResult: {
    success: boolean;
    format: any;
    streams: any[];
    probeError?: string;
    sourceHttp?: string;
  }): {
    ffprobeStatus: 'SUCCESS' | 'FAILED';
    strategy: VodDiagnostic['strategy'];
    containerDisplay: string;
    videoCodecDisplay: string;
    videoProfileDisplay: string;
    videoLevel?: string;
    pixFmt?: string;
    resolution?: string;
    width?: number;
    height?: number;
    hdr?: 'YES' | 'NO';
    colorSpace?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    videoBitrate?: string;
    audioCodecDisplay: string;
    audioChannelsDisplay: string | number;
    audioBitrate?: string;
    videoTranscoding: boolean;
    audioTranscoding: boolean;
    videoTag?: string;
    outputFormat: string;
    probeError?: string;
    sourceHttp?: string;
  } {
    if (!probeResult.success) {
      return {
        ffprobeStatus: 'FAILED',
        strategy: 'PROBE_FAILED',
        containerDisplay: 'UNKNOWN',
        videoCodecDisplay: 'UNKNOWN',
        videoProfileDisplay: 'N/A',
        videoLevel: 'N/A',
        pixFmt: 'N/A',
        resolution: 'N/A',
        width: 0,
        height: 0,
        hdr: 'NO',
        colorSpace: 'N/A',
        colorTransfer: 'N/A',
        colorPrimaries: 'N/A',
        videoBitrate: 'N/A',
        audioCodecDisplay: 'NONE',
        audioChannelsDisplay: 'N/A',
        audioBitrate: 'N/A',
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'N/A',
        probeError: probeResult.probeError || 'Analyse ffprobe échouée',
        sourceHttp: probeResult.sourceHttp
      };
    }

    const streams = probeResult.streams || [];
    const formatInfo = probeResult.format || {};
    const rawFormat = (formatInfo.format_name || '').toLowerCase();

    // Find first track where codec_type === "video"
    const videoStream = streams.find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    if (!videoStream) {
      return {
        ffprobeStatus: 'FAILED',
        strategy: 'PROBE_FAILED',
        containerDisplay: 'UNKNOWN',
        videoCodecDisplay: 'UNKNOWN',
        videoProfileDisplay: 'N/A',
        videoLevel: 'N/A',
        pixFmt: 'N/A',
        resolution: 'N/A',
        width: 0,
        height: 0,
        hdr: 'NO',
        colorSpace: 'N/A',
        colorTransfer: 'N/A',
        colorPrimaries: 'N/A',
        videoBitrate: 'N/A',
        audioCodecDisplay: 'NONE',
        audioChannelsDisplay: 'N/A',
        audioBitrate: 'N/A',
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'N/A',
        probeError: 'Aucune piste vidéo trouvée dans le flux',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    const rawVideoCodec = (videoStream.codec_name || 'unknown').toLowerCase();
    const videoProfileDisplay = videoStream.profile || 'Main';
    const videoLevel = videoStream.level !== undefined && videoStream.level !== null ? String(videoStream.level) : 'N/A';
    const pixFmt = videoStream.pix_fmt || 'yuv420p';
    const width = Number(videoStream.width) || 0;
    const height = Number(videoStream.height) || 0;
    const resolution = width && height ? `${width}x${height}` : (width ? `${width}p` : (height ? `${height}p` : 'N/A'));
    const colorSpace = videoStream.color_space || 'N/A';
    const colorTransfer = videoStream.color_transfer || 'N/A';
    const colorPrimaries = videoStream.color_primaries || 'N/A';
    const videoBitrate = videoStream.bit_rate ? `${Math.round(Number(videoStream.bit_rate) / 1000)} kb/s` : 'N/A';

    // HDR detection (e.g. smpte2084, arib-std-b67, bt2020 or 10-bit color)
    const isHdr = (
      colorTransfer === 'smpte2084' || 
      colorTransfer === 'arib-std-b67' || 
      (typeof colorPrimaries === 'string' && colorPrimaries.toLowerCase().includes('2020')) || 
      (typeof pixFmt === 'string' && pixFmt.includes('10le') && colorTransfer !== 'N/A' && colorTransfer !== 'bt709')
    );
    const hdr: 'YES' | 'NO' = isHdr ? 'YES' : 'NO';

    // Find first track where codec_type === "audio"
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');
    const rawAudioCodec = audioStream ? (audioStream.codec_name || 'none').toLowerCase() : 'none';
    const audioChannelsDisplay = audioStream && audioStream.channels && !isNaN(Number(audioStream.channels)) 
      ? Number(audioStream.channels) 
      : 'N/A';
    const audioBitrate = audioStream?.bit_rate ? `${Math.round(Number(audioStream.bit_rate) / 1000)} kb/s` : 'N/A';

    // Container display label
    let containerDisplay = "MKV";
    if (rawFormat.includes("mp4") || rawFormat.includes("mov") || rawFormat.includes("m4a")) containerDisplay = "MP4";
    else if (rawFormat.includes("matroska") || rawFormat.includes("webm")) containerDisplay = "MKV";
    else if (rawFormat.includes("mpegts") || rawFormat.includes("ts")) containerDisplay = "TS";
    else if (rawFormat.includes("hls") || rawFormat.includes("apple")) containerDisplay = "HLS";
    else if (rawFormat.includes("avi")) containerDisplay = "AVI";
    else if (rawFormat.includes("flv")) containerDisplay = "FLV";

    // Video codec display label (lowercase standard)
    let videoCodecDisplay = rawVideoCodec;
    if (rawVideoCodec === "avc1" || rawVideoCodec === "avc") videoCodecDisplay = "h264";
    else if (rawVideoCodec === "h265" || rawVideoCodec === "hev1" || rawVideoCodec === "hvc1") videoCodecDisplay = "hevc";

    // Audio codec display label
    let audioCodecDisplay = rawAudioCodec;

    // Codec compatibility evaluation:
    const isH264Video = rawVideoCodec === "h264" || rawVideoCodec === "avc1" || rawVideoCodec === "avc";
    const isHevcVideo = rawVideoCodec === "hevc" || rawVideoCodec === "h265" || rawVideoCodec === "hev1" || rawVideoCodec === "hvc1";
    const isAacOrMp3Audio = rawAudioCodec === "aac" || rawAudioCodec === "mp3" || rawAudioCodec === "none";

    const is4K = width >= 3800 || height >= 2100 || width > 1920 || height > 1080;

    // 1. H264 + AAC -> REMUX_COPY_COPY (-c:v copy -c:a copy)
    if (isH264Video && isAacOrMp3Audio) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'REMUX_COPY_COPY',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        videoLevel,
        pixFmt,
        resolution,
        width,
        height,
        hdr,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        videoBitrate,
        audioCodecDisplay,
        audioChannelsDisplay,
        audioBitrate,
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'HLS fMP4',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    // 2. H264 + AC3 / EAC3 / DTS / TrueHD -> VIDEO_COPY_AUDIO_AAC (-c:v copy -c:a aac)
    if (isH264Video) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'VIDEO_COPY_AUDIO_AAC',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        videoLevel,
        pixFmt,
        resolution,
        width,
        height,
        hdr,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        videoBitrate,
        audioCodecDisplay,
        audioChannelsDisplay,
        audioBitrate,
        videoTranscoding: false,
        audioTranscoding: true,
        outputFormat: 'HLS fMP4',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    // 3. HEVC / H265 + AAC -> HEVC_COPY_COPY (-c:v copy -c:a copy -tag:v hvc1)
    if (isHevcVideo && isAacOrMp3Audio) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'HEVC_COPY_COPY',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        videoLevel,
        pixFmt,
        resolution,
        width,
        height,
        hdr,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        videoBitrate,
        audioCodecDisplay,
        audioChannelsDisplay,
        audioBitrate,
        videoTranscoding: false,
        audioTranscoding: false,
        videoTag: 'hvc1',
        outputFormat: 'HLS fMP4',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    // 4. HEVC / H265 + AC3 / EAC3 / DTS / TrueHD / etc. -> HEVC_COPY_AUDIO_AAC (-c:v copy -c:a aac -b:a 192k -ac 2 -tag:v hvc1)
    if (isHevcVideo) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'HEVC_COPY_AUDIO_AAC',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        videoLevel,
        pixFmt,
        resolution,
        width,
        height,
        hdr,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        videoBitrate,
        audioCodecDisplay,
        audioChannelsDisplay,
        audioBitrate,
        videoTranscoding: false,
        audioTranscoding: true,
        videoTag: 'hvc1',
        outputFormat: 'HLS fMP4',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    // 5. Incompatible video codec needing conversion (e.g. mpeg2, vc1, av1 without direct browser support)
    // If 4K/UHD, transcode to 1080p H.264 (-vf "scale=-2:1080") to conserve CPU
    if (is4K) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'TRANSCODE_4K_TO_1080P_H264',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        videoLevel,
        pixFmt,
        resolution,
        width,
        height,
        hdr,
        colorSpace,
        colorTransfer,
        colorPrimaries,
        videoBitrate,
        audioCodecDisplay,
        audioChannelsDisplay,
        audioBitrate,
        videoTranscoding: true,
        audioTranscoding: true,
        outputFormat: 'HLS fMP4',
        sourceHttp: probeResult.sourceHttp || '200'
      };
    }

    // Standard non-4K transcode fallback
    return {
      ffprobeStatus: 'SUCCESS',
      strategy: 'TRANSCODE_H264_AAC',
      containerDisplay,
      videoCodecDisplay,
      videoProfileDisplay,
      videoLevel,
      pixFmt,
      resolution,
      width,
      height,
      hdr,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      videoBitrate,
      audioCodecDisplay,
      audioChannelsDisplay,
      audioBitrate,
      videoTranscoding: true,
      audioTranscoding: true,
      outputFormat: 'HLS fMP4',
      sourceHttp: probeResult.sourceHttp || '200'
    };
  }

  /**
   * Start or retrieve an active VOD playback session
   */
  public async getOrCreateSession(sourceUrl: string, headers?: Record<string, string>, originalCmd?: string): Promise<{ session: VodSession; isNew: boolean }> {
    const cleanUrl = sourceUrl.trim();

    // Check for an existing active session with the exact same source URL
    for (const session of this.sessions.values()) {
      if (session.sourceUrl === cleanUrl) {
        session.lastAccessedAt = Date.now();
        console.log(`[VodSessionManager] Reusing active session ${session.sessionId} for stream.`);
        return { session, isNew: false };
      }
    }

    // Create unique sessionId (e.g. vod_82c729a1f2e4)
    const sessionId = `vod_${crypto.randomBytes(6).toString("hex")}`;
    const sessionDir = path.join(BASE_TEMP_DIR, sessionId);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const masterM3u8Path = path.join(sessionDir, "master.m3u8");

    // 1. Analyze VOD URL resolution before ffprobe
    const vodDiag = analyzeVodUrl(cleanUrl, originalCmd);

    console.log(`
===== VOD RESOLUTION DEBUG =====

Movie ID:
${vodDiag.movieId}

Original CMD:
${vodDiag.originalCmdMasked}

Original CMD empty:
${vodDiag.originalCmdEmpty}

create_link called:
${vodDiag.createLinkCalled}

create_link response received:
${vodDiag.createLinkResponseReceived}

create_link raw URL:
${vodDiag.createLinkRawUrl}

Resolved pathname:
${vodDiag.resolvedPathname}

Resolved stream:
${vodDiag.resolvedStream}

Resolved type:
${vodDiag.resolvedType}

Has play_token:
${vodDiag.hasPlayToken ? 'YES' : 'NO'}

VOD URL VALID:
${vodDiag.urlValidForVod ? 'YES' : 'NO'}
`);

    console.log(`
===== VOD RESOLUTION =====

Content type:
${vodDiag.contentType}

create_link:
${vodDiag.createLinkStatus}

Resolved pathname:
${vodDiag.resolvedPathname}

Resolved stream:
${vodDiag.resolvedStream}

Resolved type:
${vodDiag.resolvedType}

Has token:
${vodDiag.hasPlayToken ? 'YES' : 'NO'}

URL VALID:
${vodDiag.urlValidForVod ? 'YES' : 'NO'}
`);

    // 2. BLOCK FFPROBE IF URL IS INVALID (USER REQ 4, 5, 8)
    if (!vodDiag.urlValidForVod) {
      let reasonLabel = "INVALID_MOVIE_STREAM";
      if (vodDiag.validationError === "MISSING_MOVIE_TYPE") {
        reasonLabel = "MISSING_MOVIE_TYPE";
      } else if (vodDiag.validationError === "Movie resolved to Live URL") {
        reasonLabel = "Movie resolved to Live URL";
      } else if (vodDiag.validationError === "NOT_A_MOVIE_URL") {
        reasonLabel = "NOT_A_MOVIE_URL";
      }
      
      const vodErrorMsg = `VOD_RESOLUTION_ERROR\nReason: ${reasonLabel}`;
      console.warn(`[VodSessionManager] ${vodErrorMsg}`);

      const diagnostic: VodDiagnostic = {
        ffprobeStatus: 'FAILED',
        container: 'N/A',
        videoCodec: 'N/A',
        videoProfile: 'N/A',
        videoLevel: 'N/A',
        pixFmt: 'N/A',
        resolution: 'N/A',
        hdr: 'NO',
        colorTransfer: 'N/A',
        colorPrimaries: 'N/A',
        audioCodec: 'N/A',
        audioChannels: 'N/A',
        strategy: 'PROBE_FAILED',
        videoTranscoding: false,
        audioTranscoding: false,
        output: 'N/A',
        segmentsReady: 0,
        ffmpegStarted: 'NO',
        ffmpegExitCode: 'N/A',
        ffmpegSpeed: "0.0x",
        timeToPlayable: "N/A",
        player: "NONE",
        status: "ERROR",
        errorDetails: vodErrorMsg,
        probeError: vodErrorMsg,
        hevcCopyResult: 'N/A',
        vodResolutionDiag: vodDiag
      };

      const session: VodSession = {
        sessionId,
        sourceUrl: cleanUrl,
        headers,
        sessionDir,
        masterM3u8Path,
        ffmpegProcess: null,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        ready: false,
        diagnostic
      };

      this.sessions.set(sessionId, session);
      return { session, isNew: true };
    }

    // 3. ONLY ONCE VOD URL IS VALID, RUN FFPROBE (USER REQ 6)
    const probeResult = await this.probeStream(cleanUrl, headers);
    const decision = this.determineStrategy(probeResult);

    const isHevcStrategy = decision.strategy === 'HEVC_COPY_COPY' || decision.strategy === 'HEVC_COPY_AUDIO_AAC';

    const diagnostic: VodDiagnostic = {
      ffprobeStatus: decision.ffprobeStatus,
      container: decision.containerDisplay,
      videoCodec: decision.videoCodecDisplay,
      videoProfile: decision.videoProfileDisplay,
      videoLevel: decision.videoLevel,
      pixFmt: decision.pixFmt,
      resolution: decision.resolution,
      width: decision.width,
      height: decision.height,
      hdr: decision.hdr,
      colorSpace: decision.colorSpace,
      colorTransfer: decision.colorTransfer,
      colorPrimaries: decision.colorPrimaries,
      videoBitrate: decision.videoBitrate,
      audioCodec: decision.audioCodecDisplay,
      audioChannels: decision.audioChannelsDisplay,
      audioBitrate: decision.audioBitrate,
      strategy: decision.strategy,
      videoTranscoding: decision.videoTranscoding,
      audioTranscoding: decision.audioTranscoding,
      output: decision.outputFormat,
      videoTag: decision.videoTag,
      segmentsReady: 0,
      ffmpegStarted: 'NO',
      ffmpegExitCode: 'N/A',
      ffmpegSpeed: "1.0x",
      timeToPlayable: "calculating...",
      player: "NATIVE_HLS / HLS_JS",
      status: decision.strategy === 'PROBE_FAILED' ? "ERROR" : "PREPARING",
      errorDetails: decision.probeError,
      probeError: decision.probeError,
      sourceHttp: decision.sourceHttp || probeResult.sourceHttp,
      hevcCopyResult: isHevcStrategy ? 'N/A' : 'N/A',
      vodResolutionDiag: vodDiag
    };

    const session: VodSession = {
      sessionId,
      sourceUrl: cleanUrl,
      headers,
      sessionDir,
      masterM3u8Path,
      ffmpegProcess: null,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      ready: false,
      diagnostic,
      rawProbeJson: probeResult
    };

    this.sessions.set(sessionId, session);

    // If strategy is PROBE_FAILED, do NOT launch FFmpeg!
    if (decision.strategy === 'PROBE_FAILED') {
      console.warn(`[VodSessionManager] Session ${sessionId} failed probe: ${decision.probeError}`);
      session.ready = false;
      return { session, isNew: true };
    }

    // Build FFmpeg command for HLS fMP4 progressive output
    let userAgent = headers?.['User-Agent'] || headers?.['user-agent'];
    if (!userAgent || /Mozilla|Chrome|Safari|Firefox|Edge/i.test(userAgent)) {
      userAgent = "VLC/3.0.18 LibVLC/3.0.18";
    }

    // Determine video codec flags
    let videoArgs: string[] = [];
    if (decision.strategy === 'HEVC_COPY_COPY' || decision.strategy === 'HEVC_COPY_AUDIO_AAC') {
      // Direct HEVC Copy mode with standard hvc1 box tagging for fMP4
      videoArgs = ["-c:v", "copy", "-tag:v", "hvc1"];
    } else if (decision.strategy === 'REMUX_COPY_COPY' || decision.strategy === 'VIDEO_COPY_AUDIO_AAC') {
      // Direct H.264 Copy mode
      videoArgs = ["-c:v", "copy"];
    } else if (decision.strategy === 'TRANSCODE_4K_TO_1080P_H264') {
      // 4K Downscale Transcode mode to prevent CPU overload
      videoArgs = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-vf", "scale=-2:1080"];
    } else if (decision.videoTranscoding) {
      // Standard Transcode mode
      videoArgs = ["-c:v", "libx264", "-preset", "fast", "-crf", "22"];
    } else {
      videoArgs = ["-c:v", "copy"];
    }

    // Determine audio codec flags
    const audioArgs = decision.audioTranscoding
      ? ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]
      : ["-c:a", "copy"];

    const ffmpegArgs: string[] = [
      "-y",
      "-user_agent", userAgent
    ];

    if (headers) {
      const headerLines: string[] = [];
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() !== 'user-agent') {
          headerLines.push(`${k}: ${v}`);
        }
      }
      if (headerLines.length > 0) {
        ffmpegArgs.push("-headers", headerLines.join("\r\n") + "\r\n");
      }
    }

    ffmpegArgs.push(
      "-reconnect", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_streamed", "1",
      "-i", cleanUrl,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      ...videoArgs,
      ...audioArgs,
      "-sn",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "0",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", path.join(sessionDir, "segment_%05d.m4s"),
      masterM3u8Path
    );

    console.log(`
===== VOD 4K / HEVC =====

CONTAINER:
${decision.containerDisplay}

VIDEO CODEC:
${decision.videoCodecDisplay}

PROFILE:
${decision.videoProfileDisplay}

PIX FORMAT:
${decision.pixFmt || 'N/A'}

RESOLUTION:
${decision.resolution || 'N/A'}

HDR:
${decision.hdr || 'NO'}

COLOR TRANSFER:
${decision.colorTransfer || 'N/A'}

COLOR PRIMARIES:
${decision.colorPrimaries || 'N/A'}

AUDIO CODEC:
${decision.audioCodecDisplay}

AUDIO CHANNELS:
${decision.audioChannelsDisplay}

STRATEGY:
${decision.strategy}

VIDEO TRANSCODING:
${decision.videoTranscoding ? 'YES' : 'NO'}

AUDIO TRANSCODING:
${decision.audioTranscoding ? 'YES' : 'NO'}

OUTPUT:
${decision.outputFormat}

VIDEO TAG:
${decision.videoTag || 'N/A'}

PLAYER:
${diagnostic.player}

STATUS:
${diagnostic.status}
`);

    console.log(`[VodSessionManager] Launching FFmpeg [${decision.strategy}] for session ${sessionId}`);

    const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    session.ffmpegProcess = ffmpegProc;
    session.diagnostic.ffmpegStarted = 'YES';
    session.diagnostic.ffmpegExitCode = 'RUNNING';

    // Monitor stderr for speed stats, HTTP statuses, and errors
    ffmpegProc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      const speedMatch = text.match(/speed=\s*([\d\.]+x)/);
      if (speedMatch) {
        session.diagnostic.ffmpegSpeed = speedMatch[1];
      }

      // Check for source HTTP status codes (e.g. 502, 503, 403, 200)
      const httpMatch = text.match(/(?:Server returned|HTTP error|response code|status code|HTTP\/1\.[01])\s*(\d{3})/i);
      if (httpMatch) {
        session.diagnostic.sourceHttp = httpMatch[1];
        if (httpMatch[1] === '502' || httpMatch[1] === '503') {
          console.warn(`[FFmpeg VOD Session ${sessionId}] Source returned HTTP ${httpMatch[1]} (IPTV source overload/gateway error)`);
        }
      }

      if (text.includes("Error") || text.includes("HTTP error") || text.includes("Invalid")) {
        const sanitized = sanitizeSensitiveData(text.trim().slice(0, 200));
        session.diagnostic.ffmpegLastError = sanitized;
        console.warn(`[FFmpeg VOD Session ${sessionId} Warn]`, sanitized);
      }
    });

    ffmpegProc.on("error", (err: Error) => {
      const sanitizedErr = sanitizeSensitiveData(err.message);
      console.error(`[FFmpeg VOD Session ${sessionId} Error]`, sanitizedErr);
      session.diagnostic.status = "ERROR";
      session.diagnostic.errorDetails = sanitizedErr;
      session.diagnostic.ffmpegLastError = sanitizedErr;
      if (isHevcStrategy) {
        session.diagnostic.hevcCopyResult = 'FAILED';
      }
    });

    ffmpegProc.on("exit", (code, signal) => {
      console.log(`[FFmpeg VOD Session ${sessionId} Exit] code=${code}, signal=${signal}`);
      session.diagnostic.ffmpegExitCode = code !== null ? code : `signal_${signal}`;
      if (session.diagnostic.status === "PREPARING") {
        session.diagnostic.status = "ERROR";
        session.diagnostic.errorDetails = session.diagnostic.ffmpegLastError || `FFmpeg exited prematurely with code ${code}`;
        if (isHevcStrategy) {
          session.diagnostic.hevcCopyResult = 'FAILED';
        }
      }
    });

    // Poll for session readiness (master.m3u8 + init.mp4 + at least 1-2 segments)
    const startTime = Date.now();
    await this.waitForSessionReadiness(session, startTime, isHevcStrategy);

    return { session, isNew: true };
  }

  /**
   * Poll directory until master.m3u8, init.mp4 and at least 2 segment files exist
   */
  private async waitForSessionReadiness(session: VodSession, startTime: number, isHevcStrategy?: boolean): Promise<void> {
    const maxWaitMs = 12000;
    const pollIntervalMs = 200;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        try {
          const files = fs.readdirSync(session.sessionDir);
          const hasMaster = files.includes("master.m3u8");
          const hasInit = files.includes("init.mp4");
          const segments = files.filter(f => f.endsWith(".m4s"));

          session.diagnostic.segmentsReady = segments.length;

          // Ready condition: master.m3u8 + init.mp4 + at least 1 or 2 segments
          if ((hasMaster && hasInit && segments.length >= 2) || (hasMaster && hasInit && segments.length >= 1 && elapsed > 2500)) {
            clearInterval(interval);
            session.ready = true;
            session.diagnostic.status = "READY";
            const durationSec = (elapsed / 1000).toFixed(1);
            session.diagnostic.timeToPlayable = `${durationSec} sec`;
            session.diagnostic.timeToFirstSegment = `${durationSec} sec`;
            if (isHevcStrategy) {
              session.diagnostic.hevcCopyResult = 'SUCCESS';
            }
            console.log(`[VodSessionManager] Session ${session.sessionId} READY in ${session.diagnostic.timeToPlayable} with ${segments.length} segments!`);
            resolve();
            return;
          }

          if (elapsed >= maxWaitMs) {
            clearInterval(interval);
            if (hasMaster) {
              session.ready = true;
              session.diagnostic.status = "READY";
              const durationSec = (elapsed / 1000).toFixed(1);
              session.diagnostic.timeToPlayable = `${durationSec} sec (timeout)`;
              session.diagnostic.timeToFirstSegment = `${durationSec} sec`;
              if (isHevcStrategy) {
                session.diagnostic.hevcCopyResult = 'SUCCESS';
              }
            } else {
              session.diagnostic.status = "ERROR";
              session.diagnostic.errorDetails = session.diagnostic.ffmpegLastError || "Timeout waiting for HLS segments";
              if (isHevcStrategy) {
                session.diagnostic.hevcCopyResult = 'FAILED';
              }
            }
            resolve();
            return;
          }
        } catch (e) {
          if (elapsed >= maxWaitMs) {
            clearInterval(interval);
            resolve();
          }
        }
      }, pollIntervalMs);
    });
  }

  /**
   * Get an existing session by ID
   */
  public getSession(sessionId: string): VodSession | undefined {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.lastAccessedAt = Date.now();
      // Count segments on disk
      try {
        if (fs.existsSync(s.sessionDir)) {
          const files = fs.readdirSync(s.sessionDir);
          s.diagnostic.segmentsReady = files.filter(f => f.endsWith(".m4s")).length;
        }
      } catch (_) {}
    }
    return s;
  }

  /**
   * Stop an active session, kill FFmpeg process, remove files
   */
  public stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    console.log(`[VodSessionManager] Stopping session ${sessionId}...`);

    if (session.ffmpegProcess) {
      try {
        session.ffmpegProcess.kill("SIGKILL");
      } catch (_) {}
      session.ffmpegProcess = null;
    }

    try {
      if (fs.existsSync(session.sessionDir)) {
        fs.rmSync(session.sessionDir, { recursive: true, force: true });
      }
    } catch (e: any) {
      console.warn(`[VodSessionManager] Failed to remove dir for ${sessionId}:`, e.message);
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Periodically clean up inactive or stale sessions
   */
  private startCleanupTask() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAgeMs = 15 * 60 * 1000; // 15 minutes of inactivity

      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastAccessedAt > maxAgeMs) {
          console.log(`[VodSessionManager Cleanup] Cleaning up stale session ${sessionId}`);
          this.stopSession(sessionId);
        }
      }
    }, 2 * 60 * 1000); // Check every 2 minutes
  }
}

export const vodSessionManager = VodSessionManager.getInstance();

