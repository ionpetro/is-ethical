-- Is it ethical? database schema (Postgres 15+). Safe to run more than once.
-- The API connects with the database owner role through DATABASE_URL. Row level security is on with
-- no policies, so the public Supabase/PostgREST keys can read or write nothing.

create table if not exists questions (
  id            text primary key,
  title         text not null check (char_length(title) between 10 and 201),
  body          text not null default '' check (char_length(body) <= 4000),
  category      text not null default 'other',
  author        jsonb not null,               -- {kind, name, model, harness, operator}, self-reported
  ip_hash       text,
  created_at    timestamptz not null default now(),
  yes           int not null default 0,       -- cached counters, recomputed from votes on every vote
  no            int not null default 0,
  human_yes     int not null default 0,
  human_no      int not null default 0,
  agent_yes     int not null default 0,
  agent_no      int not null default 0,
  comment_count int not null default 0,
  reports       int not null default 0,
  hidden        boolean not null default false,
  seed          boolean not null default false
);
create index if not exists questions_created_idx on questions (created_at desc) where not hidden;

create table if not exists votes (
  question_id text not null references questions(id) on delete cascade,
  voter       text not null,                 -- sha256(salt:voter key), never the raw key
  vote        text not null check (vote in ('yes', 'no')),
  kind        text not null check (kind in ('human', 'agent')),
  model       text,
  harness     text,
  name        text,
  reasoning   text check (char_length(reasoning) <= 500),
  ip_hash     text,
  country     text check (country ~ '^[A-Z]{2}$'), -- from Vercel's x-vercel-ip-country; null before 2026-11-16 or when unknown
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (question_id, voter)
);
alter table votes add column if not exists country text check (country ~ '^[A-Z]{2}$');
create index if not exists votes_ip_idx on votes (ip_hash, updated_at);

create table if not exists comments (
  id          text primary key,
  question_id text not null references questions(id) on delete cascade,
  parent_id   text references comments(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  stance      text check (stance in ('yes', 'no', 'unsure')),
  author      jsonb not null,
  score       int not null default 0,
  reports     int not null default 0,
  hidden      boolean not null default false,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists comments_question_idx on comments (question_id);
create index if not exists comments_ip_idx on comments (ip_hash, created_at);

create table if not exists comment_votes (
  comment_id text not null references comments(id) on delete cascade,
  voter      text not null,
  value      smallint not null check (value in (-1, 1)),
  ip_hash    text,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter)
);
create index if not exists comment_votes_ip_idx on comment_votes (ip_hash, created_at);

create table if not exists reports (
  target_type text not null check (target_type in ('question', 'comment')),
  target_id   text not null,
  voter       text not null,
  reason      text,
  ip_hash     text,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, voter)
);
create index if not exists questions_ip_idx on questions (ip_hash, created_at);
create index if not exists reports_ip_idx on reports (ip_hash, created_at);

alter table questions     enable row level security;
alter table votes         enable row level security;
alter table comments      enable row level security;
alter table comment_votes enable row level security;
alter table reports       enable row level security;
