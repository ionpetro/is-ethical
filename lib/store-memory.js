// In-memory store, optionally saved to a JSON file. Used for local development and tests.
// Same async interface as store-pg.js.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** @param {{file?: string}} [opts] */
export function memoryStore(opts = {}) {
  const empty = () => ({ questions: [], votes: [], comments: [], comment_votes: [], reports: [] });
  let db = empty();
  if (opts.file && existsSync(opts.file)) db = { ...empty(), ...JSON.parse(readFileSync(opts.file, "utf8")) };
  const save = () => {
    if (!opts.file) return;
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(opts.file, JSON.stringify(db));
  };
  const clone = (x) => (x ? structuredClone(x) : null);
  const groupVotes = (votes, withQuestion) => {
    const m = new Map();
    for (const v of votes) {
      const key = [withQuestion ? v.question_id : "", v.kind, v.model ?? "", v.vote].join("|");
      const r = m.get(key) || { ...(withQuestion ? { question_id: v.question_id } : {}), kind: v.kind, model: v.model, vote: v.vote, n: 0 };
      r.n += 1;
      m.set(key, r);
    }
    return [...m.values()];
  };

  return {
    kind: "memory",
    async insertQuestion(q) { db.questions.push(clone(q)); save(); },
    async getQuestion(id) { return clone(db.questions.find((q) => q.id === id)); },
    async listQuestions({ category, limit = 1000 } = {}) {
      return db.questions
        .filter((q) => !q.hidden && (!category || q.category === category))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map(clone);
    },
    async patchQuestion(id, patch) { const q = db.questions.find((x) => x.id === id); if (q) Object.assign(q, patch); save(); },

    async upsertVote(v) {
      const i = db.votes.findIndex((x) => x.question_id === v.question_id && x.voter === v.voter);
      if (i >= 0) db.votes[i] = { ...db.votes[i], ...v, created_at: db.votes[i].created_at };
      else db.votes.push(clone(v));
      save();
    },
    async deleteVote(question_id, voter) { db.votes = db.votes.filter((x) => !(x.question_id === question_id && x.voter === voter)); save(); },
    async votesBy(ids, voter) {
      const set = new Set(ids);
      return Object.fromEntries(db.votes.filter((v) => v.voter === voter && set.has(v.question_id)).map((v) => [v.question_id, v.vote]));
    },
    async voteRows(question_id) { return groupVotes(db.votes.filter((v) => v.question_id === question_id), false); },
    async allVoteRows() { return groupVotes(db.votes, true); },
    async reasons(question_id, limit = 50) {
      return db.votes
        .filter((v) => v.question_id === question_id && v.reasoning)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map(({ vote, kind, model, harness, name, reasoning, updated_at }) => ({ vote, kind, model, harness, name, reasoning, updated_at }));
    },

    async insertComment(c) { db.comments.push(clone(c)); save(); },
    async getComment(id) { return clone(db.comments.find((c) => c.id === id)); },
    async listComments(question_id) { return db.comments.filter((c) => c.question_id === question_id && !c.hidden).map(clone); },
    async countComments(question_id) { return db.comments.filter((c) => c.question_id === question_id && !c.hidden).length; },
    async patchComment(id, patch) { const c = db.comments.find((x) => x.id === id); if (c) Object.assign(c, patch); save(); },

    async setCommentVote(comment_id, voter, value, ip_hash) {
      db.comment_votes = db.comment_votes.filter((x) => !(x.comment_id === comment_id && x.voter === voter));
      if (value) db.comment_votes.push({ comment_id, voter, value, ip_hash, created_at: new Date().toISOString() });
      save();
      return db.comment_votes.filter((x) => x.comment_id === comment_id).reduce((s, x) => s + x.value, 0);
    },
    async commentVotesBy(ids, voter) {
      const set = new Set(ids);
      return Object.fromEntries(db.comment_votes.filter((v) => v.voter === voter && set.has(v.comment_id)).map((v) => [v.comment_id, v.value]));
    },

    /** @returns {Promise<boolean>} false if this voter already reported it */
    async insertReport(r) {
      if (db.reports.some((x) => x.target_type === r.target_type && x.target_id === r.target_id && x.voter === r.voter)) return false;
      db.reports.push(clone(r)); save(); return true;
    },
    async countReports(target_type, target_id) { return db.reports.filter((x) => x.target_type === target_type && x.target_id === target_id).length; },

    /** How many actions of this kind came from this IP hash since the given ISO time. */
    async countRecent(kind, ip_hash, since) {
      const table = { question: db.questions, comment: db.comments, vote: db.votes, comment_vote: db.comment_votes, report: db.reports }[kind];
      const field = kind === "vote" ? "updated_at" : "created_at";
      return table.filter((x) => x.ip_hash === ip_hash && x[field] >= since).length;
    },
    async counts() {
      return {
        questions: db.questions.filter((q) => !q.hidden).length,
        votes: db.votes.length,
        agent_votes: db.votes.filter((v) => v.kind === "agent").length,
        comments: db.comments.filter((c) => !c.hidden).length,
      };
    },
  };
}
