import fs from 'fs';

let content = fs.readFileSync('src/components/LivePlayer.tsx', 'utf8');

const targetSafari = `    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          const proxyUrl = \`/api/proxy/stream?url=\${encodeURIComponent(streamUrlRaw)}\`;
          video.src = proxyUrl;
          video.play().catch(() => {});
        } else {
          setStreamError('Impossible de lire le flux avec le lecteur natif.');
          setIsLoadingStream(false);
        }
      };`;

const replacementSafari = `    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        if (isStalkerHlsTest) {
          logDiagnostic(null, false, false, 'playing');
        }
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (isStalkerHlsTest) {
          logDiagnostic(null, false, 'Native error', 'error');
          if (!proxyRetriedRef.current && (channel as any)._originalTsUrl) {
            proxyRetriedRef.current = true;
            const fallbackUrl = (channel as any)._originalTsUrl;
            video.src = useProxy && !fallbackUrl.startsWith('/api/proxy') ? \`/api/proxy/stream?url=\${encodeURIComponent(fallbackUrl)}\` : fallbackUrl;
            video.play().catch(() => {});
            return;
          }
        }
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          const proxyUrl = \`/api/proxy/stream?url=\${encodeURIComponent(streamUrlRaw)}\`;
          video.src = proxyUrl;
          video.play().catch(() => {});
        } else {
          setStreamError('Impossible de lire le flux avec le lecteur natif.');
          setIsLoadingStream(false);
        }
      };`;

if (content.includes(targetSafari)) {
  content = content.replace(targetSafari, replacementSafari);
  fs.writeFileSync('src/components/LivePlayer.tsx', content);
  console.log("Patched LivePlayer.tsx (Safari Native) successfully");
} else {
  console.log("Target string not found for Safari Native patch");
}
