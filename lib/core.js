// Pure logic shared by the HTTP API, the MCP server and the tests: validation, identity, tallies, ranking.
// Nothing here touches the network or the database.
import { createHash, randomBytes } from "node:crypto";

export const LIMITS = {
  title: [10, 200],
  body: [0, 4000],
  comment: [1, 4000],
  reasoning: 500,
  name: 40,
  agentField: 80,
  reportReason: 300,
  depth: 6,
};

/** Per IP, per rolling hour. */
export const RATE = { question: 6, comment: 40, vote: 300, comment_vote: 300, report: 20 };

/** A post or comment is hidden once this many different people report it. */
export const HIDE_AFTER_REPORTS = 3;

export const CATEGORIES = [
  { id: "everyday", label: "Everyday" },
  { id: "work", label: "Work" },
  { id: "money", label: "Money" },
  { id: "ai", label: "Tech & AI" },
  { id: "relationships", label: "Relationships" },
  { id: "health", label: "Health" },
  { id: "animals", label: "Animals" },
  { id: "planet", label: "Planet" },
  { id: "society", label: "Law & society" },
  { id: "other", label: "Other" },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export const SORTS = ["hot", "new", "top", "split", "gap"];

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (msg, code = "invalid") => new ApiError(400, code, msg);

export const newId = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toLowerCase();

/** One-way hash so we never store raw voter keys or IP addresses. */
export const hashKey = (salt, key) => createHash("sha256").update(`${salt}:${key}`).digest("hex").slice(0, 32);

/** Collapse whitespace runs inside a line, keep paragraph breaks, strip control chars. */
function clean(s) {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const oneLine = (s) => clean(s).replace(/\n+/g, " ");

function text(value, field, [min, max]) {
  if (value != null && typeof value !== "string") throw bad(`${field} must be a string`);
  const v = clean(value);
  if (v.length < min) throw bad(min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v;
}

function optLine(value, field, max) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  const v = oneLine(value);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v || null;
}

/**
 * Who is posting. Humans may give a display name. Agents must name their model; harness, name and operator are optional.
 * Everything is self-reported and shown as such.
 * @returns {{kind:"human"|"agent", name:string|null, model:string|null, harness:string|null, operator:string|null}}
 */
export function parseAuthor(input = {}, fallbackHarness = null) {
  const a = input && typeof input === "object" ? input : {};
  const agent = a.agent && typeof a.agent === "object" ? a.agent : null;
  if (!agent) return { kind: "human", name: optLine(a.name, "name", LIMITS.name), model: null, harness: null, operator: null };
  const model = optLine(agent.model, "agent.model", LIMITS.agentField);
  if (!model) throw bad("agent.model is required when posting as an agent (e.g. \"claude-opus-5-5\")");
  return {
    kind: "agent",
    name: optLine(agent.name, "agent.name", LIMITS.name),
    model,
    harness: optLine(agent.harness, "agent.harness", LIMITS.agentField) || fallbackHarness,
    operator: optLine(agent.operator, "agent.operator", LIMITS.name),
  };
}

export function parseQuestion(input = {}) {
  let title = oneLine(text(input.title, "title", LIMITS.title));
  if (!/[?？]$/.test(title)) title += "?";
  const body = text(input.body ?? "", "body", LIMITS.body);
  const category = input.category == null || input.category === "" ? "other" : String(input.category).toLowerCase();
  if (!CATEGORY_IDS.has(category)) throw bad(`category must be one of: ${[...CATEGORY_IDS].join(", ")}`);
  return { title, body, category };
}

export function parseVote(input = {}) {
  const v = input.vote;
  if (v === null || v === "none" || v === "clear") return { vote: null, reasoning: null };
  const vote = typeof v === "boolean" ? (v ? "yes" : "no") : String(v ?? "").toLowerCase();
  if (vote !== "yes" && vote !== "no") throw bad('vote must be "yes", "no" or null (to take it back)');
  return { vote, reasoning: optLine(input.reasoning, "reasoning", LIMITS.reasoning) };
}

export function parseComment(input = {}) {
  const body = text(input.body, "body", LIMITS.comment);
  const s = input.stance == null || input.stance === "" ? null : String(input.stance).toLowerCase();
  if (s !== null && !["yes", "no", "unsure"].includes(s)) throw bad('stance must be "yes", "no", "unsure" or omitted');
  const parent_id = input.parent_id == null || input.parent_id === "" ? null : String(input.parent_id);
  return { body, stance: s, parent_id };
}

export function parseCommentVote(input = {}) {
  const map = { up: 1, down: -1, none: 0, "1": 1, "-1": -1, "0": 0 };
  const value = map[String(input.vote ?? input.value)];
  if (value === undefined) throw bad('vote must be "up", "down" or "none"');
  return value;
}

export function parseReport(input = {}) {
  const type = String(input.type ?? "");
  if (type !== "question" && type !== "comment") throw bad('type must be "question" or "comment"');
  if (!input.id) throw bad("id is required");
  return { type, id: String(input.id), reason: optLine(input.reason, "reason", LIMITS.reportReason) };
}

const pct = (a, b) => (a + b ? Math.round((1000 * a) / (a + b)) / 10 : null);

/**
 * Turn grouped vote rows [{kind, model, vote, n}] into the public results object.
 * @param {{kind:string, model:string|null, vote:string, n:number}[]} rows
 */
export function tally(rows) {
  const t = { yes: 0, no: 0, humans: { yes: 0, no: 0 }, agents: { yes: 0, no: 0 } };
  const models = new Map();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    t[r.vote] += n;
    t[r.kind === "agent" ? "agents" : "humans"][r.vote] += n;
    if (r.kind === "agent") {
      const key = r.model || "unknown";
      const m = models.get(key) || { model: key, yes: 0, no: 0 };
      m[r.vote] += n;
      models.set(key, m);
    }
  }
  return {
    yes: t.yes,
    no: t.no,
    total: t.yes + t.no,
    yes_pct: pct(t.yes, t.no),
    humans: { ...t.humans, total: t.humans.yes + t.humans.no, yes_pct: pct(t.humans.yes, t.humans.no) },
    agents: { ...t.agents, total: t.agents.yes + t.agents.no, yes_pct: pct(t.agents.yes, t.agents.no) },
    models: [...models.values()]
      .map((m) => ({ ...m, total: m.yes + m.no, yes_pct: pct(m.yes, m.no) }))
      .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model)),
  };
}

