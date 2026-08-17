import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import cors from "cors";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import net from "net";
import {
  checkFFmpegEnv,
  startHlsSession,
  getSessionStatus,
  stopHlsSession,
} from "./server/stalkerHlsManager";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// --- API ROUTES ---

// Healthcheck
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- DIAGNOSTIC UTILITIES ---

function maskSensitiveUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const sensitiveKeys = ["mac", "token", "play_token", "password", "username", "key", "pass", "user"];
    sensitiveKeys.forEach(key => {
      if (url.searchParams.has(key)) {
        const val = url.searchParams.get(key) || "";
        if (val.length > 4) {
          url.searchParams.set(key, val.substring(0, 4) + "X".repeat(val.length - 4));
        } else {
          url.searchParams.set(key, "XXXX");
        }
      }
    });

    const pathParts = url.pathname.split("/");
    if (pathParts.length >= 5 && (pathParts[1] === "live" || pathParts[1] === "vod" || pathParts[1] === "series")) {
      const user = pathParts[2];
      const pass = pathParts[3];
      if (user) pathParts[2] = user.substring(0, Math.min(2, user.length)) + "X".repeat(Math.max(2, user.length - 2));
      if (pass) pathParts[3] = pass.substring(0, Math.min(2, pass.length)) + "X".repeat(Math.max(2, pass.length - 2));
      url.pathname = pathParts.join("/");
    }
    return url.toString();
  } catch (_) {
    let masked = urlStr;
    masked = masked.replace(/mac=[0-9a-fA-F:]+/gi, "mac=00:1A:79:XX:XX:XX");
    masked = masked.replace(/(token|play_token|password|pass|username|user)=([^&\s]+)/gi, "$1=XXXX");
    return masked;
  }
}

async function checkUpstreamStatus(urlStr: string): Promise<{ dnsResolved: boolean; tcpConnected: boolean; errorDetails?: any }> {
  let dnsResolved = false;
  let tcpConnected = false;
  let errorDetails: any = null;

  try {
    const url = new URL(urlStr);
    const host = url.hostname;
    const port = url.port ? parseInt(url.port) : (url.protocol === "https:" ? 443 : 80);

    // 1. DNS Resolution
    try {
      const addresses = await dns.promises.lookup(host);
      if (addresses && addresses.address) {
        dnsResolved = true;
      }
    } catch (dnsErr: any) {
      errorDetails = {
        name: dnsErr.name || "Error",
        message: dnsErr.message || "DNS Lookup failed",
        code: dnsErr.code || dnsErr.syscall || "ENOTFOUND",
        errno: dnsErr.errno,
        syscall: dnsErr.syscall || "getaddrinfo",
        hostname: host,
      };
      return { dnsResolved: false, tcpConnected: false, errorDetails };
    }

    // 2. TCP Connection check
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port, timeout: 2500 });
      socket.on("connect", () => {
        tcpConnected = true;
        socket.destroy();
        resolve();
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
      socket.on("error", (err) => {
        socket.destroy();
        reject(err);
      });
    }).catch((tcpErr: any) => {
      errorDetails = {
        name: tcpErr.name || "Error",
        message: tcpErr.message || "Connection failed",
        code: tcpErr.code || "ETIMEDOUT",
        errno: tcpErr.errno,
        syscall: tcpErr.syscall || "connect",
        hostname: host,
        port: port,
        address: tcpErr.address,
      };
    });

    return { dnsResolved, tcpConnected, errorDetails };
  } catch (err: any) {
    return {
      dnsResolved: false,
      tcpConnected: false,
      errorDetails: {
        name: "Error",
        message: err.message,
        code: "INVALID_URL"
      }
    };
  }
}

async function logStreamProxyDebug(
  reqUrl: string, 
  method: string, 
  targetUrl: string, 
  headersSent: Record<string, string>, 
  connectionCheck: { dnsResolved: boolean; tcpConnected: boolean; errorDetails?: any },
  upstreamStatus: number | null,
  contentType: string | null,
  redirectLocation: string | null,
  nodeError: any = null
) {
  let protocol = "unknown";
  let hostname = "unknown";
  let port = "unknown";
  let pathname = "unknown";
  let hasQueryString = "Non";

  try {
    const url = new URL(targetUrl);
    protocol = url.protocol;
    hostname = url.hostname;
    port = url.port || (url.protocol === "https:" ? "443" : "80");
    pathname = url.pathname;
    hasQueryString = url.search ? "Oui" : "Non";
  } catch (_) {}

  console.log(`\n===== STREAM PROXY DEBUG =====`);
  console.log(`ORIGINAL REQUEST`);
  console.log(`- URL proxy reçue : ${maskSensitiveUrl(reqUrl)}`);
  console.log(`- méthode         : ${method}`);
  console.log(``);
  console.log(`TARGET`);
  console.log(`- URL cible reconstruite : ${maskSensitiveUrl(targetUrl)}`);
  console.log(`- protocole              : ${protocol}`);
  console.log(`- hostname               : ${hostname}`);
  console.log(`- port                   : ${port}`);
  console.log(`- pathname               : ${pathname}`);
  console.log(`- query string présente  : ${hasQueryString}`);
  console.log(``);
  console.log(`HEADERS ENVOYÉS AU SERVEUR IPTV`);
  console.log(`- User-Agent            : ${headersSent["User-Agent"] || "N/A"}`);
  console.log(`- Referer présent       : ${headersSent["Referer"] ? "Oui" : "Non"}`);
  console.log(`- Cookie présent        : ${headersSent["Cookie"] ? "Oui" : "Non"}`);
  console.log(`- Authorization présent : ${headersSent["Authorization"] ? "Oui" : "Non"}`);
  console.log(`- Range présent         : ${headersSent["Range"] ? "Oui" : "Non"}`);
  console.log(``);
  console.log(`UPSTREAM CONNECTION`);
  console.log(`- DNS resolved : ${connectionCheck.dnsResolved ? "Oui" : "Non"}`);
  console.log(`- connexion TCP réussie : ${connectionCheck.tcpConnected ? "Oui" : "Non"}`);
  console.log(`- HTTP status upstream : ${upstreamStatus !== null ? upstreamStatus : "N/A"}`);
  console.log(`- Content-Type upstream : ${contentType || "N/A"}`);
  console.log(`- Location en cas de redirection : ${redirectLocation || "N/A"}`);

  if (nodeError || connectionCheck.errorDetails) {
    const err = nodeError || connectionCheck.errorDetails;
    console.log(``);
    console.log(`NODE ERROR`);
    console.log(`- error.name     : ${err.name || "N/A"}`);
    console.log(`- error.message  : ${err.message || "N/A"}`);
    console.log(`- error.code     : ${err.code || "N/A"}`);
    console.log(`- error.errno    : ${err.errno !== undefined ? err.errno : "N/A"}`);
    console.log(`- error.syscall  : ${err.syscall || "N/A"}`);
    console.log(`- error.hostname : ${err.hostname || hostname || "N/A"}`);
    console.log(`- error.address  : ${err.address || "N/A"}`);
    console.log(`- error.port     : ${err.port || port || "N/A"}`);
  }
  console.log(`==============================\n`);
}

