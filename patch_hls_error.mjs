import fs from 'fs';

let content = fs.readFileSync('src/components/LivePlayer.tsx', 'utf8');

const targetHlsError = `      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(streamTimeout);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!proxyRetriedRef.current && channel?.backupStreamUrl) {`;

const replacementHlsError = `      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(streamTimeout);
          if (isStalkerHlsTest) {
            logDiagnostic(null, true, \`\${data.type} - \${data.details}\`, 'error');
            if (!proxyRetriedRef.current && (channel as any)._originalTsUrl) {
              proxyRetriedRef.current = true;
              console.log('[LivePlayer] Stalker m3u8 test failed, falling back to original ts URL:', (channel as any)._originalTsUrl);
              const fallbackUrl = (channel as any)._originalTsUrl;
              hls.loadSource(useProxy && !fallbackUrl.startsWith('/api/proxy') ? \`/api/proxy/stream?url=\${encodeURIComponent(fallbackUrl)}\` : fallbackUrl);
              return;
            }
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!proxyRetriedRef.current && channel?.backupStreamUrl) {`;

if (content.includes(targetHlsError)) {
  content = content.replace(targetHlsError, replacementHlsError);
  fs.writeFileSync('src/components/LivePlayer.tsx', content);
  console.log("Patched LivePlayer.tsx (Hls.Events.ERROR) successfully");
} else {
  console.log("Target string not found for Hls.Events.ERROR patch");
}