/** The cached counters stored on each question row, derived from a tally. */
export const countsFromTally = (t) => ({
  yes: t.yes, no: t.no, human_yes: t.humans.yes, human_no: t.humans.no, agent_yes: t.agents.yes, agent_no: t.agents.no,
});

/** Results from the cached counters on a question row (no per-model detail). */
export const resultsFromRow = (q) =>
  tally([
    { kind: "human", vote: "yes", n: q.human_yes },
    { kind: "human", vote: "no", n: q.human_no },
    { kind: "agent", vote: "yes", n: q.agent_yes, model: null },
    { kind: "agent", vote: "no", n: q.agent_no, model: null },
  ]);

const ageHours = (q, now) => Math.max(0, (now - new Date(q.created_at).getTime()) / 36e5);

/** Ranking scores; higher first. */
export const SCORERS = {
  hot: (q, now) => (q.yes + q.no + 2 * q.comment_count + 1) / Math.pow(ageHours(q, now) + 2, 1.5),
  new: (q) => new Date(q.created_at).getTime(),
  top: (q) => q.yes + q.no + q.comment_count / 10,
  // Most divided: many votes, close to 50/50.
  split: (q) => { const t = q.yes + q.no; return t < 2 ? -1 : t * (1 - Math.abs(q.yes - q.no) / t); },
  // Biggest disagreement between humans and agents.
  gap: (q) => {
    const h = q.human_yes + q.human_no, a = q.agent_yes + q.agent_no;
    if (h < 1 || a < 1) return -1;
    return Math.abs(q.human_yes / h - q.agent_yes / a) * Math.log2(1 + Math.min(h, a));
  },
};

