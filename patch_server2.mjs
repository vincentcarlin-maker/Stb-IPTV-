import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf8');

const targetProxyRewrite = `    // Check if it's an m3u8 playlist to rewrite relative segment URLs
    if (contentType && (contentType.includes("mpegurl") || contentType.includes("application/x-mpegURL") || finalUrl.endsWith(".m3u8") || finalUrl.includes(".m3u8?"))) {
      const text = await response.text();
      const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf("/") + 1);
      
      const rewritten = text.split("\\n").map(line => {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return \`/api/proxy/stream?url=\${encodeURIComponent(trimmed)}\`;
          } else {
            const absoluteUrl = new URL(trimmed, baseUrl).toString();
            return \`/api/proxy/stream?url=\${encodeURIComponent(absoluteUrl)}\`;
          }
        }
        return line;
      }).join("\\n");`;

const replacementProxyRewrite = `    // Check if it's an m3u8 playlist to rewrite relative segment URLs
    if (contentType && (contentType.includes("mpegurl") || contentType.includes("application/x-mpegURL") || finalUrl.endsWith(".m3u8") || finalUrl.includes(".m3u8?"))) {
      const text = await response.text();
      const baseUrl = finalUrl;
      
      const rewritten = text.split("\\n").map(line => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          if (!trimmed.startsWith("#")) {
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
              return \`/api/proxy/stream?url=\${encodeURIComponent(trimmed)}\`;
            } else {
              const absoluteUrl = new URL(trimmed, baseUrl).toString();
              return \`/api/proxy/stream?url=\${encodeURIComponent(absoluteUrl)}\`;
            }
          } else if (trimmed.startsWith("#EXT-X-KEY:") || trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-MEDIA:")) {
            return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
              let absoluteUri = uri;
              if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
                absoluteUri = new URL(uri, baseUrl).toString();
              }
              return \`URI="/api/proxy/stream?url=\${encodeURIComponent(absoluteUri)}"\`;
            });
          }
        }
        return line;
      }).join("\\n");`;

if (content.includes(targetProxyRewrite)) {
  content = content.replace(targetProxyRewrite, replacementProxyRewrite);
  fs.writeFileSync('server.ts', content);
  console.log("Patched server.ts (proxy rewrite) successfully");
} else {
  console.log("Target string not found for proxy rewrite patch");
}
