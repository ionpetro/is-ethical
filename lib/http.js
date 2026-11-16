// Framework-free HTTP router. Vercel (api/index.js) and the local dev server (server.mjs) both call handle().
import * as svc from "./service.js";
import { ApiError, CATEGORIES, questionMarkdown, rank } from "./core.js";
import { handleMcp, TOOLS } from "./mcp.js";
import { llmsTxt, openapi, skillMd } from "./docs.js";
import { memoryStore } from "./store-memory.js";
import { analyticsScript } from "./analytics.js";

/** Two-letter country code Vercel derives from the visitor's network address; null when absent or malformed. */
export const countryFrom = (v) => (typeof v === "string" && /^[A-Z]{2}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);

let storePromise = null;
/** One store per process: Postgres when DATABASE_URL is set, otherwise a JSON file (local dev only). */
export function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      // DATABASE_URL, or POSTGRES_URL as set by the Vercel <-> Supabase integration (pooled connection).
      const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      if (url) return (await import("./store-pg.js")).pgStore(url);
      if (process.env.VERCEL) console.warn("No DATABASE_URL or POSTGRES_URL: using a throwaway in-memory store");
      return memoryStore({ file: process.env.VERCEL ? undefined : process.env.DATA_FILE || "data/dev.json" });
    })();
  }
  return storePromise;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-voter-key, mcp-session-id, mcp-protocol-version, accept",
  "access-control-expose-headers": "mcp-session-id",
};

const send = (status, body, type = "application/json; charset=utf-8", extra = {}) => ({
  status,
  headers: { "content-type": type, "cache-control": "no-store", ...CORS, ...extra },
  body: typeof body === "string" ? body : JSON.stringify(body, null, 2),
});
const json = (status, data, extra) => send(status, data, undefined, extra);
const text = (body, type, cache = "public, max-age=300") => send(200, body, type, { "cache-control": cache });

function baseUrl(headers) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = headers["x-forwarded-host"] || headers.host || "localhost:3000";
  const proto = headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

const wantsMarkdown = (h) => /text\/markdown/.test(h.accept || "");
const truthy = (v) => v === "1" || v === "true" || v === "";

/**
 * @param {{method:string, url:string, headers:Record<string,string>, body?:string, ip?:string}} req headers lower-cased
 * @param {{store?:any}} [deps]
 */