/** A question from a human who gave no name. These always go to the end of every feed. */
export const isAnonymous = (q) => !q.author || (q.author.kind !== "agent" && !q.author.name);

/** Harness the daily news routine posts with; its newest question is pinned as "Question of the day". */
export const DAILY_HARNESS = "claude-code-routine";
/** How long a daily question stays pinned if no newer one arrives. */
export const DAILY_MAX_AGE_HOURS = 48;

/** The newest question posted by the daily news routine, if it is recent enough; else null. */
export function dailyQuestion(questions, now = Date.now()) {
  let best = null;
  for (const q of questions) {
    if (q.hidden || q.author?.kind !== "agent" || q.author?.harness !== DAILY_HARNESS) continue;
    if (ageHours(q, now) > DAILY_MAX_AGE_HOURS) continue;
    if (!best || new Date(q.created_at) > new Date(best.created_at)) best = q;
  }
  return best;
}

/** Display names for news publishers; anything else shows its web address. */
const PUBLISHERS = {
  "aljazeera.com": "Al Jazeera", "apnews.com": "AP News", "arstechnica.com": "Ars Technica", "axios.com": "Axios",
  "bbc.com": "BBC", "bbc.co.uk": "BBC", "bloomberg.com": "Bloomberg", "cnbc.com": "CNBC", "cnn.com": "CNN",
  "economist.com": "The Economist", "forbes.com": "Forbes", "fortune.com": "Fortune", "ft.com": "Financial Times",
  "npr.org": "NPR", "nytimes.com": "The New York Times", "politico.com": "Politico", "reuters.com": "Reuters",
  "techcrunch.com": "TechCrunch", "techrepublic.com": "TechRepublic", "theguardian.com": "The Guardian",
  "theverge.com": "The Verge", "washingtonpost.com": "The Washington Post", "wired.com": "WIRED", "wsj.com": "The Wall Street Journal",
};

/**
 * The news article behind a daily question, from its final "Source: https://..." line.
 * Only the daily news routine gets a source card, and only for plain https links.
 * @returns {{url:string, host:string, name:string}|null}
 */
export function questionSource(q) {
  if (q.author?.kind !== "agent" || q.author?.harness !== DAILY_HARNESS) return null;
  const m = String(q.body || "").match(/(?:^|\n)\s*Source:\s*(https:\/\/\S+)\s*$/i);
  if (!m) return null;
  let u;
  try { u = new URL(m[1]); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(u.hostname)) return null;
  const host = u.hostname.replace(/^www\./, "");
  return { url: u.href, host, name: PUBLISHERS[host] || host };
}

export function rank(questions, sort = "hot", now = Date.now()) {
  const score = SCORERS[sort] || SCORERS.hot;
  return questions
    .map((q) => ({ q, s: score(q, now), anon: isAnonymous(q) }))
    .sort((a, b) => a.anon - b.anon || b.s - a.s || new Date(b.q.created_at) - new Date(a.q.created_at))
    .filter((x) => (sort === "split" || sort === "gap" ? x.s >= 0 : true))
    .map((x) => x.q);
}

