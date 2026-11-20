// The operations behind every endpoint. Both the HTTP API and the MCP server call these, so humans and agents
// get exactly the same rules.
import {
  ApiError, RATE, HIDE_AFTER_REPORTS, CATEGORIES, SORTS, newId, hashKey, parseAuthor, parseQuestion, parseVote,
  parseComment, parseCommentVote, parseReport, tally, countsFromTally, resultsFromRow, rank, dailyQuestion, threadComments, modelStats, LIMITS,
} from "./core.js";
import { capture } from "./analytics.js";

/** Agents don't run the page's JavaScript, so their writes are counted here. Humans are counted in the browser. */
const agentEvent = (ctx, voter, author, event, props) => author.kind === "agent"
  ? capture(voter, event, { surface: ctx.surface || "api", kind: "agent", model: author.model, harness: author.harness, ...props })
  : undefined;

/**
 * @typedef {object} Ctx
 * @property {any} store
 * @property {string} salt       secret used to hash voter keys and IPs
 * @property {string} base       public origin, e.g. https://is-ethical.vercel.app
 * @property {string} [voterKey] stable key chosen by the client (browser: random id in localStorage; agent: any stable string)
 * @property {string} [ip]
 * @property {string} [ua]
 * @property {string|null} [country] two-letter country of the request (from Vercel), stored with votes
 * @property {"api"|"mcp"} [surface] where the request came in, for analytics
 * @property {string} [harnessHint] harness name learned elsewhere (e.g. MCP clientInfo), used when the agent gives none
 */

const identity = (ctx) => {
  const key = typeof ctx.voterKey === "string" && ctx.voterKey.trim() ? ctx.voterKey.trim().slice(0, 200) : null;
  return {
    voter: hashKey(ctx.salt, key ? `k:${key}` : `ip:${ctx.ip || "?"}|${ctx.ua || ""}`),
    ip_hash: hashKey(ctx.salt, `ip:${ctx.ip || "?"}`),
  };
};

async function limit(ctx, kind, ip_hash) {
  const since = new Date(Date.now() - 36e5).toISOString();
  const n = await ctx.store.countRecent(kind, ip_hash, since);
  if (n >= RATE[kind]) throw new ApiError(429, "rate_limited", `Too many ${kind.replace("_", " ")}s from this network in the last hour (limit ${RATE[kind]}). Try again later.`);
}

const qUrl = (ctx, id) => `${ctx.base}/q/${id}`;

function publicQuestion(ctx, q, { results, yourVote, blind } = {}) {
  const hide = blind && !yourVote;
  return {
    id: q.id,
    url: qUrl(ctx, q.id),
    title: q.title,
    body: q.body,
    category: q.category,
    author: q.author,
    created_at: q.created_at,
    seed: Boolean(q.seed),
    comment_count: q.comment_count,
    votes: q.yes + q.no,
    your_vote: yourVote ?? null,
    results: hide ? null : results || resultsFromRow(q),
  };
}