// Proxy stream to bypass CORS for HLS/M3U8/TS streams
app.get("/api/proxy/stream", async (req: Request, res: Response) => {
  let streamUrl = (req.query.url as string) || "";
  let stalkerMac = (req.query.mac as string) || "";
  let stalkerToken = (req.query.token as string) || (req.query.play_token as string) || "";

  // If streamUrl was not extracted or was double encoded, parse the raw request URL
  if (!streamUrl && req.url.includes("url=")) {
    const urlMatch = req.url.match(/[?&]url=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
      try {
        streamUrl = decodeURIComponent(urlMatch[1]);
      } catch (_) {
        streamUrl = urlMatch[1];
      }
    }
  }

  // If upstream parameters were parsed as separate query params by Express (e.g. stream=24527&extension=ts&play_token=...)
  const queryKeys = Object.keys(req.query);
  const extraParams: string[] = [];
  for (const key of queryKeys) {
    if (key !== "url" && key !== "mac" && key !== "token" && key !== "play_token") {
      const val = req.query[key];
      if (typeof val === "string") {
        extraParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
      }
    }
  }
  if (extraParams.length > 0 && streamUrl) {
    const sep = streamUrl.includes("?") ? "&" : "?";
    streamUrl = `${streamUrl}${sep}${extraParams.join("&")}`;
  }

  if (stalkerMac && !streamUrl.includes("mac=")) {
    const sep = streamUrl.includes("?") ? "&" : "?";
    streamUrl = `${streamUrl}${sep}mac=${encodeURIComponent(stalkerMac)}`;
  }
  if (stalkerToken && !streamUrl.includes("play_token=") && !streamUrl.includes("token=")) {
    const sep = streamUrl.includes("?") ? "&" : "?";
    streamUrl = `${streamUrl}${sep}play_token=${encodeURIComponent(stalkerToken)}`;
  }

  if (!streamUrl) {
    res.status(400).send("Missing stream URL parameter");
    return;
  }

  // Automatic rewrite only for known deprecated public domains
  if (streamUrl.includes("stream.france24.com") || streamUrl.includes("2037568/F24_FR_LO_HLS")) {
    streamUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
  } else if (streamUrl.includes("amg00071-clubbingtv") || streamUrl.includes("clubbingtv-samsungfr")) {
    streamUrl = "https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8";
  } else if (streamUrl.includes("artesimulcast.akamaized.net")) {
    streamUrl = "https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8";
  } else if (streamUrl.includes("euronews-french-1-fr.samsung.wurl.tv")) {
    streamUrl = "https://cdn-euronews.akamaized.net/live/eds/africanews-fr/25050/index.m3u8";
  } else if (streamUrl.includes("extremesports-samsunguk") || streamUrl.includes("amg01201")) {
    streamUrl = "https://africa24.vedge.infomaniak.com/livecast/ik:africa24sport/manifest.m3u8";
  }

  try {
    try {
      const parsedUrl = new URL(streamUrl);
      if (!stalkerMac) stalkerMac = parsedUrl.searchParams.get("mac") || "";
      if (!stalkerToken) stalkerToken = parsedUrl.searchParams.get("play_token") || parsedUrl.searchParams.get("token") || "";
    } catch (_) {}

    const userAgents = [
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "IPTVSmarters/1.0",
      "VLC/3.0.18 LibVLC/3.0.18",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ];

    let response: any = null;
    let lastError: any = null;

    for (const ua of userAgents) {
      try {
        const parsedUrl = new URL(streamUrl);
        const headers: Record<string, string> = {
          "User-Agent": ua,
          "Referer": `${parsedUrl.protocol}//${parsedUrl.host}/`,
          "Accept": "*/*",
        };

        if (stalkerMac) {
          headers["Cookie"] = `mac=${stalkerMac}; stb_lang=en; timezone=Europe%2FParis`;
          headers["X-User-Agent"] = "Model: MAG250; Link: WiFi";
        }
        if (stalkerToken) {
          headers["Authorization"] = `Bearer ${stalkerToken}`;
        }

        if (req.headers.range) {
          headers["Range"] = req.headers.range;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const resAttempt = await fetch(streamUrl, {
          headers,
          redirect: "follow",
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeoutId);
        });

        if (resAttempt.ok || resAttempt.status === 206) {
          response = resAttempt;
          break;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    // Generate detailed logging on success or failure
    let headersSentLog: Record<string, string> = {};
    try {
      const parsedUrl = new URL(streamUrl);
      headersSentLog = {
        "User-Agent": "Varies by loop index",
        "Referer": `${parsedUrl.protocol}//${parsedUrl.host}/`,
        "Cookie": stalkerMac ? "Cookie: mac=..." : "",
        "Authorization": stalkerToken ? "Authorization: Bearer ..." : "",
        "Range": req.headers.range ? String(req.headers.range) : ""
      };
    } catch (_) {}

    if (response) {
      const connCheck = { dnsResolved: true, tcpConnected: true, errorDetails: null };
      const redirectLocation = response.headers.get("location") || null;
      const status = response.status;
      const contentType = response.headers.get("content-type") || null;

      await logStreamProxyDebug(
        req.url,
        req.method,
        streamUrl,
        headersSentLog,
        connCheck,
        status,
        contentType,
        redirectLocation,
        null
      );
    } else {
      const connCheck = await checkUpstreamStatus(streamUrl);
      await logStreamProxyDebug(
        req.url,
        req.method,
        streamUrl,
        headersSentLog,
        connCheck,
        null,
        null,
        null,
        lastError
      );
    }

    if (!response) {
      console.warn(`[Proxy Notice] Failed to fetch stream from provider: ${maskSensitiveUrl(streamUrl)}`);
      res.status(502).send(`Impossible de se connecter au flux vidéo du serveur IPTV. ${lastError?.message || ""}`);
      return;
    }

    if (!response.ok && response.status !== 206) {
      res.status(response.status).send(`Stream fetch error: ${response.statusText}`);
      return;
    }

    // Forward headers
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const acceptRanges = response.headers.get("accept-ranges");
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

    const contentRange = response.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    res.setHeader("Access-Control-Allow-Origin", "*");

    const finalUrl = response.url || streamUrl;

    // Check if it's an m3u8 playlist to rewrite relative segment URLs
    if (contentType && (contentType.includes("mpegurl") || contentType.includes("application/x-mpegURL") || finalUrl.endsWith(".m3u8") || finalUrl.includes(".m3u8?"))) {
      const text = await response.text();
      const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf("/") + 1);
      
      const rewritten = text.split("\n").map(line => {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return `/api/proxy/stream?url=${encodeURIComponent(trimmed)}`;
          } else {
            const absoluteUrl = new URL(trimmed, baseUrl).toString();
            return `/api/proxy/stream?url=${encodeURIComponent(absoluteUrl)}`;
          }
        }
        return line;
      }).join("\n");

      res.send(rewritten);
      return;
    }

    // Pipe binary stream directly to client to handle live continuous streams & TS chunks
    if (response.body) {
      // @ts-ignore
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);

      req.on("close", () => {
        try {
          nodeStream.destroy();
        } catch (_) {}
      });
    } else {
      res.end();
    }
  } catch (err: any) {
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Stream request timed out' : err.message;
    console.warn(`[Proxy Notice] Stream unreachable (${streamUrl}): ${errorMsg}`);
    res.status(502).send(`Stream Proxy Unavailable: ${errorMsg}`);
  }
});

