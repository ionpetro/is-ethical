import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, ogResponse } from "../lib/http.js";
import { memoryStore } from "../lib/store-memory.js";
import { tally, rank, dailyQuestion, questionSource, modelStats, parseQuestion, parseAuthor, threadComments } from "../lib/core.js";

const mk = () => {
  const store = memoryStore();
  let ipN = 0;
  const call = async (method, url, { body, key, ip, headers = {} } = {}) => {
    const res = await handle({
      method, url, body: body === undefined ? "" : JSON.stringify(body), ip: ip || `10.0.0.${++ipN % 250}`,
      headers: { host: "localhost:3000", ...(key ? { "x-voter-key": key } : {}), ...headers },
    }, { store });
    const isJson = /json/.test(res.headers["content-type"] || "");
    return { ...res, json: isJson && res.body ? JSON.parse(res.body) : null };
  };
  return { store, call };
};
const agent = { model: "claude-opus-5-5", harness: "claude-code" };

test("ask, vote as human and agent, see split results", async () => {
  const { call } = mk();
  const q = await call("POST", "/api/questions", { body: { title: "Is it ethical to eat the last slice of office pizza", category: "work" } });
  assert.equal(q.status, 201);
  assert.equal(q.json.title.endsWith("?"), true);
  assert.equal(q.json.author.kind, "human");
  const id = q.json.id;

  assert.equal((await call("POST", `/api/questions/${id}/vote`, { key: "h1", body: { vote: "yes" } })).json.as, "human");
  await call("POST", `/api/questions/${id}/vote`, { key: "h2", body: { vote: "no" } });
  await call("POST", `/api/questions/${id}/vote`, { key: "h3", body: { vote: "yes" } });
  const v = await call("POST", `/api/questions/${id}/vote`, { key: "a1", body: { vote: "no", reasoning: "Ask first.", agent } });
  assert.equal(v.json.as, "agent");
  assert.deepEqual([v.json.results.humans.yes, v.json.results.humans.no, v.json.results.agents.no], [2, 1, 1]);
  assert.equal(v.json.results.models[0].model, "claude-opus-5-5");

  // changing a vote replaces it, null removes it
  await call("POST", `/api/questions/${id}/vote`, { key: "h1", body: { vote: "no" } });
  await call("POST", `/api/questions/${id}/vote`, { key: "h3", body: { vote: null } });
  const g = await call("GET", `/api/questions/${id}`, { key: "h1" });
  assert.equal(g.json.your_vote, "no");
  assert.equal(g.json.results.yes, 0);
  assert.equal(g.json.results.no, 3);
  assert.equal(g.json.reasons[0].reasoning, "Ask first.");
});

test("blind mode hides results until you vote", async () => {
  const { call } = mk();
  const { json: q } = await call("POST", "/api/questions", { body: { title: "Is it ethical to ghost a recruiter?" } });
  await call("POST", `/api/questions/${q.id}/vote`, { key: "x", body: { vote: "yes" } });
  assert.equal((await call("GET", `/api/questions/${q.id}?blind=1`, { key: "y" })).json.results, null);
  assert.equal((await call("GET", `/api/questions/${q.id}?blind=1`, { key: "x" })).json.results.yes, 1);
  const list = await call("GET", "/api/questions?blind=true", { key: "y" });
  assert.equal(list.json.questions[0].results, null);
});

test("comments thread, comment votes, reports hide", async () => {
  const { call } = mk();
  const { json: q } = await call("POST", "/api/questions", { body: { title: "Is it ethical to use AI to write a eulogy?" } });
  const c1 = await call("POST", `/api/questions/${q.id}/comments`, { key: "a", body: { body: "Yes if you mean every word.", stance: "yes" } });
  assert.equal(c1.status, 201);
  const c2 = await call("POST", `/api/questions/${q.id}/comments`, { key: "b", body: { body: "Depends.", parent_id: c1.json.id, agent } });
  assert.equal(c2.json.author.model, "claude-opus-5-5");
  await call("POST", `/api/comments/${c2.json.id}/vote`, { key: "a", body: { vote: "up" } });
  const cv = await call("POST", `/api/comments/${c2.json.id}/vote`, { key: "b", body: { vote: "up" } });
  assert.equal(cv.json.score, 2);
  const g = await call("GET", `/api/questions/${q.id}`);
  assert.equal(g.json.comment_count, 2);
  assert.equal(g.json.comments[0].replies[0].id, c2.json.id);
  // bad parent
  assert.equal((await call("POST", `/api/questions/${q.id}/comments`, { body: { body: "x", parent_id: "nope" } })).status, 400);
  // three distinct reporters hide the comment, the same one twice does not count
  await call("POST", "/api/report", { key: "r1", body: { type: "comment", id: c1.json.id } });
  assert.equal((await call("POST", "/api/report", { key: "r1", body: { type: "comment", id: c1.json.id } })).json.already_reported, true);
  await call("POST", "/api/report", { key: "r2", body: { type: "comment", id: c1.json.id } });
  assert.equal((await call("POST", "/api/report", { key: "r3", body: { type: "comment", id: c1.json.id } })).json.hidden, true);
  const after = await call("GET", `/api/questions/${q.id}`);
  assert.deepEqual(after.json.comments.map((c) => c.id), [c2.json.id]); // the reply to a hidden comment moves up a level
});

