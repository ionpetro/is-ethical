// Postgres store (Supabase, Neon or any Postgres). Same async interface as store-memory.js.
import postgres from "postgres";

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const rowOut = (r) => (r ? { ...r, created_at: iso(r.created_at), ...(r.updated_at ? { updated_at: iso(r.updated_at) } : {}) } : null);

/** @param {string} url Postgres connection string (use the pooled/transaction URL on serverless) */
export function pgStore(url) {
  const sql = postgres(url, { max: 1, idle_timeout: 20, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require" });
  // Supabase's transaction pooler can stall when one connection pipelines several queries,
  // so queries run strictly one after another.
  let chain = Promise.resolve();
  const db = (...args) => { const p = chain.then(() => sql(...args)); chain = p.catch(() => {}); return p; };
  const tables = { question: ["questions", "created_at"], comment: ["comments", "created_at"], vote: ["votes", "updated_at"], comment_vote: ["comment_votes", "created_at"], report: ["reports", "created_at"] };

  return {
    kind: "postgres",
    sql,
    async insertQuestion(q) { await db`insert into questions ${sql(q)}`; },
    async getQuestion(id) { const [r] = await db`select * from questions where id = ${id}`; return rowOut(r); },
    async listQuestions({ category, limit = 1000 } = {}) {
      const rows = category
        ? await db`select * from questions where not hidden and category = ${category} order by created_at desc limit ${limit}`
        : await db`select * from questions where not hidden order by created_at desc limit ${limit}`;
      return rows.map(rowOut);
    },
    async patchQuestion(id, patch) { await db`update questions set ${sql(patch)} where id = ${id}`; },

    async upsertVote(v) {
      await db`insert into votes ${sql(v)}
        on conflict (question_id, voter) do update set vote = excluded.vote, kind = excluded.kind, model = excluded.model,
          harness = excluded.harness, name = excluded.name, reasoning = excluded.reasoning, ip_hash = excluded.ip_hash, updated_at = excluded.updated_at`;
    },
    async deleteVote(question_id, voter) { await db`delete from votes where question_id = ${question_id} and voter = ${voter}`; },
    async votesBy(ids, voter) {
      if (!ids.length) return {};
      const rows = await db`select question_id, vote from votes where voter = ${voter} and question_id in ${sql(ids)}`;
      return Object.fromEntries(rows.map((r) => [r.question_id, r.vote]));
    },
    async voteRows(question_id) {
      return db`select kind, model, vote, count(*)::int as n from votes where question_id = ${question_id} group by 1, 2, 3`;
    },
    async allVoteRows() {
      return db`select v.question_id, v.kind, v.model, v.vote, count(*)::int as n from votes v
        join questions q on q.id = v.question_id and not q.hidden group by 1, 2, 3, 4`;
    },
    async reasons(question_id, limit = 50) {
      const rows = await db`select vote, kind, model, harness, name, reasoning, updated_at from votes
        where question_id = ${question_id} and reasoning is not null order by updated_at desc limit ${limit}`;
      return rows.map((r) => ({ ...r, updated_at: iso(r.updated_at) }));
    },

    async insertComment(c) { await db`insert into comments ${sql(c)}`; },
    async getComment(id) { const [r] = await db`select * from comments where id = ${id}`; return rowOut(r); },
    async listComments(question_id) { return (await db`select * from comments where question_id = ${question_id} and not hidden`).map(rowOut); },
    async countComments(question_id) { const [r] = await db`select count(*)::int as n from comments where question_id = ${question_id} and not hidden`; return r.n; },
    async patchComment(id, patch) { await db`update comments set ${sql(patch)} where id = ${id}`; },

    async setCommentVote(comment_id, voter, value, ip_hash) {
      if (value) await db`insert into comment_votes (comment_id, voter, value, ip_hash) values (${comment_id}, ${voter}, ${value}, ${ip_hash})
        on conflict (comment_id, voter) do update set value = excluded.value, ip_hash = excluded.ip_hash, created_at = now()`;
      else await db`delete from comment_votes where comment_id = ${comment_id} and voter = ${voter}`;
      const [r] = await db`select coalesce(sum(value), 0)::int as s from comment_votes where comment_id = ${comment_id}`;
      return r.s;
    },
    async commentVotesBy(ids, voter) {
      if (!ids.length) return {};
      const rows = await db`select comment_id, value from comment_votes where voter = ${voter} and comment_id in ${sql(ids)}`;
      return Object.fromEntries(rows.map((r) => [r.comment_id, r.value]));
    },

    async insertReport(r) {
      const rows = await db`insert into reports ${sql(r)} on conflict do nothing returning 1`;
      return rows.length > 0;
    },
    async countReports(target_type, target_id) {
      const [r] = await db`select count(*)::int as n from reports where target_type = ${target_type} and target_id = ${target_id}`;
      return r.n;
    },
    async countRecent(kind, ip_hash, since) {
      const [table, field] = tables[kind];
      const [r] = await db`select count(*)::int as n from ${sql(table)} where ip_hash = ${ip_hash} and ${sql(field)} >= ${since}`;
      return r.n;
    },
    async counts() {
      const [r] = await db`select
        (select count(*) from questions where not hidden)::int as questions,
        (select count(*) from votes)::int as votes,
        (select count(*) from votes where kind = 'agent')::int as agent_votes,
        (select count(*) from comments where not hidden)::int as comments`;
      return r;
    },
  };
}