// Proxy image / poster to fix Mixed Content (HTTP images on HTTPS site) & CORS issues
app.get("/api/proxy/image", async (req: Request, res: Response) => {
  let imageUrl = (req.query.url as string) || "";
  if (!imageUrl && req.url.includes("url=")) {
    const urlMatch = req.url.match(/[?&]url=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
      try {
        imageUrl = decodeURIComponent(urlMatch[1]);
      } catch (_) {
        imageUrl = urlMatch[1];
      }
    }
  }

  if (!imageUrl) {
    res.status(400).send("Missing image url parameter");
    return;
  }

  try {
    const parsed = new URL(imageUrl);
    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3"
    ];

    let response: any = null;

    for (const ua of userAgents) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        response = await fetch(imageUrl, {
          method: "GET",
          headers: {
            "User-Agent": ua,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": `${parsed.protocol}//${parsed.host}/`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);
        if (response.ok) break;
      } catch (e) {}
    }

    if (!response || !response.ok) {
      res.status(404).send("Image unavailable");
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      res.status(404).send("Invalid image content type");
      return;
    }

    res.setHeader("Content-Type", contentType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (response.body) {
      // @ts-ignore
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);
      req.on("close", () => {
        try { nodeStream.destroy(); } catch (_) {}
      });
    } else {
      res.end();
    }
  } catch (err: any) {
    res.status(404).send("Image fetch error");
  }
});

