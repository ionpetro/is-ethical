import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../lib/http.js";
import { memoryStore } from "../lib/store-memory.js";
import { tally, rank, modelStats, parseQuestion, parseAuthor, threadComments } from "../lib/core.js";

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
  const s = modelStats([
    { question_id: "1", kind: "human", vote: "yes", n: 2 }, { question_id: "1", kind: "agent", model: "m", vote: "yes", n: 1 },
    { question_id: "2", kind: "human", vote: "no", n: 1 }, { question_id: "2", kind: "agent", model: "m", vote: "yes", n: 1 },
  ]);
  assert.equal(s[0].agrees_with_humans_pct, 50);
  assert.equal(parseQuestion({ title: "  Is it   ethical to nap at work " }).title, "Is it ethical to nap at work?");
  assert.equal(parseAuthor({ name: "  Ana " }).name, "Ana");
  assert.equal(threadComments([{ id: "x", parent_id: "gone", score: 0, created_at: "2026" }]).length, 1);
});
