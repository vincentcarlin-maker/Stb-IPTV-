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

export interface AudioTrackInfo {
  id: number;
  index: number;
  codec: string;
  channels: number | string;
  language: string;
  title: string;
}

export interface SubtitleTrackInfo {
  id: number;
  index: number;
  codec: string;
  language: string;
  title: string;
}

export interface VodDiagnostic {
  ffprobeStatus: 'SUCCESS' | 'FAILED';
  container: string;
  videoCodec: string;
  videoProfile: string;
  pixFmt: string;
  resolution: string;
  isHdr: 'YES' | 'NO';
  colorTransfer: string;
  colorSpace: string;
  colorPrimaries: string;
  bitRate: string;
  audioCodec: string;
  audioChannels: string | number;
  strategy: 'DIRECT' | 'REMUX_COPY_COPY' | 'VIDEO_COPY_AUDIO_AAC' | 'HEVC_COPY_COPY' | 'HEVC_COPY_AUDIO_AAC' | 'TRANSCODE_4K_TO_1080P_H264' | 'TRANSCODE_H264_AAC' | 'PROBE_FAILED';
  videoTranscoding: boolean;
  audioTranscoding: boolean;
  output: string;
  videoTag: string;
  segmentsReady: number;
  ffmpegSpeed: string;
  timeToPlayable: string;
  timeToFirstSegment: string;
  player: string;
  status: 'PREPARING' | 'READY' | 'PLAYING' | 'ERROR' | 'STOPPED';
  duration?: number;
  audioTracks?: AudioTrackInfo[];
  subtitleTracks?: SubtitleTrackInfo[];
  errorDetails?: string;
  probeError?: string;
  vodResolutionDiag?: VodResolutionDiagnostic;
  ffmpegExitCode?: number | null;
  ffmpegLastError?: string;
  sourceHttpStatus?: number | string;
  hevcCopyResult?: 'SUCCESS' | 'FAILED' | 'NOT_APPLICABLE';
  playerError?: string;
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
  videoArgs?: string[];
  audioArgs?: string[];
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
   * Run ffprobe on the stream URL to analyze video, audio, container with 502/503 retry protection
   */
  public async probeStream(streamUrl: string, headers?: Record<string, string>, retryCount = 0): Promise<{
    success: boolean;
    format: any;
    streams: any[];
    probeError?: string;
    sourceHttpStatus?: number | string;
  }> {
    const cleanUrl = (streamUrl || '').trim();

    if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
      const msg = sanitizeSensitiveData(`URL de flux invalide (non HTTP/HTTPS): ${cleanUrl.substring(0, 30)}`);
      console.warn("[ffprobe Warning]", msg);
      return { success: false, format: {}, streams: [], probeError: msg, sourceHttpStatus: 'INVALID_URL' };
    }

    let userAgent = headers?.['User-Agent'] || headers?.['user-agent'];
    if (!userAgent || /Mozilla|Chrome|Safari|Firefox|Edge/i.test(userAgent)) {
      userAgent = "VLC/3.0.18 LibVLC/3.0.18";
    }

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

    // Comprehensive ffprobe stream entries (codec_name, codec_long_name, profile, level, pix_fmt, resolution, color space & transfer, bit_rate)
    ffprobeArgs.push(
      "-show_entries", "stream=index,codec_type,codec_name,codec_long_name,profile,level,pix_fmt,width,height,color_space,color_transfer,color_primaries,channels,sample_rate,duration,bit_rate,tags",
      "-show_entries", "format=format_name,duration,size,bit_rate,tags",
      "-of", "json",
      cleanUrl
    );