// Stalker Portal Proxy API (MAG Handshake & Data)
app.post("/api/stalker/proxy", async (req: Request, res: Response) => {
  const { portalUrl, mac, action, type = "itv", token, params = {} } = req.body;

  if (!portalUrl || !mac) {
    res.status(400).json({ error: "portalUrl and mac are required" });
    return;
  }

  // Handle sample / demonstration Stalker portal without network lookup failures
  if (portalUrl.includes("iptvserver.net") || portalUrl.includes("example") || portalUrl.includes("demo-stalker")) {
    const act = action || "handshake";
    if (act === "handshake") {
      res.json({
        js: {
          token: "demo_mag_token_8899aabb",
          status: 1,
          id: 101,
          mac: mac,
          phone: "MAG250-PRO",
          timezone: "Europe/Paris",
          msg: "Authentification Démo Stalker active",
        },
      });
      return;
    }
    if (act === "get_profile") {
      res.json({
        js: {
          status: "connected",
          max_connections: 1,
          exp_date: "31/12/2026",
          active: 1,
        },
      });
      return;
    }
    if (act === "create_link") {
      const reqCmd = (params && params.cmd) || "";
      let targetUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
      if (reqCmd.includes("2") || reqCmd.includes("arte")) {
        targetUrl = "https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8";
      } else if (reqCmd.includes("3") || reqCmd.includes("clubbing")) {
        targetUrl = "https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8";
      } else if (reqCmd.includes("4") || reqCmd.includes("redbull")) {
        targetUrl = "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8";
      } else if (reqCmd.includes("5") || reqCmd.includes("adn")) {
        targetUrl = "https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8";
      } else if (reqCmd.includes("6") || reqCmd.includes("nasa")) {
        targetUrl = "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8";
      }
      res.json({
        js: {
          cmd: `ffmpeg ${targetUrl}`,
          id: 1,
        },
      });
      return;
    }
    if (act === "get_all_channels" || (type === "itv" && act === "get_all_records")) {
      res.json({
        js: {
          total_items: 6,
          max_page_items: 50,
          data: [
            {
              id: "1",
              number: 1,
              name: "France 24 HD (FR)",
              cmd: "ffmpeg https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8",
              logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/France_24_logo.svg/300px-France_24_logo.svg.png",
              tv_genre_name: "Information",
              hd: "1",
              enable_tv_archive: 1,
              tv_archive_duration: 168,
            },
            {
              id: "2",
              number: 2,
              name: "ARTE HD",
              cmd: "ffmpeg https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8",
              logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Arte_logo_2017.svg/320px-Arte_logo_2017.svg.png",
              tv_genre_name: "Généraliste",
              hd: "1",
              enable_tv_archive: 1,
              tv_archive_duration: 168,
            },
            {
              id: "3",
              number: 3,
              name: "Clubbing TV Electronic HD",
              cmd: "ffmpeg https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8",
              logo: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&auto=format&fit=crop&q=80",
              tv_genre_name: "Musique",
              hd: "1",
            },
            {
              id: "4",
              number: 4,
              name: "Red Bull TV HD",
              cmd: "ffmpeg https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
              logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Red_Bull_TV_logo.svg/320px-Red_Bull_TV_logo.svg.png",
              tv_genre_name: "Sport",
              hd: "1",
            },
            {
              id: "5",
              number: 5,
              name: "ADN Anime & Séries HD",
              cmd: "ffmpeg https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8",
              logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Rakuten_TV_logo.svg/320px-Rakuten_TV_logo.svg.png",
              tv_genre_name: "Cinéma & Séries",
              hd: "1",
            },
            {
              id: "6",
              number: 6,
              name: "NASA TV HD (Public)",
              cmd: "ffmpeg https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
              logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/300px-NASA_logo.svg.png",
              tv_genre_name: "Documentaires",
              hd: "1",
            },
          ],
        },
      });
      return;
    }
    if (act === "get_categories" || act === "get_genres") {
      if (type === "vod") {
        res.json({
          js: [
            { id: "1", title: "Action & Aventure", alias: "action" },
            { id: "2", title: "Science-Fiction", alias: "scifi" },
            { id: "3", title: "Comédie", alias: "comedy" },
            { id: "4", title: "Drame & Thriller", alias: "drama" },
            { id: "5", title: "Animation & Famille", alias: "animation" },
            { id: "6", title: "Documentaires", alias: "docs" },
          ],
        });
        return;
      }
      if (type === "series") {
        res.json({
          js: [
            { id: "10", title: "Séries Sci-Fi & Cyberpunk", alias: "series-scifi" },
            { id: "11", title: "Séries Thriller & Policier", alias: "series-thriller" },
            { id: "12", title: "Séries Drame & Aventure", alias: "series-drama" },
            { id: "13", title: "Séries Documentaires & Nature", alias: "series-doc" },
          ],
        });
        return;
      }
    }
    if (type === "vod" || act === "get_all_records") {
      const page = parseInt((params && params.p) || "1", 10);
      const allVodItems = [
        // Page 1
        {
          id: "vod-1",
          name: "Cosmos : L'Odyssée Interstellaire (4K)",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80",
          category_id: "2",
          category_name: "Science-Fiction",
          year: "2024",
          rating: "9.2",
          description: "Une exploration spectaculaire des mystères de l'univers et de la matière noire.",
          time: "1h 42m",
          director: "Ann Druyan",
          actors: "Neil deGrasse Tyson",
        },
        {
          id: "vod-2",
          name: "Tears of Steel (Sci-Fi VFX)",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80",
          category_id: "1",
          category_name: "Action & Sci-Fi",
          year: "2023",
          rating: "8.5",
          description: "Dans un futur dystopique à Amsterdam, un groupe de scientifiques tente de reprogrammer le passé.",
          time: "2h 05m",
          director: "Ian Hubert",
          actors: "Derek de Lint, Sergio Hasselbaink",
        },
        {
          id: "vod-3",
          name: "Sintel : La Quête du Dragon",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80",
          category_id: "5",
          category_name: "Fantastique",
          year: "2022",
          rating: "8.9",
          description: "Une jeune guerrière solitaire brave les montagnes pour retrouver son bébé dragon.",
          time: "1h 35m",
          director: "Colin Levy",
          actors: "Halina Reijn, Thom Hoffman",
        },
        {
          id: "vod-4",
          name: "Big Buck Bunny Remastered",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1535930749574-1399327ce78f?w=400&auto=format&fit=crop&q=80",
          category_id: "5",
          category_name: "Animation",
          year: "2023",
          rating: "8.1",
          description: "Un gigantesque lapin pacifique tend des pièges ingénieux aux petits rongeurs turbulents.",
          time: "1h 15m",
          director: "Sacha Goedegebure",
          actors: "Jan Morgenstern",
        },
        {
          id: "vod-5",
          name: "Inception (Ultra HD)",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80",
          category_id: "4",
          category_name: "Drame & Thriller",
          year: "2024",
          rating: "8.8",
          description: "Un voleur s'infiltre dans les rêves des gens pour dérober des secrets industriels.",
          time: "2h 28m",
          director: "Christopher Nolan",
          actors: "Leonardo DiCaprio, Joseph Gordon-Levitt",
        },
        // Page 2
        {
          id: "vod-6",
          name: "Interstellar : Aux Confins de l'Espace",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80",
          category_id: "2",
          category_name: "Science-Fiction",
          year: "2024",
          rating: "9.1",
          description: "Une équipe d'explorateurs voyage à travers un trou de ver pour assurer la survie de l'humanité.",
          time: "2h 49m",
          director: "Christopher Nolan",
          actors: "Matthew McConaughey, Anne Hathaway",
        },
        {
          id: "vod-7",
          name: "Blade Runner 2049 (4K HDR)",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80",
          category_id: "2",
          category_name: "Science-Fiction",
          year: "2023",
          rating: "8.7",
          description: "Un nouveau blade runner découvre un secret enfoui depuis longtemps pouvant plonger la société dans le chaos.",
          time: "2h 44m",
          director: "Denis Villeneuve",
          actors: "Ryan Gosling, Harrison Ford",
        },
        {
          id: "vod-8",
          name: "Dune : Deuxième Partie (IMAX)",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&auto=format&fit=crop&q=80",
          category_id: "1",
          category_name: "Action & Aventure",
          year: "2024",
          rating: "9.3",
          description: "Paul Atréides s'unit à Chani et aux Fremen pour mener la révolte contre ceux qui ont détruit sa famille.",
          time: "2h 46m",
          director: "Denis Villeneuve",
          actors: "Timothée Chalamet, Zendaya",
        },
        {
          id: "vod-9",
          name: "Oppenheimer : L'Ère Atomique",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&auto=format&fit=crop&q=80",
          category_id: "4",
          category_name: "Drame & Thriller",
          year: "2023",
          rating: "9.0",
          description: "L'histoire captivante du physicien J. Robert Oppenheimer et du projet Manhattan.",
          time: "3h 00m",
          director: "Christopher Nolan",
          actors: "Cillian Murphy, Emily Blunt",
        },
        {
          id: "vod-10",
          name: "Planète Terre : Secrets de la Faune",
          cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          screenshot_uri: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&auto=format&fit=crop&q=80",
          category_id: "6",
          category_name: "Documentaires",
          year: "2024",
          rating: "9.5",
          description: "Un voyage immersif au cœur des écosystèmes les plus reculés de notre planète.",
          time: "1h 50m",
          director: "Alastair Fothergill",
          actors: "David Attenborough",
        },
      ];

      const pageSize = 5;
      const totalItems = allVodItems.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const startIndex = (page - 1) * pageSize;
      const pageData = allVodItems.slice(startIndex, startIndex + pageSize);

      res.json({
        js: {
          total_items: totalItems,
          max_page_items: pageSize,
          cur_page: page,
          selected_item: 0,
          data: pageData,
        },
      });
      return;
    }
    if (type === "series") {
      // Check if querying seasons / episodes for a specific series
      const movieId = params && (params.movie_id || params.series_id);
      const seasonId = params && params.season_id;

      if (movieId) {
        // Episodes for a season
        if (seasonId !== undefined && seasonId !== "0" && seasonId !== "") {
          const sNum = parseInt(String(seasonId), 10);
          res.json({
            js: {
              total_items: 4,
              max_page_items: 50,
              data: [
                {
                  id: `ep-${movieId}-s${sNum}-1`,
                  series_id: movieId,
                  season_number: sNum,
                  episode_number: 1,
                  name: `Épisode 1 : Le Réveil du Protocole`,
                  cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                  time: "48m",
                  description: "Une brèche de sécurité inexpliquée déclenche une traque à grande échelle.",
                  screenshot_uri: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80",
                },
                {
                  id: `ep-${movieId}-s${sNum}-2`,
                  series_id: movieId,
                  season_number: sNum,
                  episode_number: 2,
                  name: `Épisode 2 : Les Données Fantômes`,
                  cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                  time: "52m",
                  description: "Les premiers indices révèlent des manipulations de mémoire artificielle.",
                  screenshot_uri: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80",
                },
                {
                  id: `ep-${movieId}-s${sNum}-3`,
                  series_id: movieId,
                  season_number: sNum,
                  episode_number: 3,
                  name: `Épisode 3 : Zone de Silence`,
                  cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                  time: "50m",
                  description: "L'équipe s'aventure dans le secteur déconnecté du réseau central.",
                  screenshot_uri: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80",
                },
                {
                  id: `ep-${movieId}-s${sNum}-4`,
                  series_id: movieId,
                  season_number: sNum,
                  episode_number: 4,
                  name: `Épisode 4 : Convergence Finale`,
                  cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                  time: "55m",
                  description: "Toutes les lignes temporelles convergent vers un choix irréversible.",
                  screenshot_uri: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80",
                },
              ],
            },
          });
          return;
        }

        // Seasons list for this series
        res.json({
          js: {
            total_items: 2,
            data: [
              {
                id: `season-1`,
                series_id: movieId,
                season_number: 1,
                name: "Saison 1 : Genèse",
              },
              {
                id: `season-2`,
                series_id: movieId,
                season_number: 2,
                name: "Saison 2 : Soulèvement",
              },
            ],
          },
        });
        return;
      }

      // Series catalog pagination
      const page = parseInt((params && params.p) || "1", 10);
      const allSeriesItems = [
        // Page 1
        {
          id: "series-1",
          name: "Cyber Grid : Neo Paris 2088",
          screenshot_uri: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80",
          category_id: "10",
          category_name: "Séries Sci-Fi & Cyberpunk",
          year: "2024",
          rating: "9.0",
          description: "Dans une mégapole saturée de données, une enquêtrice cyborg traque une IA clandestine.",
          total_seasons: 2,
        },
        {
          id: "series-2",
          name: "Abysses : L'Expédition Stellaire",
          screenshot_uri: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80",
          category_id: "12",
          category_name: "Séries Drame & Aventure",
          year: "2023",
          rating: "8.7",
          description: "Un équipage sous-marin découvre une cité engloutie aux technologies inconnues.",
          total_seasons: 2,
        },
        {
          id: "series-3",
          name: "Shadow Protocol : Opération Berlin",
          screenshot_uri: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80",
          category_id: "11",
          category_name: "Séries Thriller & Policier",
          year: "2024",
          rating: "8.9",
          description: "Un réseau d'agents doubles s'affronte dans les souterrains de l'Europe de l'Est.",
          total_seasons: 3,
        },
        // Page 2
        {
          id: "series-4",
          name: "Chroniques Galactiques : Horizon",
          screenshot_uri: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&auto=format&fit=crop&q=80",
          category_id: "10",
          category_name: "Séries Sci-Fi & Cyberpunk",
          year: "2024",
          rating: "9.2",
          description: "La première colonie humaine sur Mars fait face à un signal extraterrestre millénaire.",
          total_seasons: 1,
        },
        {
          id: "series-5",
          name: "Wild Earth : Terres Sauvages",
          screenshot_uri: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&auto=format&fit=crop&q=80",
          category_id: "13",
          category_name: "Séries Documentaires & Nature",
          year: "2023",
          rating: "9.4",
          description: "Une immersion inédite au cœur des prédateurs les plus fascinants de la planète.",
          total_seasons: 2,
        },
      ];

      const pageSize = 3;
      const totalItems = allSeriesItems.length;
      const startIndex = (page - 1) * pageSize;
      const pageData = allSeriesItems.slice(startIndex, startIndex + pageSize);

      res.json({
        js: {
          total_items: totalItems,
          max_page_items: pageSize,
          cur_page: page,
          selected_item: 0,
          data: pageData,
        },
      });
      return;
    }
  }

  try {
    let cleanUrl = portalUrl.trim();
    if (!cleanUrl.endsWith("/")) cleanUrl += "/";
    if (!cleanUrl.includes("load.php")) {
      cleanUrl += "server/load.php";
    }

    const queryParams = new URLSearchParams({
      type,
      action: action || "handshake",
      ...params,
    });

    const fullUrl = `${cleanUrl}?${queryParams.toString()}`;
    const cookieHeader = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Paris`;

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "Cookie": cookieHeader,
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      "Referer": portalUrl,
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(fullUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    const data = await response.text();
    try {
      const json = JSON.parse(data);
      res.json(json);
    } catch {
      res.json({ raw: data });
    }
  } catch (err: any) {
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Délai d\'attente dépassé (Timeout)' : (err.message || 'Serveur inaccessible');
    console.warn(`[Stalker Notice] Portal unreachable (${portalUrl}): ${errorMsg}`);
    res.status(502).json({ 
      error: `Portail Stalker inaccessible: ${errorMsg}`,
      code: "PORTAL_UNREACHABLE",
    });
  }
});

// Xtream Codes API Proxy
app.get("/api/xtream/proxy", async (req: Request, res: Response) => {
  const { serverUrl, username, password, action } = req.query;

  if (!serverUrl || !username || !password) {
    res.status(400).json({ error: "serverUrl, username, and password are required" });
    return;
  }

  // Handle sample / demonstration Xtream server
  if ((serverUrl as string).includes("vipservice.tv") || (serverUrl as string).includes("demo") || (serverUrl as string).includes("example")) {
    if (!action) {
      res.json({
        user_info: {
          auth: 1,
          username: username as string,
          password: password as string,
          status: "Active",
          exp_date: "1813104000",
          is_trial: "0",
          active_cons: "1",
          created_at: "1672531199",
          max_connections: "2",
          allowed_output_formats: ["m3u8", "ts", "rtmp"],
        },
        server_info: {
          url: "xtream.vipservice.tv",
          port: "8000",
          https_port: "8443",
          server_protocol: "http",
          timezone: "Europe/Paris",
        },
      });
      return;
    }
    if (action === "get_live_streams") {
      res.json([
        {
          num: 1,
          name: "France 24 HD (FR)",
          stream_type: "live",
          stream_id: 101,
          stream_icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/France_24_logo.svg/300px-France_24_logo.svg.png",
          epg_channel_id: "fr24.fr",
          category_name: "Information",
          tv_archive: 1,
          tv_archive_duration: 7,
        },
        {
          num: 2,
          name: "ARTE HD",
          stream_type: "live",
          stream_id: 102,
          stream_icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Arte_logo_2017.svg/320px-Arte_logo_2017.svg.png",
          epg_channel_id: "arte.fr",
          category_name: "Généraliste",
          tv_archive: 1,
          tv_archive_duration: 7,
        },
        {
          num: 3,
          name: "Clubbing TV Electronic HD",
          stream_type: "live",
          stream_id: 103,
          stream_icon: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&auto=format&fit=crop&q=80",
          category_name: "Musique",
        },
      ]);
      return;
    }
    if (action === "get_vod_streams") {
      res.json([
        {
          num: 1,
          name: "Inception (4K UHD)",
          stream_type: "movie",
          stream_id: 501,
          stream_icon: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80",
          rating: "8.8",
          year: "2010",
          container_extension: "mp4",
          category_name: "Thriller",
          plot: "Un voleur s'infiltre dans les rêves des gens pour dérober des secrets industriels.",
        },
        {
          num: 2,
          name: "Cosmos : L'Odyssée Interstellaire (4K)",
          stream_type: "movie",
          stream_id: 502,
          stream_icon: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80",
          rating: "9.2",
          year: "2024",
          container_extension: "mp4",
          category_name: "Science-Fiction",
          plot: "Une exploration spectaculaire des mystères de l'univers.",
        },
        {
          num: 3,
          name: "Tears of Steel (Sci-Fi VFX)",
          stream_type: "movie",
          stream_id: 503,
          stream_icon: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80",
          rating: "8.5",
          year: "2023",
          container_extension: "mp4",
          category_name: "Action",
          plot: "Dans un futur dystopique à Amsterdam, des guerriers affrontent des robots.",
        },
        {
          num: 4,
          name: "Sintel : La Quête du Dragon",
          stream_type: "movie",
          stream_id: 504,
          stream_icon: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80",
          rating: "8.9",
          year: "2022",
          container_extension: "mp4",
          category_name: "Fantastique",
          plot: "Une guerrière solitaire cherche son bébé dragon.",
        },
        {
          num: 5,
          name: "Big Buck Bunny Remastered",
          stream_type: "movie",
          stream_id: 505,
          stream_icon: "https://images.unsplash.com/photo-1535930749574-1399327ce78f?w=400&auto=format&fit=crop&q=80",
          rating: "8.1",
          year: "2023",
          container_extension: "mp4",
          category_name: "Animation",
          plot: "Un grand lapin pacifique punit de petits rongeurs turbulents.",
        },
      ]);
      return;
    }
    if (action === "get_series") {
      res.json([
        {
          series_id: 701,
          name: "Cyber Grid : Neo Paris 2088",
          cover: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80",
          category_name: "Science-Fiction",
          rating: "9.0",
          releaseDate: "2024",
          plot: "Une enquêtrice cyborg traque une IA clandestine.",
          seasons_count: "2",
        },
        {
          series_id: 702,
          name: "Abysses : L'Expédition Stellaire",
          cover: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80",
          category_name: "Aventure",
          rating: "8.7",
          releaseDate: "2023",
          plot: "Un sous-marin de recherche découvre une cité engloutie.",
          seasons_count: "1",
        },
      ]);
      return;
    }
  }

  try {
    let cleanUrl = (serverUrl as string).trim();
    if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1);

    let apiUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username as string)}&password=${encodeURIComponent(password as string)}`;
    if (action) {
      apiUrl += `&action=${encodeURIComponent(action as string)}`;
    }

    // Forward additional params
    for (const [key, val] of Object.entries(req.query)) {
      if (!["serverUrl", "username", "password", "action"].includes(key)) {
        apiUrl += `&${encodeURIComponent(key)}=${encodeURIComponent(val as string)}`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "IPTVSmarters/1.0",
      },
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Délai d\'attente dépassé (Timeout)' : (err.message || 'Serveur inaccessible');
    console.warn(`[Xtream Notice] Server unreachable (${serverUrl}): ${errorMsg}`);
    res.status(502).json({ 
      user_info: { auth: 0 },
      error: `Serveur Xtream inaccessible: ${errorMsg}`,
    });
  }
});

// M3U Playlist Fetcher Proxy
app.get("/api/m3u/fetch", async (req: Request, res: Response) => {
  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url as string, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Failed to fetch playlist: ${response.statusText}` });
      return;
    }

    const content = await response.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content);
  } catch (err: any) {
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Délai d\'attente dépassé' : (err.message || 'Fichier M3U inaccessible');
    console.warn(`[M3U Notice] Playlist unreachable (${url}): ${errorMsg}`);
    res.status(502).json({ error: `Playlist M3U inaccessible: ${errorMsg}` });
  }
});

// Stream Diagnostic Pre-flight Test API
app.get("/api/proxy/test", async (req: Request, res: Response) => {
  let streamUrl = req.query.url as string;
  if (!streamUrl) {
    res.status(400).json({
      success: false,
      proxyStatus: 400,
      upstreamStatus: null,
      source: "LOCAL_PROXY",
      errorCode: "MISSING_URL",
      errorMessage: "Missing stream URL parameter"
    });
    return;
  }

  // Reconstruct full stream URL to preserve any original query params
  const urlParamIndex = req.url.indexOf("url=");
  if (urlParamIndex !== -1) {
    const rawUrlParam = req.url.substring(urlParamIndex + 4);
    try {
      streamUrl = decodeURIComponent(rawUrlParam);
    } catch (_) {
      streamUrl = rawUrlParam;
    }
  }

  let stalkerMac = req.query.mac as string || "";
  let stalkerToken = req.query.token as string || "";
  try {
    const parsedUrl = new URL(streamUrl);
    if (!stalkerMac) stalkerMac = parsedUrl.searchParams.get("mac") || "";
    if (!stalkerToken) stalkerToken = parsedUrl.searchParams.get("play_token") || parsedUrl.searchParams.get("token") || "";
  } catch (_) {}

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "Accept": "*/*",
  };

  if (stalkerMac) {
    headers["Cookie"] = `mac=${stalkerMac}; stb_lang=en; timezone=Europe%2FParis`;
    headers["X-User-Agent"] = "Model: MAG250; Link: WiFi";
  }
  if (stalkerToken) {
    headers["Authorization"] = `Bearer ${stalkerToken}`;
  }

  let host = "";
  let port = 80;
  try {
    const u = new URL(streamUrl);
    host = u.hostname;
    port = u.port ? parseInt(u.port) : (u.protocol === "https:" ? 443 : 80);
  } catch (_) {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    let redirectUrl = "";
    let response: any = null;
    let fetchError: any = null;

    try {
      response = await fetch(streamUrl, {
        method: "GET",
        headers,
        redirect: "manual", // Detect 301/302 redirects
        signal: controller.signal,
      });
    } catch (err: any) {
      fetchError = err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (fetchError) {
      const isAbort = fetchError.name === "AbortError";
      const errorCode = isAbort ? "ETIMEDOUT" : (fetchError.code || "ECONNREFUSED");
      const errorMessage = isAbort ? "Connection timeout: no response from streaming server" : fetchError.message;

      // Active Network Probe
      const connectionCheck = await checkUpstreamStatus(streamUrl);

      res.status(200).json({
        success: false,
        status: 0,
        error: errorMessage,
        proxyStatus: 503,
        upstreamStatus: null,
        source: "LOCAL_PROXY",
        errorCode: connectionCheck.errorDetails?.code || errorCode,
        errorMessage: connectionCheck.errorDetails?.message || errorMessage,
        dnsResolved: connectionCheck.dnsResolved,
        tcpConnected: connectionCheck.tcpConnected,
        host: host || connectionCheck.errorDetails?.hostname || "",
        port: port || connectionCheck.errorDetails?.port || 80,
        syscall: connectionCheck.errorDetails?.syscall || "connect"
      });
      return;
    }

    const isRedirect = [301, 302, 307, 308].includes(response.status);
    if (isRedirect) {
      redirectUrl = response.headers.get("location") || "";
    }

    // Cancel response body immediately
    if (response.body) {
      response.body.cancel().catch(() => {});
    }

    const isOk = response.ok || response.status === 206 || isRedirect;

    res.json({
      success: isOk,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "unknown",
      redirect: isRedirect,
      redirectUrl,
      authentication: response.status !== 401 && response.status !== 403,
      proxyStatus: isOk ? 200 : 503,
      upstreamStatus: response.status,
      source: "UPSTREAM_SERVER",
      errorCode: "none",
      errorMessage: "none",
      dnsResolved: true,
      tcpConnected: true
    });

  } catch (err: any) {
    res.json({
      success: false,
      status: 0,
      error: err.message || "Unknown error during probe",
      proxyStatus: 503,
      upstreamStatus: null,
      source: "LOCAL_PROXY",
      errorCode: err.code || "UNKNOWN_ERROR",
      errorMessage: err.message || "Unknown error during probe",
      dnsResolved: false,
      tcpConnected: false,
      host,
      port
    });
  }
});

// ============================================================================
// ISOLATED STALKER HLS REMUX TEST MODULE (COPY -c:v copy -c:a copy)
// ============================================================================

// 1. Get FFmpeg system info
app.get("/api/test/stalker-hls/info", (_req: Request, res: Response) => {
  const info = checkFFmpegEnv();
  res.json({
    ffmpegInstalled: info.installed,
    ffmpegVersion: info.version,
    ffmpegPath: info.path,
    platform: info.platform,
    arch: info.arch,
    cwd: info.cwd,
    errorCode: info.errorCode,
    errorMessage: info.errorMessage,
  });
});

// 2. Start HLS Remux session
app.post("/api/test/stalker-hls/start", async (req: Request, res: Response) => {
  try {
    const { streamUrl, mac, token, play_token, userAgent, referer } = req.body;
    if (!streamUrl) {
      res.status(400).json({ success: false, error: "streamUrl is required" });
      return;
    }

    const result = await startHlsSession({
      streamUrl,
      mac,
      token,
      playToken: play_token,
      userAgent,
      referer,
    });

    res.json(result);
  } catch (err: any) {
    console.error("[Stalker HLS Start Error]:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to start HLS session" });
  }
});

// 3. Get session status & diagnostics
app.get("/api/test/stalker-hls/:sessionId/status", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const status = getSessionStatus(sessionId);
  if (!status.sessionExists) {
    res.status(404).json({ success: false, sessionExists: false, error: "Session introuvable ou expirée" });
    return;
  }
  res.json({ success: true, ...status });
});

// 4. Serve HLS index.m3u8 playlist
app.get("/api/test/stalker-hls/:sessionId/index.m3u8", async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const manifestPath = path.join(os.tmpdir(), "iptv-hls", sessionId, "index.m3u8");

  // Wait up to 3 seconds if manifest file is being written
  let waitedMs = 0;
  while (!fs.existsSync(manifestPath) && waitedMs < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    waitedMs += 200;
  }

  if (!fs.existsSync(manifestPath)) {
    // Check if session exists but manifest is not yet written
    const status = getSessionStatus(sessionId);
    if (status.sessionExists && status.status === "running") {
      res.set({
        "Access-Control-Allow-Origin": "*",
        "Retry-After": "1",
      });
      res.status(503).send("#EXTM3U\n#EXT-X-ERROR: Generating segments...\n");
      return;
    }
    res.status(404).send("Manifest not found");
    return;
  }

  res.set({
    "Content-Type": "application/vnd.apple.mpegurl",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "*",
  });

  const content = fs.readFileSync(manifestPath);
  res.send(content);
});

// 5. Serve HLS .ts video segments
app.get("/api/test/stalker-hls/:sessionId/:segment", (req: Request, res: Response) => {
  const { sessionId, segment } = req.params;

  // Validate filename to prevent directory traversal
  if (!/^[a-zA-Z0-9_\-]+\.ts$/.test(segment)) {
    res.status(400).send("Invalid segment filename");
    return;
  }

  const segmentPath = path.join(os.tmpdir(), "iptv-hls", sessionId, segment);

  if (!fs.existsSync(segmentPath)) {
    res.status(404).send("Segment not found");
    return;
  }

  res.set({
    "Content-Type": "video/mp2t",
    "Cache-Control": "public, max-age=60",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "*",
  });

  const stream = fs.createReadStream(segmentPath);
  stream.pipe(res);
});

// 6. Stop HLS Remux session
app.post("/api/test/stalker-hls/:sessionId/stop", (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const stopped = stopHlsSession(sessionId);
  res.json({ success: stopped, sessionId });
});

// Start Express + Vite Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[iSTB Server] Running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
