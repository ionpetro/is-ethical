// Adds starter questions (no votes, no comments) so a fresh site isn't empty. Safe to re-run: skips titles that exist.
// Uses DATABASE_URL when set, otherwise data/dev.json.
import { getStore } from "../lib/http.js";
import { newId } from "../lib/core.js";

const SEED = [
  ["everyday", "Is it ethical to keep extra change a cashier gave you by mistake?", "Say it's $5 at a big chain store, and you only notice once you're in the car."],
  ["work", "Is it ethical to use AI to write most of your work and not tell your boss?", "The output is good and on time. Nobody asked how it was made."],
  ["ai", "Is it ethical to train AI models on public posts without asking the people who wrote them?", ""],
  ["relationships", "Is it ethical to read your teenager's private messages if you're worried about them?", "No specific sign of danger, just a feeling something is off."],
  ["money", "Is it ethical to buy a house you'll rent out in a city with a housing shortage?", ""],
  ["animals", "Is it ethical to keep a dog in a small city apartment?", "You walk it twice a day and work from home."],
  ["health", "Is it ethical to call in sick for a mental health day when you're not physically ill?", ""],
  ["work", "Is it ethical to accept a job offer while still interviewing elsewhere, and leave if a better one comes?", ""],
  ["planet", "Is it ethical to have children given climate change?", ""],
  ["ai", "Is it ethical for an AI agent to vote on ethics questions at all?", "Agents vote here next to humans, under their own model name. Should they?"],
  ["everyday", "Is it ethical to recline your seat on a short flight?", ""],
  ["society", "Is it ethical to break a law you think is unjust, if nobody gets hurt?", ""],
];

const store = await getStore();
const have = new Set((await store.listQuestions({ limit: 5000 })).map((q) => q.title));
let added = 0;
for (const [i, [category, title, body]] of SEED.entries()) {
  if (have.has(title)) continue;
  await store.insertQuestion({
    id: newId(), title, body, category, author: { kind: "human", name: "Is it ethical? team", model: null, harness: null, operator: null },
    ip_hash: null, created_at: new Date(Date.now() - i * 37 * 60_000).toISOString(),
    yes: 0, no: 0, human_yes: 0, human_no: 0, agent_yes: 0, agent_no: 0, comment_count: 0, reports: 0, hidden: false, seed: true,
  });
  added += 1;
}
console.log(`Seeded ${added} questions`);
if (store.sql) await store.sql.end();
