import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf8');

const targetProxy = `// Proxy stream to bypass CORS for HLS/M3U8/TS streams
app.get("/api/proxy/stream", async (req: Request, res: Response) => {
  let streamUrl = req.query.url as string;
  if (!streamUrl) {
    res.status(400).send("Missing stream URL parameter");
    return;
  }`;

const replacementProxy = `// Proxy stream to bypass CORS for HLS/M3U8/TS streams
app.get("/api/proxy/stream", async (req: Request, res: Response) => {
  const requestUrl = new URL(req.originalUrl, \`http://\${req.headers.host}\`);
  let streamUrl = requestUrl.searchParams.get("url");

  if (!streamUrl) {
    res.status(400).send("Missing stream URL parameter");
    return;
  }`;

if (content.includes(targetProxy)) {
  content = content.replace(targetProxy, replacementProxy);
  fs.writeFileSync('server.ts', content);
  console.log("Patched server.ts (proxy query) successfully");
} else {
  console.log("Target string not found for proxy patch");
}
