// Local dev server: static files from public/, everything else through the same handler Vercel uses.
// Usage: npm run dev  (PORT=3000, data saved to data/dev.json; set DATABASE_URL to use Postgres)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handle } from "./lib/http.js";

const PORT = Number(process.env.PORT || 3000);
const ROOT = new URL("./public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".json": "application/json" };
const SPA = /^\/($|q\/[a-z0-9]+$|ask$|agents$|about$)/;
const DYNAMIC = /^\/(analytics\.js$|api(\/|$)|mcp$|llms\.txt$|openapi\.json$|skill\.md$|SKILL\.md$|sitemap\.xml$|index\.md$|\.well-known\/|q\/[a-z0-9]+\.md$)/;

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname;
    const md = /text\/markdown/.test(req.headers.accept || "");
    if (DYNAMIC.test(path) || (md && SPA.test(path))) {
      let body = "";
      for await (const c of req) body += c;
      const out = await handle({ method: req.method, url: req.url, headers: req.headers, body, ip: req.socket.remoteAddress });
      res.writeHead(out.status, out.headers).end(out.body);
      return;
    }
    const file = SPA.test(path) ? "index.html" : normalize(path).replace(/^(\.\.[/\\])+/, "").slice(1);
    const data = await readFile(join(ROOT, file)).catch(() => null);
    if (!data) return res.writeHead(404, { "content-type": "text/html" }).end(await readFile(join(ROOT, "index.html")));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(data);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end("server error");
  }
}).listen(PORT, () => console.log(`Is it ethical? on http://localhost:${PORT}`));
