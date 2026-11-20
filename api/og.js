// Vercel function: /q/<id>/og.png -> link-preview image for that question (vercel.json rewrites it here with ?id=).
import { ogResponse } from "../lib/http.js";

export default async function handler(req, res) {
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  const out = await ogResponse(id);
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
