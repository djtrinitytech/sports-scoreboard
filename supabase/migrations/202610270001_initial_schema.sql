-- Touchline initial schema. Run with `supabase db push` or paste into the SQL editor.
create extension if not exists pgcrypto;

create type public.app_role as enum ('public', 'admin', 'super_admin');
create type public.match_status as enum ('upcoming', 'live', 'final');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role public.app_role not null default 'public',
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text not null unique,
  color text not null default '#b9d8c3',
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  home_team text not null references public.teams(name),
  away_team text not null references public.teams(name),
  home_score integer not null default 0 check (home_score >= 0),
  away_score integer not null default 0 check (away_score >= 0),
  status public.match_status not null default 'upcoming',
  starts_at timestamptz not null,
  venue text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint different_teams check (home_team <> away_team)
);

create table public.match_operations (
  operation_id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action_type text not null check (action_type in ('goal', 'undo', 'status')),
  payload jsonb not null,
  result_version bigint not null,
  created_at timestamptz not null default now()
);

create index matches_starts_at_idx on public.matches(starts_at);
create index matches_status_starts_at_idx on public.matches(status, starts_at);

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_operations enable row level security;

create policy "profiles readable by self or super admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select role = 'super_admin' from public.profiles where id = (select auth.uid())));
create policy "public team directory read" on public.teams for select to anon, authenticated using (true);
create policy "public fixture and results read" on public.matches for select to anon, authenticated using (true);
-- Deliberately no client insert/update/delete policies: all mutations use the checked RPC below.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.teams from anon, authenticated;
revoke insert, update, delete on public.matches from anon, authenticated;
revoke all on public.match_operations from anon, authenticated;

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.role from public.profiles p where p.id = (select auth.uid())), 'public'::public.app_role) $$;

create or replace function public.apply_match_action(
  p_operation_id uuid,
  p_match_id uuid,
  p_action_type text,
  p_payload jsonb
) returns public.matches
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  role_name public.app_role;
  current_match public.matches;
  requested_team text;
  requested_status public.match_status;
  expected_version bigint;
  changed public.matches;
  inserted_operation uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select p.role into role_name from public.profiles p where p.id = actor;
  if role_name not in ('admin'::public.app_role, 'super_admin'::public.app_role) then raise exception 'Administrator permission required'; end if;
  if p_operation_id is null or p_match_id is null then raise exception 'Operation ID and match are required'; end if;
  if p_action_type not in ('goal', 'undo', 'status') then raise exception 'Unsupported action'; end if;
  -- A duplicate operation returns the recorded match state without applying the mutation again.
  if exists (select 1 from public.match_operations o where o.operation_id = p_operation_id) then
    select m.* into current_match from public.match_operations o join public.matches m on m.id = o.match_id where o.operation_id = p_operation_id;
    if current_match.id is null or current_match.id <> p_match_id then raise exception 'Operation ID already used for another match'; end if;
    return current_match;
  end if;
  select * into current_match from public.matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  expected_version := (p_payload ->> 'expected_version')::bigint;
  if expected_version is null or expected_version <> current_match.version then raise exception 'Version conflict: refresh the match and resolve the pending action'; end if;
  if current_match.status = 'final' then raise exception 'Finalized matches cannot be changed'; end if;
  if p_action_type in ('goal', 'undo') then
    requested_team := p_payload ->> 'team';
    if requested_team = current_match.home_team then
      if p_action_type = 'goal' then update public.matches set home_score = home_score + 1 where id = p_match_id returning * into changed;
      else if current_match.home_score = 0 then raise exception 'Score cannot go below zero'; end if; update public.matches set home_score = home_score - 1 where id = p_match_id returning * into changed; end if;
    elsif requested_team = current_match.away_team then
      if p_action_type = 'goal' then update public.matches set away_score = away_score + 1 where id = p_match_id returning * into changed;
      else if current_match.away_score = 0 then raise exception 'Score cannot go below zero'; end if; update public.matches set away_score = away_score - 1 where id = p_match_id returning * into changed; end if;
    else raise exception 'Team does not belong to this match'; end if;
  else
    requested_status := (p_payload ->> 'status')::public.match_status;
    if requested_status not in ('live', 'final') then raise exception 'Unsupported status change'; end if;
    update public.matches set status = requested_status where id = p_match_id returning * into changed;
  end if;
  update public.matches set version = version + 1, updated_at = now() where id = p_match_id returning * into changed;
  insert into public.match_operations(operation_id, match_id, actor_id, action_type, payload, result_version)
    values (p_operation_id, p_match_id, actor, p_action_type, p_payload, changed.version)
    on conflict (operation_id) do nothing returning operation_id into inserted_operation;
  if inserted_operation is null then raise exception 'Duplicate operation'; end if;
  return changed;
end $$;

revoke all on function public.apply_match_action(uuid, uuid, text, jsonb) from public;
grant execute on function public.apply_match_action(uuid, uuid, text, jsonb) to authenticated;

-- A profile is provisioned as public by default. Promote verified league staff using the SQL editor:
-- update public.profiles set role = 'admin' where email = 'staff@example.org';
-- update public.profiles set role = 'super_admin' where email = 'owner@example.org';

insert into public.teams(name, short_name, color) values
  ('Northside FC','NOR','#b9d8c3'), ('Riverside','RIV','#e7c991'), ('Old Town','OLD','#d7c2e8'),
  ('Eastfield','EAS','#f1b7a9'), ('Harbor Athletic','HAR','#bdd2e4'), ('Hillcrest','HIL','#d8dba5')
on conflict (name) do nothing;

-- Add public.matches to the Supabase Realtime publication from the dashboard (Database > Publications).
