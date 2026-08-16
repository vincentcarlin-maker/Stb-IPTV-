const fs = require('fs');
let code = fs.readFileSync('src/components/LivePlayer.tsx', 'utf-8');

// Replace `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`
code = code.replace(/`\/api\/proxy\/stream\?url=\$\{encodeURIComponent\(([^)]+)\)\}`/g, (match, urlVar) => {
  return `\`/api/proxy/stream?url=\$\{encodeURIComponent(${urlVar})\}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}\``;
});

fs.writeFileSync('src/components/LivePlayer.tsx', code);