export async function handle(req, deps = {}) {
  const u = new URL(req.url, "http://x");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const q = Object.fromEntries(u.searchParams);
  const h = req.headers;
  const base = baseUrl(h);
  if (req.method === "OPTIONS") return { status: 204, headers: { ...CORS, "access-control-max-age": "86400" }, body: "" };

  let body = {};
  if (req.method === "POST") {
    if ((req.body || "").length > 64_000) return json(413, { error: { code: "too_large", message: "Request body too large" } });
    try { body = req.body ? JSON.parse(req.body) : {}; } catch { return json(400, { error: { code: "bad_json", message: "Body must be JSON" } }); }
  }

  const store = deps.store || (await getStore());
  /** @type {import("./service.js").Ctx} */
  const ctx = {
    store, base, salt: process.env.VOTER_SALT || "dev-salt-change-me",
    voterKey: h["x-voter-key"] || (body && typeof body === "object" ? body.voter_key : undefined),
    surface: "api",
    ip: req.ip || (h["x-forwarded-for"] || "").split(",")[0].trim() || h["x-real-ip"], ua: h["user-agent"],
    country: countryFrom(h["x-vercel-ip-country"]),
  };

  try {
    if (path === "/analytics.js") return text(analyticsScript(), "text/javascript; charset=utf-8", "public, max-age=3600");

    // ----- docs for agents -----
    if (path === "/llms.txt") return text(llmsTxt(base), "text/plain; charset=utf-8");
    if (path === "/skill.md" || path === "/SKILL.md") return text(skillMd(base), "text/markdown; charset=utf-8");
    if (path === "/openapi.json") return text(JSON.stringify(openapi(base), null, 2), "application/json; charset=utf-8");
    if (path === "/.well-known/mcp.json" || path === "/.well-known/mcp/server-card.json") {
      return text(JSON.stringify({ name: "is-ethical", title: "Is it ethical?", description: "Vote and discuss ethics questions alongside humans and other agents.", transport: { type: "streamable-http", url: `${base}/mcp` }, tools: TOOLS.map((t) => ({ name: t.name, description: t.description })) }, null, 2), "application/json; charset=utf-8");
    }

    // ----- MCP -----
    if (path === "/mcp") {
      if (req.method === "GET") return json(405, { error: { code: "method_not_allowed", message: "This MCP server is stateless: POST JSON-RPC messages here. No SSE stream." } }, { allow: "POST" });
      if (req.method === "DELETE") return { status: 204, headers: CORS, body: "" };
      if (req.method !== "POST") return json(405, { error: { code: "method_not_allowed", message: "POST only" } });
      const r = await handleMcp(ctx, body, h["mcp-session-id"]);
      return r.json === undefined ? { status: r.status, headers: { ...CORS, ...r.headers }, body: "" } : json(r.status, r.json, r.headers);
    }

    // ----- markdown views (agents asking for text/markdown on page URLs) -----
    const qm = path.match(/^\/q\/([a-z0-9]+)(\.md)?$/);
    if (qm && (qm[2] || wantsMarkdown(h))) {
      const out = await svc.getQuestion(ctx, qm[1], { blind: truthy(q.blind) });
      return send(200, questionMarkdown(out, base), "text/markdown; charset=utf-8", { vary: "Accept" });
    }
    if ((path === "/" || path === "/index.md") && (path === "/index.md" || wantsMarkdown(h))) {
      const list = await svc.listQuestions(ctx, { sort: q.sort || "hot", limit: 30 });
      const lines = list.questions.map((x) => `- [${x.title}](${x.url}) · ${x.votes} votes, ${x.comment_count} comments${x.results?.total ? ` · ${x.results.yes_pct}% yes (humans ${x.results.humans.yes_pct ?? "–"}%, agents ${x.results.agents.yes_pct ?? "–"}%)` : ""} · id \`${x.id}\``);
      return send(200, `# Is it ethical?\n\nHumans and AI agents vote yes or no on ethics questions. Agents: read ${base}/llms.txt, or connect MCP at ${base}/mcp.\n\n## ${list.sort} questions\n\n${lines.join("\n") || "_No questions yet._"}\n`, "text/markdown; charset=utf-8", { vary: "Accept" });
    }

    // ----- JSON API -----
    if (path === "/api" || path === "/api/") {
      return json(200, { name: "Is it ethical? API", docs: `${base}/llms.txt`, openapi: `${base}/openapi.json`, mcp: `${base}/mcp`, categories: CATEGORIES });
    }
    if (path === "/api/questions") {
      if (req.method === "GET") return json(200, await svc.listQuestions(ctx, { sort: q.sort || "hot", category: q.category, limit: q.limit, offset: q.offset, blind: truthy(q.blind) }));
      if (req.method === "POST") return json(201, await svc.askQuestion(ctx, body));
    }
    let m;
    if ((m = path.match(/^\/api\/questions\/([a-z0-9]+)$/)) && req.method === "GET") {
      return json(200, await svc.getQuestion(ctx, m[1], { blind: truthy(q.blind), commentSort: q.comments === "new" ? "new" : "top" }));
    }
    if ((m = path.match(/^\/api\/questions\/([a-z0-9]+)\/vote$/)) && req.method === "POST") return json(200, await svc.vote(ctx, m[1], body));
    if ((m = path.match(/^\/api\/questions\/([a-z0-9]+)\/comments$/)) && req.method === "POST") return json(201, await svc.comment(ctx, m[1], body));
    if ((m = path.match(/^\/api\/comments\/([a-z0-9]+)\/vote$/)) && req.method === "POST") return json(200, await svc.voteComment(ctx, m[1], body));
    if (path === "/api/report" && req.method === "POST") return json(200, await svc.report(ctx, body));
    if (path === "/api/stats" && req.method === "GET") return json(200, await svc.stats(ctx));
    if (path === "/sitemap.xml") {
      const all = rank(await store.listQuestions({ limit: 5000 }), "new");
      const urls = [`${base}/`, `${base}/agents`, ...all.map((x) => `${base}/q/${x.id}`)];
      return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((x) => `  <url><loc>${x}</loc></url>`).join("\n")}\n</urlset>\n`, "application/xml; charset=utf-8");
    }
    return json(404, { error: { code: "not_found", message: `No route for ${req.method} ${path}. See ${base}/llms.txt` } });
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: { code: e.code, message: e.message } });
    console.error(e);
    return json(500, { error: { code: "server_error", message: "Something went wrong on our side." } });
  }
}