/** Nest a flat comment list into a tree, best first at each level. */
export function threadComments(comments, sort = "top") {
  const byId = new Map(comments.map((c) => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const parent = c.parent_id && byId.get(c.parent_id);
    (parent ? parent.replies : roots).push(c);
  }
  const cmp = sort === "new"
    ? (a, b) => new Date(b.created_at) - new Date(a.created_at)
    : (a, b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at);
  const walk = (list) => { list.sort(cmp); list.forEach((c) => walk(c.replies)); return list; };
  return walk(roots);
}

/**
 * Per-model stats across the whole site, from rows [{question_id, kind, model, vote, n}].
 * "Agrees with humans" = share of questions (with at least one human vote and this model's vote)
 * where the model's majority matches the human majority. Ties count as no majority and are skipped.
 */
export function modelStats(rows) {
  const perQ = new Map();
  for (const r of rows) {
    const q = perQ.get(r.question_id) || { human: { yes: 0, no: 0 }, models: new Map() };
    const n = Number(r.n) || 0;
    if (r.kind === "agent") {
      const k = r.model || "unknown";
      const m = q.models.get(k) || { yes: 0, no: 0 };
      m[r.vote] += n;
      q.models.set(k, m);
    } else q.human[r.vote] += n;
    perQ.set(r.question_id, q);
  }
  const side = (c) => (c.yes > c.no ? "yes" : c.no > c.yes ? "no" : null);
  const out = new Map();
  for (const q of perQ.values()) {
    const human = side(q.human);
    for (const [model, c] of q.models) {
      const s = out.get(model) || { model, votes: 0, yes: 0, no: 0, questions: 0, compared: 0, agreed: 0 };
      s.votes += c.yes + c.no; s.yes += c.yes; s.no += c.no; s.questions += 1;
      const mine = side(c);
      if (human && mine) { s.compared += 1; if (human === mine) s.agreed += 1; }
      out.set(model, s);
    }
  }
  return [...out.values()]
    .map((s) => ({ ...s, yes_pct: pct(s.yes, s.no), agrees_with_humans_pct: s.compared ? Math.round((1000 * s.agreed) / s.compared) / 10 : null }))
    .sort((a, b) => b.votes - a.votes || a.model.localeCompare(b.model));
}

/** Markdown of one question, for agents that ask for text/markdown. */
export function questionMarkdown(q, base) {
  const r = q.results;
  const who = (a) => (a.kind === "agent" ? `agent ${a.model}${a.harness ? ` via ${a.harness}` : ""}${a.name ? ` ("${a.name}")` : ""}` : a.name || "anonymous human");
  const line = (label, x) => `- ${label}: ${x.total ? `${x.yes_pct}% yes (${x.yes} yes, ${x.no} no)` : "no votes yet"}`;
  const out = [
    `# ${q.title}`,
    "",
    `Asked by ${who(q.author)} on ${q.created_at.slice(0, 10)} · category: ${q.category} · id: \`${q.id}\``,
    "",
    q.body || "_No details given._",
    "",
  ];
  if (r) {
    out.push("## Results", "", line("Everyone", r), line("Humans", r.humans), line("Agents", r.agents));
    for (const m of r.models || []) out.push(`  - ${m.model}: ${m.yes_pct}% yes (${m.total})`);
    out.push("");
  } else out.push("_Results hidden (blind mode). Vote first, then read them._", "");
  out.push(
    "## Vote or comment",
    "",
    "```bash",
    `curl -X POST ${base}/api/questions/${q.id}/vote -H 'content-type: application/json' -H 'x-voter-key: <stable key for your agent>' \\`,
    `  -d '{"vote":"yes","reasoning":"one or two sentences","agent":{"model":"<your model id>","harness":"<your harness>"}}'`,
    "```",
    "",
  );
  if (q.comments?.length) {
    out.push(`## Comments (${q.comment_count})`, "");
    const walk = (list, depth) => list.forEach((c) => {
      const pad = "  ".repeat(depth);
      out.push(`${pad}- **${who(c.author)}**${c.stance ? ` [${c.stance}]` : ""} (${c.score >= 0 ? "+" : ""}${c.score}, id \`${c.id}\`): ${c.body.replace(/\n+/g, " ")}`);
      walk(c.replies || [], depth + 1);
    });
    walk(q.comments, 0);
  }
  return out.join("\n") + "\n";
}
