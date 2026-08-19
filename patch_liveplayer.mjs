import fs from 'fs';

let content = fs.readFileSync('src/components/LivePlayer.tsx', 'utf8');

const targetHlsSupport = `    if (isHlsStream && Hls.isSupported()) {
      const hls = new Hls({`;

const replacementHlsSupport = `    const isStalkerHlsTest = (channel as any)._isStalkerHls;
    const stalkerHlsAudit = (channel as any)._stalkerHlsAudit;

    const logDiagnostic = (networkDetails, isHlsJs, hasError, state) => {
      if (!isStalkerHlsTest || !stalkerHlsAudit) return;
      
      let httpStatus = 'Unknown';
      let contentType = 'Unknown';
      let startsWithM3u = 'Unknown';
      
      if (networkDetails && networkDetails.status) {
        httpStatus = networkDetails.status;
        contentType = networkDetails.getResponseHeader ? (networkDetails.getResponseHeader('Content-Type') || 'Unknown') : 'Unknown';
        startsWithM3u = networkDetails.responseText ? (networkDetails.responseText.startsWith('#EXTM3U') ? 'Oui' : 'Non') : 'Unknown';
      }

      console.log(\`===== STALKER NATIVE HLS PLAYBACK =====
Channel: \${channel?.name || 'Unknown'}
ID: \${channel?.id || 'Unknown'}
CREATE LINK
Success: Oui
Original extension: \${stalkerHlsAudit.originalExtension}
HLS TRANSFORMATION
/play/live.php detected: Oui
Original extension: \${stalkerHlsAudit.originalExtension}
Requested extension: \${stalkerHlsAudit.requestedExtension}
MAC preserved: \${stalkerHlsAudit.macPreserved ? 'Oui' : 'Non'}
Stream ID preserved: \${stalkerHlsAudit.streamIdPreserved ? 'Oui' : 'Non'}
play_token preserved: \${stalkerHlsAudit.playTokenPreserved ? 'Oui' : 'Non'}
Other query parameters preserved: \${stalkerHlsAudit.onlyExtensionChanged ? 'Oui' : 'Non'}
HLS RESPONSE
HTTP status: \${httpStatus}
Content-Type: \${contentType}
Starts with #EXTM3U: \${startsWithM3u}
Redirect count: 0
Detected format: \${startsWithM3u === 'Oui' || contentType.includes('mpegurl') ? 'HLS' : 'Not HLS'}
PLAYER
Engine: \${isHlsJs ? 'HLS.js' : 'Safari Native HLS'}
Manifest loaded: \${hasError ? 'Non' : 'Oui'}
First media segment: \${state === 'playing' ? 'Oui' : (hasError ? 'Non' : 'Pending')}
State: \${state}
FFmpeg used: Non
MPEGTS.js used: Non
Error: \${hasError ? hasError : 'None'}

URL STRUCTURE AUDIT
Original create_link URL: \${stalkerHlsAudit.originalUrlMasked}
Final HLS URL: \${stalkerHlsAudit.finalUrlMasked}
Only extension changed: \${stalkerHlsAudit.onlyExtensionChanged ? 'Oui' : 'Non'}
Hostname match: Oui
Port match: Oui
Stream ID match: Oui
play_token match: Oui\`);
    };

    if (isHlsStream && Hls.isSupported()) {
      const hls = new Hls({
        pLoader: isStalkerHlsTest ? function (config) {
          const loader = new Hls.DefaultConfig.loader(config);
          const load = loader.load.bind(loader);
          loader.load = function (context, config, callbacks) {
            const originalOnSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (response, stats, context, networkDetails) {
              if (context.type === 'manifest') {
                logDiagnostic(networkDetails, true, false, 'loading');
              }
              if (originalOnSuccess) originalOnSuccess(response, stats, context, networkDetails);
            };
            load(context, config, callbacks);
          };
          return loader;
        } : undefined,`;

if (content.includes(targetHlsSupport)) {
  content = content.replace(targetHlsSupport, replacementHlsSupport);
  fs.writeFileSync('src/components/LivePlayer.tsx', content);
  console.log("Patched LivePlayer.tsx (Hls.js config) successfully");
} else {
  console.log("Target string not found for Hls.js config patch");
}