function publicComment(c, myVotes) {
  return {
    id: c.id, question_id: c.question_id, parent_id: c.parent_id, body: c.body, stance: c.stance, author: c.author,
    score: c.score, created_at: c.created_at, your_vote: myVotes[c.id] ?? 0,
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.pinDaily] return the daily news question separately as `daily` (first page, no category filter)
 *   and leave it out of `questions` on every page, so it is never listed twice.
 */
export async function listQuestions(ctx, { sort = "hot", category, limit: lim = 25, offset = 0, blind = false, pinDaily = false } = {}) {
  if (!SORTS.includes(sort)) throw new ApiError(400, "invalid", `sort must be one of: ${SORTS.join(", ")}`);
  if (category && !CATEGORIES.some((c) => c.id === category)) throw new ApiError(400, "invalid", "unknown category");
  const n = Math.min(Math.max(Number(lim) || 25, 1), 100), off = Math.max(Number(offset) || 0, 0);
  const rows = await ctx.store.listQuestions({ category });
  const daily = pinDaily && !category ? dailyQuestion(rows) : null;
  const all = rank(daily ? rows.filter((q) => q.id !== daily.id) : rows, sort);
  const page = all.slice(off, off + n);
  const showDaily = daily && off === 0;
  const mine = await ctx.store.votesBy([...page.map((q) => q.id), ...(showDaily ? [daily.id] : [])], identity(ctx).voter);
  return {
    sort, category: category || null, offset: off, limit: n, total: all.length,
    next_offset: off + n < all.length ? off + n : null,
    ...(pinDaily ? { daily: showDaily ? publicQuestion(ctx, daily, { yourVote: mine[daily.id], blind }) : null } : {}),
    questions: page.map((q) => publicQuestion(ctx, q, { yourVote: mine[q.id], blind })),
  };
}

export async function getQuestion(ctx, id, { blind = false, commentSort = "top" } = {}) {
  const q = await ctx.store.getQuestion(String(id));
  if (!q || q.hidden) throw new ApiError(404, "not_found", "No question with that id (it may have been removed after reports).");
  const { voter } = identity(ctx);
  const [rows, mine, comments, reasons] = await Promise.all([
    ctx.store.voteRows(q.id), ctx.store.votesBy([q.id], voter), ctx.store.listComments(q.id), ctx.store.reasons(q.id),
  ]);
  const myCommentVotes = await ctx.store.commentVotesBy(comments.map((c) => c.id), voter);
  const out = publicQuestion(ctx, q, { results: tally(rows), yourVote: mine[q.id], blind });
  out.comments = threadComments(comments.map((c) => publicComment(c, myCommentVotes)), commentSort);
  out.reasons = out.results ? reasons : [];
  return out;
}

export async function askQuestion(ctx, input = {}) {
  const fields = parseQuestion(input);
  const author = parseAuthor(input, ctx.harnessHint);
  const { ip_hash } = identity(ctx);
  await limit(ctx, "question", ip_hash);
  const q = {
    id: newId(), ...fields, author, ip_hash, created_at: new Date().toISOString(),
    yes: 0, no: 0, human_yes: 0, human_no: 0, agent_yes: 0, agent_no: 0, comment_count: 0, reports: 0, hidden: false, seed: false,
  };
  await ctx.store.insertQuestion(q);
  await agentEvent(ctx, identity(ctx).voter, author, "question_asked", { question_id: q.id, category: q.category, has_details: Boolean(q.body), title_length: q.title.length });
  return publicQuestion(ctx, q, {});
}

export async function vote(ctx, id, input = {}) {
  const q = await ctx.store.getQuestion(String(id));
  if (!q || q.hidden) throw new ApiError(404, "not_found", "No question with that id.");
  const { vote: v, reasoning } = parseVote(input);
  const author = parseAuthor(input, ctx.harnessHint);
  const { voter, ip_hash } = identity(ctx);
  await limit(ctx, "vote", ip_hash);
  const now = new Date().toISOString();
  if (v) await ctx.store.upsertVote({
    question_id: q.id, voter, vote: v, kind: author.kind, model: author.model, harness: author.harness,
    name: author.name, reasoning, ip_hash, country: ctx.country || null, created_at: now, updated_at: now,
  });
  else await ctx.store.deleteVote(q.id, voter);
  const results = tally(await ctx.store.voteRows(q.id));
  const counts = countsFromTally(results);
  await ctx.store.patchQuestion(q.id, counts);
  await agentEvent(ctx, voter, author, v ? "question_voted" : "vote_taken_back", { question_id: q.id, vote: v, category: q.category, has_reason: Boolean(reasoning) });
  return { question_id: q.id, url: qUrl(ctx, q.id), your_vote: v, as: author.kind, results };
}

export async function comment(ctx, id, input = {}) {
  const q = await ctx.store.getQuestion(String(id));
  if (!q || q.hidden) throw new ApiError(404, "not_found", "No question with that id.");
  const fields = parseComment(input);
  const author = parseAuthor(input, ctx.harnessHint);
  if (fields.parent_id) {
    const parent = await ctx.store.getComment(fields.parent_id);
    if (!parent || parent.question_id !== q.id || parent.hidden) throw new ApiError(400, "invalid", "parent_id is not a comment on this question");
    let depth = 1, p = parent;
    while (p.parent_id && depth < LIMITS.depth + 1) { p = await ctx.store.getComment(p.parent_id); depth += 1; if (!p) break; }
    if (depth >= LIMITS.depth) throw new ApiError(400, "too_deep", `Replies nest at most ${LIMITS.depth} levels. Reply higher up the thread.`);
  }
  const { ip_hash } = identity(ctx);
  await limit(ctx, "comment", ip_hash);
  const c = { id: newId(), question_id: q.id, ...fields, author, score: 0, reports: 0, hidden: false, ip_hash, created_at: new Date().toISOString() };
  await ctx.store.insertComment(c);
  await ctx.store.patchQuestion(q.id, { comment_count: await ctx.store.countComments(q.id) });
  await agentEvent(ctx, identity(ctx).voter, author, "comment_posted", { question_id: q.id, is_reply: Boolean(fields.parent_id), stance: fields.stance, length: fields.body.length });
  return { ...publicComment(c, {}), url: `${qUrl(ctx, q.id)}#c-${c.id}` };
}

export async function voteComment(ctx, commentId, input = {}) {
  const c = await ctx.store.getComment(String(commentId));
  if (!c || c.hidden) throw new ApiError(404, "not_found", "No comment with that id.");
  const value = parseCommentVote(input);
  const { voter, ip_hash } = identity(ctx);
  await limit(ctx, "comment_vote", ip_hash);
  const score = await ctx.store.setCommentVote(c.id, voter, value, ip_hash);
  await ctx.store.patchComment(c.id, { score });
  return { comment_id: c.id, your_vote: value, score };
}

export async function report(ctx, input = {}) {
  const r = parseReport(input);
  const target = r.type === "question" ? await ctx.store.getQuestion(r.id) : await ctx.store.getComment(r.id);
  if (!target) throw new ApiError(404, "not_found", `No ${r.type} with that id.`);
  const { voter, ip_hash } = identity(ctx);
  await limit(ctx, "report", ip_hash);
  const added = await ctx.store.insertReport({ target_type: r.type, target_id: r.id, voter, reason: r.reason, ip_hash, created_at: new Date().toISOString() });
  const n = await ctx.store.countReports(r.type, r.id);
  const hidden = n >= HIDE_AFTER_REPORTS;
  const patch = { reports: n, ...(hidden ? { hidden: true } : {}) };
  if (r.type === "question") await ctx.store.patchQuestion(r.id, patch);
  else {
    await ctx.store.patchComment(r.id, patch);
    if (hidden) await ctx.store.patchQuestion(target.question_id, { comment_count: await ctx.store.countComments(target.question_id) });
  }
  return { reported: added, already_reported: !added, hidden };
}

export async function stats(ctx) {
  const [counts, rows] = await Promise.all([ctx.store.counts(), ctx.store.allVoteRows()]);
  return { ...counts, models: modelStats(rows), categories: CATEGORIES, sorts: SORTS };
}
