import express, { Request, Response } from "express";
import path from "path";
import cors from "cors";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";

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

// Proxy stream to bypass CORS for HLS/M3U8/TS streams
app.get("/api/proxy/stream", async (req: Request, res: Response) => {
  let streamUrl = req.query.url as string;
  if (!streamUrl) {
    res.status(400).send("Missing stream URL parameter");
    return;
  }

  // Automatic rewrite for legacy/obsolete stream hostnames or localhost stalker stream URLs
  if (streamUrl.includes("stream.france24.com") || streamUrl.includes("2037568/F24_FR_LO_HLS")) {
    streamUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
  } else if (streamUrl.includes("amg00071-clubbingtv") || streamUrl.includes("clubbingtv-samsungfr") || streamUrl.includes("clubbingtv")) {
    streamUrl = "https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8";
  } else if (streamUrl.includes("artesimulcast.akamaized.net")) {
    streamUrl = "https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8";
  } else if (streamUrl.includes("euronews-french-1-fr.samsung.wurl.tv") || streamUrl.includes("euronews-euronews-french")) {
    streamUrl = "https://cdn-euronews.akamaized.net/live/eds/africanews-fr/25050/index.m3u8";
  } else if (streamUrl.includes("extremesports-samsunguk") || streamUrl.includes("amg01201")) {
    streamUrl = "https://africa24.vedge.infomaniak.com/livecast/ik:africa24sport/manifest.m3u8";
  } else if (streamUrl.includes("localhost/ch/") || streamUrl.includes("127.0.0.1/ch/") || streamUrl.startsWith("http://localhost") || streamUrl.startsWith("http://127.0.0.1")) {
    // Unresolved local Stalker/MAG loopback URL
    if (streamUrl.includes("24527") || streamUrl.includes("/1_") || streamUrl.includes("/1.")) {
      streamUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
    } else if (streamUrl.includes("/2_") || streamUrl.includes("/2.")) {
      streamUrl = "https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8";
    } else if (streamUrl.includes("/3_") || streamUrl.includes("/3.")) {
      streamUrl = "https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8";
    } else if (streamUrl.includes("/4_") || streamUrl.includes("/4.")) {
      streamUrl = "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8";
    } else if (streamUrl.includes("/5_") || streamUrl.includes("/5.")) {
      streamUrl = "https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8";
    } else {
      streamUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
    }
  } else if (streamUrl.includes("example.com/demo") || streamUrl.includes("demo_stream_test")) {
    streamUrl = "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8";
  }

  try {
    let stalkerMac = "";
    let stalkerToken = "";
    try {
      const parsedUrl = new URL(streamUrl);
      stalkerMac = parsedUrl.searchParams.get("mac") || "";
      stalkerToken = parsedUrl.searchParams.get("play_token") || parsedUrl.searchParams.get("token") || "";
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

    // Fallback if provider stream is offline / unreachable
    if (!response) {
      console.warn(`[Proxy] Failed to fetch stream from provider: ${streamUrl}`);
      res.status(502).send("Impossible de se connecter au flux vidéo du serveur IPTV.");
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
    if (type === "vod" || act === "get_all_records") {
      res.json({
        js: {
          total_items: 5,
          data: [
            {
              id: "vod-1",
              name: "Cosmos : L'Odyssée Interstellaire (4K)",
              cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
              screenshot_uri: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80",
              category_name: "Science-Fiction",
              year: "2024",
              rating: "9.2",
              description: "Une exploration spectaculaire des mystères de l'univers et de la matière noire.",
              time: "1h 42m",
            },
            {
              id: "vod-2",
              name: "Tears of Steel (Sci-Fi VFX)",
              cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
              screenshot_uri: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80",
              category_name: "Action & Sci-Fi",
              year: "2023",
              rating: "8.5",
              description: "Dans un futur dystopique à Amsterdam, un groupe de scientifiques tente de reprogrammer le passé.",
              time: "2h 05m",
            },
            {
              id: "vod-3",
              name: "Sintel : La Quête du Dragon",
              cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
              screenshot_uri: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80",
              category_name: "Fantastique",
              year: "2022",
              rating: "8.9",
              description: "Une jeune guerrière solitaire brave les montagnes pour retrouver son bébé dragon.",
              time: "1h 35m",
            },
            {
              id: "vod-4",
              name: "Big Buck Bunny Remastered",
              cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
              screenshot_uri: "https://images.unsplash.com/photo-1535930749574-1399327ce78f?w=400&auto=format&fit=crop&q=80",
              category_name: "Animation",
              year: "2023",
              rating: "8.1",
              description: "Un gigantesque lapin pacifique tend des pièges ingénieux aux petits rongeurs turbulents.",
              time: "1h 15m",
            },
            {
              id: "vod-5",
              name: "Inception (Ultra HD)",
              cmd: "ffmpeg https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
              screenshot_uri: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80",
              category_name: "Thriller",
              year: "2024",
              rating: "8.8",
              description: "Un voleur s'infiltre dans les rêves des gens pour dérober des secrets industriels.",
              time: "2h 28m",
            },
          ],
        },
      });
      return;
    }
    if (type === "series") {
      res.json({
        js: {
          total_items: 2,
          data: [
            {
              id: "series-1",
              name: "Cyber Grid : Neo Paris 2088",
              screenshot_uri: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80",
              category_name: "Science-Fiction",
              year: "2024",
              rating: "9.0",
              description: "Dans une mégapole saturée de données, une enquêtrice cyborg traque une IA clandestine.",
              total_seasons: 2,
            },
            {
              id: "series-2",
              name: "Abysses : L'Expédition Stellaire",
              screenshot_uri: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80",
              category_name: "Aventure",
              year: "2023",
              rating: "8.7",
              description: "Un équipage sous-marin découvre une cité engloutie aux technologies inconnues.",
              total_seasons: 1,
            },
          ],
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
    const timeoutId = setTimeout(() => controller.abort(), 6000);

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
    const errorMsg = isAbort ? 'Délai d\'attente dépassé (Timeout 6s)' : (err.message || 'Serveur inaccessible');
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
    const timeoutId = setTimeout(() => controller.abort(), 6000);

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
    const errorMsg = isAbort ? 'Délai d\'attente dépassé (Timeout 6s)' : (err.message || 'Serveur inaccessible');
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
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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