    return new Promise((resolve) => {
      execFile("ffprobe", ffprobeArgs, { timeout: 16000 }, async (error, stdout, stderr) => {
        const rawError = (stderr || error?.message || "").trim();
        let sourceHttpStatus: number | string = 200;

        if (rawError.includes("502") || rawError.includes("Bad Gateway")) {
          sourceHttpStatus = 502;
        } else if (rawError.includes("503") || rawError.includes("Service Unavailable")) {
          sourceHttpStatus = 503;
        } else if (rawError.includes("403") || rawError.includes("Forbidden")) {
          sourceHttpStatus = 403;
        } else if (rawError.includes("404") || rawError.includes("Not Found")) {
          sourceHttpStatus = 404;
        }

        // Retry for transient 502 / 503 / timeout without misdiagnosing as codec error
        if ((sourceHttpStatus === 502 || sourceHttpStatus === 503) && retryCount < 2) {
          console.warn(`[ffprobe Retry] Source returned HTTP ${sourceHttpStatus}, retrying probe (${retryCount + 1}/2)...`);
          await new Promise((r) => setTimeout(r, 600));
          const retryResult = await this.probeStream(cleanUrl, headers, retryCount + 1);
          resolve(retryResult);
          return;
        }

        if (error || rawError || !stdout) {
          const sanitizedErr = sanitizeSensitiveData(rawError || error?.message || "Échec de la commande ffprobe ou délai expiré");
          console.warn("[ffprobe Warning] Probe failed:", sanitizedErr);
          resolve({
            success: false,
            format: {},
            streams: [],
            probeError: sanitizedErr,
            sourceHttpStatus
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
              sourceHttpStatus
            });
            return;
          }

          resolve({
            success: true,
            format: parsed.format || {},
            streams,
            probeError: undefined,
            sourceHttpStatus
          });
        } catch (e: any) {
          const sanitizedParseErr = sanitizeSensitiveData(`Erreur d'analyse JSON ffprobe: ${e.message}`);
          console.warn("[ffprobe Error]", sanitizedParseErr);
          resolve({
            success: false,
            format: {},
            streams: [],
            probeError: sanitizedParseErr,
            sourceHttpStatus
          });
        }
      });
    });
  }

  /**
   * Determine optimal streaming strategy based on container, video codec (H264 / HEVC / Other), resolution, audio codec
   */
  private determineStrategy(probeResult: {
    success: boolean;
    format: any;
    streams: any[];
    probeError?: string;
    sourceHttpStatus?: number | string;
  }, options?: { forceFallback?: boolean }): {
    ffprobeStatus: 'SUCCESS' | 'FAILED';
    strategy: VodDiagnostic['strategy'];
    containerDisplay: string;
    videoCodecDisplay: string;
    videoProfileDisplay: string;
    pixFmtDisplay: string;
    resolutionDisplay: string;
    isHdrDisplay: 'YES' | 'NO';
    colorTransferDisplay: string;
    colorSpaceDisplay: string;
    colorPrimariesDisplay: string;
    bitRateDisplay: string;
    audioCodecDisplay: string;
    audioChannelsDisplay: string | number;
    videoTranscoding: boolean;
    audioTranscoding: boolean;
    outputFormat: string;
    videoTag: string;
    videoArgs: string[];
    audioArgs: string[];
    hevcCopyResult: 'SUCCESS' | 'FAILED' | 'NOT_APPLICABLE';
    probeError?: string;
    sourceHttpStatus?: number | string;
  } {
    const sourceHttpStatus = probeResult.sourceHttpStatus || 200;

    if (!probeResult.success) {
      return {
        ffprobeStatus: 'FAILED',
        strategy: 'PROBE_FAILED',
        containerDisplay: 'UNKNOWN',
        videoCodecDisplay: 'UNKNOWN',
        videoProfileDisplay: 'N/A',
        pixFmtDisplay: 'N/A',
        resolutionDisplay: 'N/A',
        isHdrDisplay: 'NO',
        colorTransferDisplay: 'N/A',
        colorSpaceDisplay: 'N/A',
        colorPrimariesDisplay: 'N/A',
        bitRateDisplay: 'N/A',
        audioCodecDisplay: 'NONE',
        audioChannelsDisplay: 'N/A',
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'N/A',
        videoTag: 'none',
        videoArgs: [],
        audioArgs: [],
        hevcCopyResult: 'NOT_APPLICABLE',
        probeError: probeResult.probeError || 'Analyse ffprobe échouée',
        sourceHttpStatus
      };
    }

    const streams = probeResult.streams || [];
    const formatInfo = probeResult.format || {};
    const rawFormat = (formatInfo.format_name || '').toLowerCase();

    // Find primary video track
    const videoStream = streams.find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    if (!videoStream) {
      return {
        ffprobeStatus: 'FAILED',
        strategy: 'PROBE_FAILED',
        containerDisplay: 'UNKNOWN',
        videoCodecDisplay: 'UNKNOWN',
        videoProfileDisplay: 'N/A',
        pixFmtDisplay: 'N/A',
        resolutionDisplay: 'N/A',
        isHdrDisplay: 'NO',
        colorTransferDisplay: 'N/A',
        colorSpaceDisplay: 'N/A',
        colorPrimariesDisplay: 'N/A',
        bitRateDisplay: 'N/A',
        audioCodecDisplay: 'NONE',
        audioChannelsDisplay: 'N/A',
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'N/A',
        videoTag: 'none',
        videoArgs: [],
        audioArgs: [],
        hevcCopyResult: 'NOT_APPLICABLE',
        probeError: 'Aucune piste vidéo trouvée',
        sourceHttpStatus
      };
    }

    const rawVideoCodec = (videoStream.codec_name || 'unknown').toLowerCase();
    const videoProfileDisplay = videoStream.profile || 'Main';
    const pixFmtDisplay = videoStream.pix_fmt || 'yuv420p';
    const width = Number(videoStream.width) || 0;
    const height = Number(videoStream.height) || 0;
    const resolutionDisplay = (width > 0 && height > 0) ? `${width}x${height}` : '1080p';
    const colorTransferDisplay = videoStream.color_transfer || 'bt709';
    const colorSpaceDisplay = videoStream.color_space || 'bt709';
    const colorPrimariesDisplay = videoStream.color_primaries || 'bt709';

    // HDR Detection
    const isHdr = (
      colorTransferDisplay === 'smpte2084' ||
      colorTransferDisplay === 'arib-std-b67' ||
      colorPrimariesDisplay === 'bt2020' ||
      videoProfileDisplay.toLowerCase().includes('10') ||
      pixFmtDisplay.includes('10')
    );
    const isHdrDisplay: 'YES' | 'NO' = isHdr ? 'YES' : 'NO';

    // Bitrate calculation
    const rawBitRate = Number(videoStream.bit_rate || formatInfo.bit_rate) || 0;
    let bitRateDisplay = 'N/A';
    if (rawBitRate > 0) {
      bitRateDisplay = `${(rawBitRate / 1000000).toFixed(1)} Mbps`;
    }

    // Find primary audio track
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');
    const rawAudioCodec = audioStream ? (audioStream.codec_name || 'none').toLowerCase() : 'none';
    const audioChannelsDisplay = audioStream && audioStream.channels && !isNaN(Number(audioStream.channels))
      ? Number(audioStream.channels)
      : 'N/A';

    // Container display label
    let containerDisplay = "MKV";
    if (rawFormat.includes("mp4") || rawFormat.includes("mov") || rawFormat.includes("m4a")) containerDisplay = "MP4";
    else if (rawFormat.includes("matroska") || rawFormat.includes("webm")) containerDisplay = "MKV";
    else if (rawFormat.includes("mpegts") || rawFormat.includes("ts")) containerDisplay = "TS";
    else if (rawFormat.includes("hls") || rawFormat.includes("apple")) containerDisplay = "HLS";
    else if (rawFormat.includes("avi")) containerDisplay = "AVI";
    else if (rawFormat.includes("flv")) containerDisplay = "FLV";

    // Video codec display label
    let videoCodecDisplay = rawVideoCodec;
    if (rawVideoCodec === "avc1" || rawVideoCodec === "avc") videoCodecDisplay = "h264";
    if (rawVideoCodec === "h265" || rawVideoCodec === "hvc1") videoCodecDisplay = "hevc";

    // Audio codec display label
    const audioCodecDisplay = rawAudioCodec;

    // Codec category analysis
    const isH264Video = videoCodecDisplay === "h264";
    const isHevcVideo = videoCodecDisplay === "hevc";
    const isAacOrMp3Audio = rawAudioCodec === "aac" || rawAudioCodec === "mp3" || rawAudioCodec === "none";
    const is4K = width >= 3840 || height >= 2160 || width >= 3000;

    // --- FALLBACK STRATEGY (When HEVC copy cannot be decoded on client or explicit fallback requested) ---
    if (options?.forceFallback) {
      if (is4K) {
        return {
          ffprobeStatus: 'SUCCESS',
          strategy: 'TRANSCODE_4K_TO_1080P_H264',
          containerDisplay,
          videoCodecDisplay,
          videoProfileDisplay,
          pixFmtDisplay,
          resolutionDisplay,
          isHdrDisplay,
          colorTransferDisplay,
          colorSpaceDisplay,
          colorPrimariesDisplay,
          bitRateDisplay,
          audioCodecDisplay,
          audioChannelsDisplay,
          videoTranscoding: true,
          audioTranscoding: true,
          outputFormat: 'HLS fMP4',
          videoTag: 'avc1',
          videoArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-vf", "scale=-2:1080"],
          audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
          hevcCopyResult: 'FAILED',
          sourceHttpStatus
        };
      } else {
        return {
          ffprobeStatus: 'SUCCESS',
          strategy: 'TRANSCODE_H264_AAC',
          containerDisplay,
          videoCodecDisplay,
          videoProfileDisplay,
          pixFmtDisplay,
          resolutionDisplay,
          isHdrDisplay,
          colorTransferDisplay,
          colorSpaceDisplay,
          colorPrimariesDisplay,
          bitRateDisplay,
          audioCodecDisplay,
          audioChannelsDisplay,
          videoTranscoding: true,
          audioTranscoding: true,
          outputFormat: 'HLS fMP4',
          videoTag: 'avc1',
          videoArgs: ["-c:v", "libx264", "-preset", "fast", "-crf", "22"],
          audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
          hevcCopyResult: 'FAILED',
          sourceHttpStatus
        };
      }
    }

    // --- 1. EXISTING H264 PIPELINE (PRESERVED INTACT) ---
    // 1A. H264 + AAC / MP3 -> REMUX_COPY_COPY
    if (isH264Video && isAacOrMp3Audio) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'REMUX_COPY_COPY',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        pixFmtDisplay,
        resolutionDisplay,
        isHdrDisplay,
        colorTransferDisplay,
        colorSpaceDisplay,
        colorPrimariesDisplay,
        bitRateDisplay,
        audioCodecDisplay,
        audioChannelsDisplay,
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'HLS fMP4',
        videoTag: 'avc1',
        videoArgs: ["-c:v", "copy"],
        audioArgs: ["-c:a", "copy"],
        hevcCopyResult: 'NOT_APPLICABLE',
        sourceHttpStatus
      };
    }

    // 1B. H264 + Incompatible Audio (AC3 / EAC3 / DTS / TrueHD) -> VIDEO_COPY_AUDIO_AAC
    if (isH264Video) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'VIDEO_COPY_AUDIO_AAC',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        pixFmtDisplay,
        resolutionDisplay,
        isHdrDisplay,
        colorTransferDisplay,
        colorSpaceDisplay,
        colorPrimariesDisplay,
        bitRateDisplay,
        audioCodecDisplay,
        audioChannelsDisplay,
        videoTranscoding: false,
        audioTranscoding: true,
        outputFormat: 'HLS fMP4',
        videoTag: 'avc1',
        videoArgs: ["-c:v", "copy"],
        audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
        hevcCopyResult: 'NOT_APPLICABLE',
        sourceHttpStatus
      };
    }

    // --- 2. HEVC / H.265 / 4K PIPELINE (NO VIDEO TRANSCODING BY DEFAULT) ---
    // 2A. HEVC + AAC / MP3 -> HEVC_COPY_COPY (-c:v copy -tag:v hvc1 -c:a copy)
    if (isHevcVideo && isAacOrMp3Audio) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'HEVC_COPY_COPY',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        pixFmtDisplay,
        resolutionDisplay,
        isHdrDisplay,
        colorTransferDisplay,
        colorSpaceDisplay,
        colorPrimariesDisplay,
        bitRateDisplay,
        audioCodecDisplay,
        audioChannelsDisplay,
        videoTranscoding: false,
        audioTranscoding: false,
        outputFormat: 'HLS fMP4',
        videoTag: 'hvc1',
        videoArgs: ["-c:v", "copy", "-tag:v", "hvc1"],
        audioArgs: ["-c:a", "copy"],
        hevcCopyResult: 'SUCCESS',
        sourceHttpStatus
      };
    }

    // 2B. HEVC + Incompatible Audio (AC3 / EAC3 / DTS / TrueHD / FLAC) -> HEVC_COPY_AUDIO_AAC
    // (-c:v copy -tag:v hvc1 -c:a aac -b:a 192k -ac 2)
    if (isHevcVideo) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'HEVC_COPY_AUDIO_AAC',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        pixFmtDisplay,
        resolutionDisplay,
        isHdrDisplay,
        colorTransferDisplay,
        colorSpaceDisplay,
        colorPrimariesDisplay,
        bitRateDisplay,
        audioCodecDisplay,
        audioChannelsDisplay,
        videoTranscoding: false,
        audioTranscoding: true,
        outputFormat: 'HLS fMP4',
        videoTag: 'hvc1',
        videoArgs: ["-c:v", "copy", "-tag:v", "hvc1"],
        audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
        hevcCopyResult: 'SUCCESS',
        sourceHttpStatus
      };
    }

    // --- 3. OTHER VIDEO CODECS (MPEG2, MPEG4, VC1, VP9, AV1, WMV) ---
    if (is4K) {
      return {
        ffprobeStatus: 'SUCCESS',
        strategy: 'TRANSCODE_4K_TO_1080P_H264',
        containerDisplay,
        videoCodecDisplay,
        videoProfileDisplay,
        pixFmtDisplay,
        resolutionDisplay,
        isHdrDisplay,
        colorTransferDisplay,
        colorSpaceDisplay,
        colorPrimariesDisplay,
        bitRateDisplay,
        audioCodecDisplay,
        audioChannelsDisplay,
        videoTranscoding: true,
        audioTranscoding: true,
        outputFormat: 'HLS fMP4',
        videoTag: 'avc1',
        videoArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-vf", "scale=-2:1080"],
        audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
        hevcCopyResult: 'NOT_APPLICABLE',
        sourceHttpStatus
      };
    }

    return {
      ffprobeStatus: 'SUCCESS',
      strategy: 'TRANSCODE_H264_AAC',
      containerDisplay,
      videoCodecDisplay,
      videoProfileDisplay,
      pixFmtDisplay,
      resolutionDisplay,
      isHdrDisplay,
      colorTransferDisplay,
      colorSpaceDisplay,
      colorPrimariesDisplay,
      bitRateDisplay,
      audioCodecDisplay,
      audioChannelsDisplay,
      videoTranscoding: true,
      audioTranscoding: true,
      outputFormat: 'HLS fMP4',
      videoTag: 'avc1',
      videoArgs: ["-c:v", "libx264", "-preset", "fast", "-crf", "22"],
      audioArgs: ["-c:a", "aac", "-b:a", "192k", "-ac", "2"],
      hevcCopyResult: 'NOT_APPLICABLE',
      sourceHttpStatus
    };
  }

  /**
   * Start or retrieve an active VOD playback session
   */
  public async getOrCreateSession(
    sourceUrl: string,
    headers?: Record<string, string>,
    originalCmd?: string,
    options?: { forceFallback?: boolean }
  ): Promise<{ session: VodSession; isNew: boolean }> {
    const cleanUrl = sourceUrl.trim();

    // Check for an existing active session with the exact same source URL (unless fallback mode is forced)
    if (!options?.forceFallback) {
      for (const session of this.sessions.values()) {
        if (session.sourceUrl === cleanUrl) {
          session.lastAccessedAt = Date.now();
          console.log(`[VodSessionManager] Reusing active session ${session.sessionId} for stream.`);
          return { session, isNew: false };
        }
      }
    } else {
      // If forceFallback is requested, stop previous session for this url if any
      for (const [sId, session] of this.sessions.entries()) {
        if (session.sourceUrl === cleanUrl) {
          this.stopSession(sId);
        }
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

    // 2. BLOCK FFPROBE IF URL IS INVALID
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
        pixFmt: 'N/A',
        resolution: 'N/A',
        isHdr: 'NO',
        colorTransfer: 'N/A',
        colorSpace: 'N/A',
        colorPrimaries: 'N/A',
        bitRate: 'N/A',
        audioCodec: 'N/A',
        audioChannels: 'N/A',
        strategy: 'PROBE_FAILED',
        videoTranscoding: false,
        audioTranscoding: false,
        output: 'N/A',
        videoTag: 'none',
        segmentsReady: 0,
        ffmpegSpeed: "0.0x",
        timeToPlayable: "N/A",
        timeToFirstSegment: "N/A",
        player: "NONE",
        status: "ERROR",
        errorDetails: vodErrorMsg,
        probeError: vodErrorMsg,
        vodResolutionDiag: vodDiag,
        sourceHttpStatus: 400,
        hevcCopyResult: 'NOT_APPLICABLE'
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

    // 3. ONLY ONCE VOD URL IS VALID, RUN FFPROBE WITH 502/503 RETRY LOGIC
    const probeResult = await this.probeStream(cleanUrl, headers);
    const decision = this.determineStrategy(probeResult, options);

    const probedStreams = probeResult.streams || [];
    const probedFormat = probeResult.format || {};

    // Calculate real video duration in seconds
    let totalDuration = Number(probedFormat.duration) || 0;
    if (!totalDuration || isNaN(totalDuration)) {
      const vStream = probedStreams.find((s: any) => s.codec_type === 'video');
      if (vStream && vStream.duration) {
        totalDuration = Number(vStream.duration) || 0;
      }
    }

    // Extract all audio tracks
    const audioTracks: AudioTrackInfo[] = probedStreams
      .filter((s: any) => s.codec_type === 'audio')
      .map((s: any, idx: number) => {
        const lang = (s.tags?.language || s.tags?.LANGUAGE || '').trim();
        const title = (s.tags?.title || s.tags?.TITLE || '').trim();
        const codec = s.codec_name || 'unknown';
        const channels = s.channels || 2;
        let displayName = title;
        if (!displayName) {
          if (lang) {
            const langUpper = lang.toUpperCase();
            displayName = langUpper === 'FRE' || langUpper === 'FRA' ? 'Français' :
                          langUpper === 'ENG' ? 'Anglais' :
                          langUpper === 'SPA' ? 'Espagnol' :
                          langUpper === 'GER' || langUpper === 'DEU' ? 'Allemand' :
                          langUpper === 'ITA' ? 'Italien' :
                          langUpper === 'ARA' ? 'Arabe' :
                          langUpper === 'POR' ? 'Portugais' :
                          langUpper === 'RUS' ? 'Russe' :
                          langUpper === 'TUR' ? 'Turc' :
                          langUpper;
          } else {
            displayName = `Piste Audio ${idx + 1}`;
          }
        }
        return {
          id: idx,
          index: s.index ?? idx,
          codec,
          channels,
          language: lang || 'und',
          title: displayName
        };
      });

    // Extract all subtitle tracks
    const subtitleTracks: SubtitleTrackInfo[] = probedStreams
      .filter((s: any) => s.codec_type === 'subtitle')
      .map((s: any, idx: number) => {
        const lang = (s.tags?.language || s.tags?.LANGUAGE || '').trim();
        const title = (s.tags?.title || s.tags?.TITLE || '').trim();
        const codec = s.codec_name || 'unknown';
        let displayName = title;
        if (!displayName) {
          if (lang) {
            const langUpper = lang.toUpperCase();
            displayName = langUpper === 'FRE' || langUpper === 'FRA' ? 'Français' :
                          langUpper === 'ENG' ? 'Anglais' :
                          langUpper === 'SPA' ? 'Espagnol' :
                          langUpper === 'GER' || langUpper === 'DEU' ? 'Allemand' :
                          langUpper === 'ITA' ? 'Italien' :
                          langUpper === 'ARA' ? 'Arabe' :
                          langUpper;
          } else {
            displayName = `Sous-titre ${idx + 1}`;
          }
        }
        return {
          id: idx,
          index: s.index ?? idx,
          codec,
          language: lang || 'und',
          title: displayName
        };
      });

    const diagnostic: VodDiagnostic = {
      ffprobeStatus: decision.ffprobeStatus,
      container: decision.containerDisplay,
      videoCodec: decision.videoCodecDisplay,
      videoProfile: decision.videoProfileDisplay,
      pixFmt: decision.pixFmtDisplay,
      resolution: decision.resolutionDisplay,
      isHdr: decision.isHdrDisplay,
      colorTransfer: decision.colorTransferDisplay,
      colorSpace: decision.colorSpaceDisplay,
      colorPrimaries: decision.colorPrimariesDisplay,
      bitRate: decision.bitRateDisplay,
      audioCodec: decision.audioCodecDisplay,
      audioChannels: decision.audioChannelsDisplay,
      strategy: decision.strategy,
      videoTranscoding: decision.videoTranscoding,
      audioTranscoding: decision.audioTranscoding,
      output: decision.outputFormat,
      videoTag: decision.videoTag,
      segmentsReady: 0,
      ffmpegSpeed: "1.0x",
      timeToPlayable: "calculating...",
      timeToFirstSegment: "calculating...",
      player: "NATIVE_HLS / HLS_JS",
      status: decision.strategy === 'PROBE_FAILED' ? "ERROR" : "PREPARING",
      duration: totalDuration > 0 ? totalDuration : undefined,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
      errorDetails: decision.probeError,
      probeError: decision.probeError,
      vodResolutionDiag: vodDiag,
      sourceHttpStatus: decision.sourceHttpStatus,
      hevcCopyResult: decision.hevcCopyResult,
      ffmpegExitCode: null,
      ffmpegLastError: ""
    };

    // Formatted 4K / HEVC Diagnostic Output in terminal
    console.log(`
===== VOD 4K / HEVC =====

CONTAINER:
${diagnostic.container}

VIDEO CODEC:
${diagnostic.videoCodec}

PROFILE:
${diagnostic.videoProfile}

PIX FORMAT:
${diagnostic.pixFmt}

RESOLUTION:
${diagnostic.resolution}

HDR:
${diagnostic.isHdr}

COLOR TRANSFER:
${diagnostic.colorTransfer}

AUDIO CODEC:
${diagnostic.audioCodec}

STRATEGY:
${diagnostic.strategy}

VIDEO TRANSCODING:
${diagnostic.videoTranscoding ? 'YES' : 'NO'}

AUDIO TRANSCODING:
${diagnostic.audioTranscoding ? 'YES' : 'NO'}

OUTPUT:
${diagnostic.output}

VIDEO TAG:
${diagnostic.videoTag}

STATUS:
${diagnostic.status}
`);

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
      rawProbeJson: probeResult,
      videoArgs: decision.videoArgs,
      audioArgs: decision.audioArgs
    };

    this.sessions.set(sessionId, session);

    // If strategy is PROBE_FAILED, do NOT launch FFmpeg
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
      ...decision.videoArgs,
      ...decision.audioArgs,
      "-sn",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "0",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", path.join(sessionDir, "segment_%05d.m4s"),
      masterM3u8Path
    );

    console.log(`[VodSessionManager] Launching FFmpeg [${decision.strategy}] for session ${sessionId} (Video: ${decision.videoArgs.join(' ')}, Audio: ${decision.audioArgs.join(' ')})`);

    const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    session.ffmpegProcess = ffmpegProc;

    // Monitor stderr for speed stats and error tracking
    ffmpegProc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      const speedMatch = text.match(/speed=\s*([\d\.]+x)/);
      if (speedMatch) {
        session.diagnostic.ffmpegSpeed = speedMatch[1];
      }
      if (text.includes("Error") || text.includes("HTTP error") || text.includes("Invalid data")) {
        const sanitizedErr = sanitizeSensitiveData(text.trim().slice(0, 200));
        session.diagnostic.ffmpegLastError = sanitizedErr;
        console.warn(`[FFmpeg VOD Session ${sessionId} Warn]`, sanitizedErr);
      }
    });

    ffmpegProc.on("error", (err: Error) => {
      const sanitizedErr = sanitizeSensitiveData(err.message);
      console.error(`[FFmpeg VOD Session ${sessionId} Error]`, sanitizedErr);
      session.diagnostic.status = "ERROR";
      session.diagnostic.errorDetails = sanitizedErr;
      session.diagnostic.ffmpegLastError = sanitizedErr;
      if (session.diagnostic.strategy.startsWith('HEVC_COPY')) {
        session.diagnostic.hevcCopyResult = 'FAILED';
      }
    });

    ffmpegProc.on("exit", (code, signal) => {
      console.log(`[FFmpeg VOD Session ${sessionId} Exit] code=${code}, signal=${signal}`);
      session.diagnostic.ffmpegExitCode = code;
      if (session.diagnostic.status === "PREPARING") {
        session.diagnostic.status = "ERROR";
        session.diagnostic.errorDetails = `FFmpeg exited prematurely with code ${code}`;
        if (session.diagnostic.strategy.startsWith('HEVC_COPY')) {
          session.diagnostic.hevcCopyResult = 'FAILED';
        }
      }
    });

    // Poll for session readiness (master.m3u8 + init.mp4 + at least 1-2 segments)
    const startTime = Date.now();
    await this.waitForSessionReadiness(session, startTime);

    return { session, isNew: true };
  }

  /**
   * Poll directory until master.m3u8, init.mp4 and at least 1-2 segment files exist
   */
  private async waitForSessionReadiness(session: VodSession, startTime: number): Promise<void> {
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

          if (segments.length >= 1 && session.diagnostic.timeToFirstSegment === "calculating...") {
            session.diagnostic.timeToFirstSegment = `${(elapsed / 1000).toFixed(1)}s`;
          }

          // Ready condition: master.m3u8 + init.mp4 + at least 1 or 2 segments
          if ((hasMaster && hasInit && segments.length >= 2) || (hasMaster && hasInit && segments.length >= 1 && elapsed > 2500)) {
            clearInterval(interval);
            session.ready = true;
            session.diagnostic.status = "READY";
            session.diagnostic.timeToPlayable = `${(elapsed / 1000).toFixed(1)}s`;
            if (session.diagnostic.timeToFirstSegment === "calculating...") {
              session.diagnostic.timeToFirstSegment = `${(elapsed / 1000).toFixed(1)}s`;
            }
            if (session.diagnostic.strategy.startsWith('HEVC_COPY')) {
              session.diagnostic.hevcCopyResult = 'SUCCESS';
            }
            console.log(`[VodSessionManager] Session ${session.sessionId} READY in ${session.diagnostic.timeToPlayable} (${segments.length} segments ready)`);
            resolve();
            return;
          }

          if (elapsed >= maxWaitMs) {
            clearInterval(interval);
            if (hasMaster) {
              session.ready = true;
              session.diagnostic.status = "READY";
              session.diagnostic.timeToPlayable = `${(elapsed / 1000).toFixed(1)}s (timeout)`;
              if (session.diagnostic.strategy.startsWith('HEVC_COPY')) {
                session.diagnostic.hevcCopyResult = 'SUCCESS';
              }
            } else {
              session.diagnostic.status = "ERROR";
              session.diagnostic.errorDetails = "Timeout waiting for HLS segments";
              if (session.diagnostic.strategy.startsWith('HEVC_COPY')) {
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

