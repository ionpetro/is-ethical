// Vercel serverless entry. vercel.json rewrites every dynamic path here with ?p=<original path>.
import { handle } from "../lib/http.js";

const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (c) => { data += c; if (data.length > 70_000) req.destroy(); });
  req.on("end", () => resolve(data));
  req.on("error", reject);
});

export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.searchParams.get("p");
  u.searchParams.delete("p");
  const url = (p || u.pathname) + (u.search || "");
  const out = await handle({
    method: req.method,
    url,
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(",") : v])),
    body: req.method === "POST" ? await readBody(req) : "",
  });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
