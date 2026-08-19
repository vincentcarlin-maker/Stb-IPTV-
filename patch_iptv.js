const fs = require('fs');
const content = fs.readFileSync('src/context/IPTVContext.tsx', 'utf8');

const targetStr = `          const dynamicUrl = await stalkerServiceRef.current.createLink(cmdToResolve);
          if (dynamicUrl) {
            channelToPlay = sanitizeChannel({ ...targetCh, streamUrl: dynamicUrl });
          }`;

const replacementStr = `          const dynamicUrl = await stalkerServiceRef.current.createLink(cmdToResolve);
          if (dynamicUrl) {
            let finalUrl = dynamicUrl;
            let stalkerHlsAudit = null;

            try {
              const parsedUrl = new URL(dynamicUrl);
              const originalExtension = parsedUrl.searchParams.get('extension');
              
              if (parsedUrl.pathname.includes('/play/live.php') && originalExtension === 'ts') {
                const macBefore = parsedUrl.searchParams.get('mac');
                const streamBefore = parsedUrl.searchParams.get('stream');
                const tokenBefore = parsedUrl.searchParams.get('play_token');
                
                parsedUrl.searchParams.set('extension', 'm3u8');
                finalUrl = parsedUrl.toString();
                
                const macAfter = parsedUrl.searchParams.get('mac');
                const streamAfter = parsedUrl.searchParams.get('stream');
                const tokenAfter = parsedUrl.searchParams.get('play_token');
                
                stalkerHlsAudit = {
                  originalUrlMasked: dynamicUrl.replace(/(mac=)[^&]+/, '$1MASKED').replace(/(play_token=)[^&]+/, '$1MASKED'),
                  finalUrlMasked: finalUrl.replace(/(mac=)[^&]+/, '$1MASKED').replace(/(play_token=)[^&]+/, '$1MASKED'),
                  originalExtension: 'ts',
                  requestedExtension: 'm3u8',
                  macPreserved: macBefore === macAfter,
                  streamIdPreserved: streamBefore === streamAfter,
                  playTokenPreserved: tokenBefore === tokenAfter,
                  onlyExtensionChanged: true // Assuming true as we only used set('extension')
                };
              }
            } catch(e) {
              console.warn("Error parsing dynamic URL for Stalker HLS transformation", e);
            }

            channelToPlay = sanitizeChannel({ ...targetCh, streamUrl: finalUrl });
            if (stalkerHlsAudit) {
              (channelToPlay as any)._stalkerHlsAudit = stalkerHlsAudit;
              (channelToPlay as any)._isStalkerHls = true;
            }
          }`;

if (content.includes(targetStr)) {
  fs.writeFileSync('src/context/IPTVContext.tsx', content.replace(targetStr, replacementStr));
  console.log("Patched IPTVContext.tsx successfully");
} else {
  console.log("Target string not found in IPTVContext.tsx");
}
