-- The shared brain: one living document of notes per site that every agent reads before it
-- works and hands learnings back to afterwards, a log of every read, hand-in, merge and stale
-- mark, and benchmark runs that measure what the notes are worth.

create table public.site_notes (
  site text primary key,
  doc jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table public.brain_log (
  id bigserial primary key,
  site text not null,
  kind text not null check (kind in ('read', 'handin', 'merge', 'stale', 'heal', 'reset')),
  exploration_id text,
  summary text not null,
  detail jsonb,
  at timestamptz not null default now()
);
create index brain_log_site_idx on public.brain_log (site, at desc);
create index brain_log_at_idx on public.brain_log (at desc);

create table public.benchmarks (
  id text primary key,
  doc jsonb not null,
  site text not null,
  status text not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_notes enable row level security;
alter table public.brain_log enable row level security;
alter table public.benchmarks enable row level security;
create policy "read site_notes" on public.site_notes for select to anon, authenticated using (true);
create policy "read brain_log" on public.brain_log for select to anon, authenticated using (true);
create policy "read benchmarks" on public.benchmarks for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.site_notes, public.brain_log, public.benchmarks;
alter table public.site_notes replica identity full;
alter table public.brain_log replica identity full;
alter table public.benchmarks replica identity full;
