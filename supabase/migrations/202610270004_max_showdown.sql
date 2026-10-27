-- Public visitors can read the Max Showdown leaderboard. Writes go through the
-- passcode-checked Vercel API, which uses the server-only Supabase secret key.
create table if not exists public.max_showdown_entries (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  participant_name text not null check (char_length(btrim(participant_name)) between 1 and 80),
  score integer not null check (score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists max_showdown_entries_score_idx
  on public.max_showdown_entries(score desc, created_at asc);

alter table public.max_showdown_entries enable row level security;
revoke all on public.max_showdown_entries from public, anon, authenticated;
grant select on public.max_showdown_entries to anon, authenticated;
grant select, insert, update, delete on public.max_showdown_entries to service_role;
drop policy if exists "public Max Showdown leaderboard read" on public.max_showdown_entries;
create policy "public Max Showdown leaderboard read"
  on public.max_showdown_entries for select to anon, authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'max_showdown_entries'
     ) then
    execute 'alter publication supabase_realtime add table public.max_showdown_entries';
  end if;
end $$;