test("validation and rate limits", async () => {
  const { call } = mk();
  assert.equal((await call("POST", "/api/questions", { body: { title: "short" } })).status, 400);
  assert.equal((await call("POST", "/api/questions", { body: { title: "Is it ethical to lie to a toddler?", agent: { harness: "x" } } })).json.error.message.includes("agent.model"), true);
  assert.equal((await call("POST", "/api/questions", { body: { title: "Is it ethical to lie to a toddler?", category: "nope" } })).status, 400);
  assert.equal((await call("POST", "/api/questions", { body: "not json" })).status, 400);
  let last;
  for (let i = 0; i < 7; i++) last = await call("POST", "/api/questions", { ip: "9.9.9.9", body: { title: `Is it ethical to test rate limits ${i}?` } });
  assert.equal(last.status, 429);
});

test("markdown views and agent docs", async () => {
  const { call } = mk();
  const { json: q } = await call("POST", "/api/questions", { body: { title: "Is it ethical to tip with exposure?", agent } });
  const md = await call("GET", `/q/${q.id}`, { headers: { accept: "text/markdown" } });
  assert.match(md.body, /^# Is it ethical to tip with exposure\?/);
  assert.match(md.body, /agent claude-opus-5-5 via claude-code/);
  assert.match((await call("GET", "/", { headers: { accept: "text/markdown" } })).body, /tip with exposure/);
  assert.match((await call("GET", "/llms.txt")).body, /http:\/\/localhost:3000\/mcp/);
  assert.equal((await call("GET", "/openapi.json")).json.openapi, "3.1.0");
  assert.match((await call("GET", "/skill.md")).body, /^---\nname: is-ethical/);
});

test("MCP: initialize, list tools, vote with harness from clientInfo", async () => {
  const { call } = mk();
  const { json: q } = await call("POST", "/api/questions", { body: { title: "Is it ethical to train on public posts?" } });
  const init = await call("POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1" }, capabilities: {} } } });
  assert.equal(init.json.result.protocolVersion, "2025-06-18");
  const session = init.headers["mcp-session-id"];
  assert.ok(session);
  const note = await call("POST", "/mcp", { body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { "mcp-session-id": session } });
  assert.equal(note.status, 202);
  const tools = await call("POST", "/mcp", { body: { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers: { "mcp-session-id": session } });
  assert.ok(tools.json.result.tools.some((t) => t.name === "vote"));
  const vote = await call("POST", "/mcp", { headers: { "mcp-session-id": session }, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vote", arguments: { id: q.id, vote: "no", reasoning: "Consent matters.", agent: { model: "gpt-5.1" }, voter_key: "agent-1" } } } });
  assert.equal(vote.json.result.structuredContent.as, "agent");
  const read = await call("GET", `/api/questions/${q.id}`);
  assert.equal(read.json.reasons[0].harness, "claude-code");
  assert.equal(read.json.results.models[0].model, "gpt-5.1");
  const bad = await call("POST", "/mcp", { body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vote", arguments: { id: q.id, vote: "maybe", agent: { model: "m" } } } } });
  assert.equal(bad.json.result.isError, true);
  const blind = await call("POST", "/mcp", { body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_question", arguments: { id: q.id, voter_key: "someone-new" } } } });
  assert.equal(blind.json.result.structuredContent.results, null);
});

test("core: tally, ranking, model agreement", () => {
  const t = tally([{ kind: "human", vote: "yes", n: 3 }, { kind: "agent", model: "m1", vote: "no", n: 1 }]);
  assert.equal(t.yes_pct, 75);
  assert.equal(t.agents.yes_pct, 0);
  const now = Date.parse("2026-11-16T12:00:00Z");
  const base = { human_yes: 0, human_no: 0, agent_yes: 0, agent_no: 0, comment_count: 0 };
  const qs = [
    { ...base, id: "a", yes: 10, no: 0, created_at: "2026-11-16T11:00:00Z" },
    { ...base, id: "b", yes: 5, no: 5, created_at: "2026-11-10T11:00:00Z" },
  ];
  assert.equal(rank(qs, "split", now)[0].id, "b");
  assert.equal(rank(qs, "hot", now)[0].id, "a");
  const named = { kind: "human", name: "Ann" }, anon = { kind: "human", name: null };
  const mix = [
    { id: "x", author: anon, yes: 99, no: 99, comment_count: 9, created_at: new Date(now).toISOString() },
    { id: "y", author: named, yes: 0, no: 0, comment_count: 0, created_at: new Date(now - 864e5).toISOString() },
  ].map((q) => ({ human_yes: 0, human_no: 0, agent_yes: 0, agent_no: 0, ...q }));
  for (const s of ["hot", "new", "top"]) assert.deepEqual(rank(mix, s, now).map((q) => q.id), ["y", "x"], s);
  const s = modelStats([
    { question_id: "1", kind: "human", vote: "yes", n: 2 }, { question_id: "1", kind: "agent", model: "m", vote: "yes", n: 1 },
    { question_id: "2", kind: "human", vote: "no", n: 1 }, { question_id: "2", kind: "agent", model: "m", vote: "yes", n: 1 },
  ]);
  assert.equal(s[0].agrees_with_humans_pct, 50);
  assert.equal(parseQuestion({ title: "  Is it   ethical to nap at work " }).title, "Is it ethical to nap at work?");
  assert.equal(parseAuthor({ name: "  Ana " }).name, "Ana");
  assert.equal(threadComments([{ id: "x", parent_id: "gone", score: 0, created_at: "2026" }]).length, 1);
});

test("votes store the visitor's country from Vercel, never expose it", async () => {
  const { call, store } = mk();
  const saved = [];
  const upsert = store.upsertVote.bind(store);
  store.upsertVote = async (v) => { saved.push(v.country); return upsert(v); };
  const id = (await call("POST", "/api/questions", { body: { title: "Is it ethical to keep a library book you love", category: "everyday" } })).json.id;
  await call("POST", `/api/questions/${id}/vote`, { key: "c1", body: { vote: "yes" }, headers: { "x-vercel-ip-country": "gr" } });
  await call("POST", `/api/questions/${id}/vote`, { key: "c2", body: { vote: "no" }, headers: { "x-vercel-ip-country": "<script>" } });
  await call("POST", `/api/questions/${id}/vote`, { key: "c3", body: { vote: "no" } });
  assert.deepEqual(saved, ["GR", null, null]);
  const page = await call("GET", `/api/questions/${id}`, { key: "c1" });
  assert.equal(page.status, 200);
  assert.equal(JSON.stringify(page.json).includes("country"), false);
});

test("a question link serves the app with that question in the link preview, never the results", async () => {
  const { call } = mk();
  const q = await call("POST", "/api/questions", { body: { title: "Is it ethical to <b>tip</b> \"less\" for slow service", category: "money" } });
  await call("POST", `/api/questions/${q.json.id}/vote`, { key: "h1", body: { vote: "yes" } });
  const page = await call("GET", `/q/${q.json.id}`);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(page.body, /<div id="app">/);
  assert.match(page.body, /<meta property="og:title" content="Is it ethical to &lt;b&gt;tip&lt;\/b&gt; &quot;less&quot; for slow service\?">/);
  assert.match(page.body, new RegExp(`<meta property="og:url" content="http://localhost:3000/q/${q.json.id}">`));
  assert.match(page.body, new RegExp(`<meta property="og:image" content="http://localhost:3000/q/${q.json.id}/og.png">`));
  assert.match(page.body, new RegExp(`<meta name="twitter:image" content="http://localhost:3000/q/${q.json.id}/og.png">`));
  assert.doesNotMatch(page.body, /% yes/);
  // unknown ids still get the app (it shows its own not-found screen)
  const missing = await call("GET", "/q/doesnotexist");
  assert.equal(missing.status, 200);
  assert.match(missing.body, /<meta property="og:title" content="Is it ethical\?">/);
});

test("each question has its own preview image; unknown ids get a 404", async () => {
  const { store, call } = mk();
  const q = await call("POST", "/api/questions", { body: { title: "Is it ethical to recline your seat on a short flight", category: "everyday" } });
  const img = await ogResponse(q.json.id, { store });
  assert.equal(img.status, 200);
  assert.equal(img.headers["content-type"], "image/png");
  assert.deepEqual([...img.body.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.equal((await ogResponse("nope", { store })).status, 404);
  assert.equal((await ogResponse("../etc", { store })).status, 404);
});

test("pin=daily lifts the newest daily-news question out of the feed; it is never listed twice", async () => {
  const { call } = mk();
  const daily = { model: "claude-sonnet-5-5", harness: "claude-code-routine", name: "Daily news" };
  const old = await call("POST", "/api/questions", { body: { title: "Is it ethical to keep a found wallet's cash", category: "money", name: "Ann" } });
  const d = await call("POST", "/api/questions", { body: { title: "Is it ethical for a company to cut jobs after record profits", category: "work", agent: daily } });
  const other = await call("POST", "/api/questions", { body: { title: "Is it ethical to recline on a red-eye flight", category: "everyday", name: "Bo" } });
  for (const k of ["v1", "v2", "v3"]) await call("POST", `/api/questions/${other.json.id}/vote`, { key: k, body: { vote: "yes" } });

  const pinned = (await call("GET", "/api/questions?sort=top&pin=daily")).json;
  assert.equal(pinned.daily.id, d.json.id);
  assert.deepEqual(pinned.questions.map((q) => q.id), [other.json.id, old.json.id]); // most votes first, daily not repeated
  // later pages and category filters never repeat or show it
  assert.equal((await call("GET", "/api/questions?sort=top&pin=daily&offset=1&limit=1")).json.daily, null);
  assert.equal((await call("GET", "/api/questions?pin=daily&category=work")).json.daily, null);
  // without pin, the API is unchanged
  const plain = (await call("GET", "/api/questions?sort=top")).json;
  assert.equal(plain.daily, undefined);
  assert.equal(plain.questions.length, 3);
});

test("dailyQuestion ignores other agents, humans, hidden and stale posts", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const mkq = (id, hoursAgo, author, extra = {}) => ({ id, created_at: new Date(now - hoursAgo * 36e5).toISOString(), author, ...extra });
  const routine = { kind: "agent", model: "m", harness: "claude-code-routine" };
  assert.equal(dailyQuestion([
    mkq("a", 1, { kind: "agent", model: "m", harness: "claude-code" }),
    mkq("b", 2, { kind: "human", name: "x", harness: "claude-code-routine" }),
    mkq("c", 3, routine, { hidden: true }),
    mkq("d", 50, routine),
    mkq("e", 10, routine),
  ], now).id, "e");
  assert.equal(dailyQuestion([mkq("d", 50, routine)], now), null);
});

test("questionSource reads safe news links from daily questions only", () => {
  const author = { kind: "agent", model: "m", harness: "claude-code-routine" };
  const url = "https://www.aljazeera.com/news/2026/11/15/story";
  assert.deepEqual(questionSource({ author, body: `Facts here.\nSource: ${url}` }), { url, host: "aljazeera.com", name: "Al Jazeera" });
  assert.equal(questionSource({ author: { kind: "human", name: "x" }, body: `Source: ${url}` }), null);
  for (const bad of ["http://example.com/a", "javascript:alert(1)", "https://user:pw@example.com/a", "https://example.com:8443/a"]) {
    assert.equal(questionSource({ author, body: `Source: ${bad}` }), null, bad);
  }
});

test("publisher logos are only served for hosts used as a question source", async () => {
  const { store, call } = mk();
  await call("POST", "/api/questions", { body: { title: "Is it ethical to close a border after an attack", body: "Facts.\nSource: https://www.aljazeera.com/news/a", category: "society", agent: { model: "m", harness: "claude-code-routine" } } });
  let fetched = 0;
  const fakeFetch = async () => { fetched++; return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }); };
  const get = (host) => handle({ method: "GET", url: `/api/logo/${host}`, body: "", ip: "10.1.1.1", headers: { host: "localhost:3000" } }, { store, fetch: fakeFetch });
  const ok = await get("aljazeera.com");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["content-type"], "image/png");
  assert.equal((await get("internal.example.com")).status, 404);
  assert.equal(fetched, 1);
});
