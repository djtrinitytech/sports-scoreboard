-- Convert the original name/score leaderboard into registered panna competitors,
-- retain every previous entry and score, and add draft/live/final fixtures.
create sequence if not exists public.max_showdown_registration_seq;

create table if not exists public.max_showdown_players (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique default ('MS-' || lpad(nextval('public.max_showdown_registration_seq')::text, 4, '0')),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  college_name text check (college_name is null or char_length(btrim(college_name)) <= 120),
  phone_number text check (phone_number is null or char_length(btrim(phone_number)) between 5 and 30),
  legacy_name_key text unique,
  legacy_points integer not null default 0 check (legacy_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.max_showdown_legacy_entries (
  source_entry_id uuid primary key,
  player_id uuid not null references public.max_showdown_players(id),
  participant_name text not null,
  old_score integer not null,
  source_created_at timestamptz not null,
  preserved_at timestamptz not null default now()
);

-- Fold repeated spellings into one registered competitor and carry every old point forward.
with grouped as (
  select lower(btrim(participant_name)) as name_key,
         min(btrim(participant_name)) as display_name,
         sum(score)::integer as carried_points
  from public.max_showdown_entries
  group by lower(btrim(participant_name))
)
insert into public.max_showdown_players(full_name, legacy_name_key, legacy_points)
select g.display_name, g.name_key, g.carried_points
from grouped g
where not exists (select 1 from public.max_showdown_players p where p.legacy_name_key = g.name_key)
on conflict (legacy_name_key) do nothing;

insert into public.max_showdown_legacy_entries(source_entry_id, player_id, participant_name, old_score, source_created_at)
select e.id, p.id, e.participant_name, e.score, e.created_at
from public.max_showdown_entries e
join public.max_showdown_players p on p.legacy_name_key = lower(btrim(e.participant_name))
on conflict (source_entry_id) do nothing;

create table if not exists public.max_showdown_matches (
  id uuid primary key default gen_random_uuid(),
  player_one_id uuid not null references public.max_showdown_players(id),
  player_two_id uuid not null references public.max_showdown_players(id),
  status text not null default 'draft' check (status in ('draft', 'live', 'final')),
  player_one_points integer not null default 0 check (player_one_points >= 0),
  player_two_points integer not null default 0 check (player_two_points >= 0),
  player_one_goals integer not null default 0 check (player_one_goals >= 0),
  player_two_goals integer not null default 0 check (player_two_goals >= 0),
  player_one_pannas integer not null default 0 check (player_one_pannas >= 0),
  player_two_pannas integer not null default 0 check (player_two_pannas >= 0),
  version bigint not null default 1,
  created_by_role text not null default 'admin' check (created_by_role in ('admin','super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint max_showdown_different_players check (player_one_id <> player_two_id)
);
create index if not exists max_showdown_matches_status_created_idx on public.max_showdown_matches(status, created_at desc);
create index if not exists max_showdown_matches_players_idx on public.max_showdown_matches(player_one_id, player_two_id);

create table if not exists public.max_showdown_operations (
  operation_id uuid primary key,
  match_id uuid not null references public.max_showdown_matches(id) on delete cascade,
  actor_role text not null check (actor_role in ('admin','super_admin')),
  action_type text not null check (action_type in ('goal','panna')),
  player_id uuid not null references public.max_showdown_players(id),
  result_version bigint not null,
  created_at timestamptz not null default now()
);

alter table public.max_showdown_players enable row level security;
alter table public.max_showdown_legacy_entries enable row level security;
alter table public.max_showdown_matches enable row level security;
alter table public.max_showdown_operations enable row level security;
revoke all on public.max_showdown_players, public.max_showdown_legacy_entries, public.max_showdown_matches, public.max_showdown_operations from public, anon, authenticated;
grant select, insert, update, delete on public.max_showdown_players, public.max_showdown_legacy_entries, public.max_showdown_matches, public.max_showdown_operations to service_role;
revoke select on public.max_showdown_entries from anon, authenticated;
drop policy if exists "public Max Showdown leaderboard read" on public.max_showdown_entries;

create or replace function public.get_max_showdown_standings()
returns table (
  player_id uuid, registration_id text, full_name text, college_name text,
  played bigint, wins bigint, draws bigint, losses bigint,
  goals bigint, pannas bigint, legacy_points integer, scored_points bigint, tournament_points bigint
)
language sql stable security definer set search_path = ''
as $$
  with appearances as (
    select m.player_one_id as player_id, m.player_one_points as score, m.player_one_goals as goals,
           m.player_one_pannas as pannas, m.player_two_points as opponent_score
    from public.max_showdown_matches m where m.status = 'final'
    union all
    select m.player_two_id, m.player_two_points, m.player_two_goals, m.player_two_pannas, m.player_one_points
    from public.max_showdown_matches m where m.status = 'final'
  ), totals as (
    select a.player_id, count(*) as played,
      count(*) filter (where a.score > a.opponent_score) as wins,
      count(*) filter (where a.score = a.opponent_score) as draws,
      count(*) filter (where a.score < a.opponent_score) as losses,
      sum(a.goals)::bigint as goals, sum(a.pannas)::bigint as pannas,
      sum(a.score)::bigint as match_points,
      (count(*) filter (where a.score > a.opponent_score) * 2 + count(*) filter (where a.score = a.opponent_score))::bigint as tournament_points
    from appearances a group by a.player_id
  )
  select p.id, p.registration_id, p.full_name, p.college_name,
         coalesce(t.played, 0), coalesce(t.wins, 0), coalesce(t.draws, 0), coalesce(t.losses, 0),
         coalesce(t.goals, 0), coalesce(t.pannas, 0), p.legacy_points,
         coalesce(t.match_points, 0) + p.legacy_points, coalesce(t.tournament_points, 0)
  from public.max_showdown_players p left join totals t on t.player_id = p.id
  order by coalesce(t.tournament_points, 0) desc, coalesce(t.match_points, 0) + p.legacy_points desc,
           coalesce(t.wins, 0) desc, p.full_name asc
$$;
revoke all on function public.get_max_showdown_standings() from public;
grant execute on function public.get_max_showdown_standings() to anon, authenticated;

create or replace function public.register_max_showdown_player_server(p_full_name text, p_college_name text, p_phone_number text)
returns public.max_showdown_players
language plpgsql security definer set search_path = ''
as $$
declare created public.max_showdown_players;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if nullif(btrim(p_full_name), '') is null or char_length(btrim(p_full_name)) > 100 then raise exception 'Enter a full name up to 100 characters'; end if;
  if nullif(btrim(p_phone_number), '') is null or char_length(btrim(p_phone_number)) not between 5 and 30 then raise exception 'Enter a valid phone number'; end if;
  if p_college_name is not null and char_length(btrim(p_college_name)) > 120 then raise exception 'College name must be 120 characters or fewer'; end if;
  insert into public.max_showdown_players(full_name, college_name, phone_number)
  values (btrim(p_full_name), nullif(btrim(p_college_name), ''), btrim(p_phone_number)) returning * into created;
  return created;
end $$;

create or replace function public.correct_max_showdown_player_server(p_player_id uuid, p_full_name text, p_college_name text, p_phone_number text)
returns public.max_showdown_players
language plpgsql security definer set search_path = ''
as $$
declare changed public.max_showdown_players;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if nullif(btrim(p_full_name), '') is null or char_length(btrim(p_full_name)) > 100 then raise exception 'Enter a full name up to 100 characters'; end if;
  if nullif(btrim(p_phone_number), '') is null or char_length(btrim(p_phone_number)) not between 5 and 30 then raise exception 'Enter a valid phone number'; end if;
  if p_college_name is not null and char_length(btrim(p_college_name)) > 120 then raise exception 'College name must be 120 characters or fewer'; end if;
  update public.max_showdown_players set full_name=btrim(p_full_name), college_name=nullif(btrim(p_college_name), ''),
    phone_number=btrim(p_phone_number), updated_at=now()
  where id=p_player_id returning * into changed;
  if changed.id is null then raise exception 'Player not found'; end if;
  return changed;
end $$;

create or replace function public.create_max_showdown_match_server(p_player_one_id uuid, p_player_two_id uuid, p_actor_role text)
returns public.max_showdown_matches
language plpgsql security definer set search_path = ''
as $$
declare created public.max_showdown_matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_actor_role not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_player_one_id is null or p_player_two_id is null or p_player_one_id = p_player_two_id then raise exception 'Choose two different players'; end if;
  if not exists(select 1 from public.max_showdown_players where id = p_player_one_id) or not exists(select 1 from public.max_showdown_players where id = p_player_two_id) then raise exception 'Player not found'; end if;
  insert into public.max_showdown_matches(player_one_id, player_two_id, created_by_role)
  values (p_player_one_id, p_player_two_id, p_actor_role) returning * into created;
  return created;
end $$;

create or replace function public.set_max_showdown_match_status_server(p_match_id uuid, p_expected_version bigint, p_status text)
returns public.max_showdown_matches
language plpgsql security definer set search_path = ''
as $$
declare current_match public.max_showdown_matches; changed public.max_showdown_matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  select * into current_match from public.max_showdown_matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  if current_match.version <> p_expected_version then raise exception 'Version conflict: refresh this match'; end if;
  if p_status = 'live' and current_match.status <> 'draft' then raise exception 'Only a draft can be started'; end if;
  if p_status = 'final' and current_match.status not in ('draft','live') then raise exception 'Match is already final'; end if;
  if p_status not in ('live','final') then raise exception 'Invalid match status'; end if;
  update public.max_showdown_matches set status = p_status, version = version + 1, updated_at = now()
  where id = p_match_id returning * into changed;
  return changed;
end $$;

create or replace function public.apply_max_showdown_score_server(p_operation_id uuid, p_match_id uuid, p_expected_version bigint, p_player_id uuid, p_action_type text, p_actor_role text)
returns public.max_showdown_matches
language plpgsql security definer set search_path = ''
as $$
declare current_match public.max_showdown_matches; changed public.max_showdown_matches; inserted_operation uuid; awarded integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_actor_role not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_operation_id is null or p_match_id is null or p_player_id is null or p_action_type not in ('goal','panna') then raise exception 'Invalid scoring action'; end if;
  if exists(select 1 from public.max_showdown_operations where operation_id = p_operation_id) then
    select m.* into current_match from public.max_showdown_operations o join public.max_showdown_matches m on m.id = o.match_id where o.operation_id = p_operation_id;
    if current_match.id is null or current_match.id <> p_match_id then raise exception 'Operation ID already used for another match'; end if;
    return current_match;
  end if;
  select * into current_match from public.max_showdown_matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  if current_match.version <> p_expected_version then raise exception 'Version conflict: refresh this match'; end if;
  if current_match.status <> 'live' then raise exception 'Only live matches can be scored'; end if;
  awarded := case when p_action_type = 'goal' then 1 else 2 end;
  if p_player_id = current_match.player_one_id then
    update public.max_showdown_matches set
      player_one_points = player_one_points + awarded,
      player_one_goals = player_one_goals + case when p_action_type = 'goal' then 1 else 0 end,
      player_one_pannas = player_one_pannas + case when p_action_type = 'panna' then 1 else 0 end,
      status = case when player_one_points + awarded >= 3 or player_two_points >= 3 then 'final' else status end,
      version = version + 1, updated_at = now()
    where id = p_match_id returning * into changed;
  elsif p_player_id = current_match.player_two_id then
    update public.max_showdown_matches set
      player_two_points = player_two_points + awarded,
      player_two_goals = player_two_goals + case when p_action_type = 'goal' then 1 else 0 end,
      player_two_pannas = player_two_pannas + case when p_action_type = 'panna' then 1 else 0 end,
      status = case when player_two_points + awarded >= 3 or player_one_points >= 3 then 'final' else status end,
      version = version + 1, updated_at = now()
    where id = p_match_id returning * into changed;
  else raise exception 'Player is not part of this match'; end if;
  insert into public.max_showdown_operations(operation_id, match_id, actor_role, action_type, player_id, result_version)
  values (p_operation_id, p_match_id, p_actor_role, p_action_type, p_player_id, changed.version)
  on conflict (operation_id) do nothing returning operation_id into inserted_operation;
  if inserted_operation is null then raise exception 'Duplicate operation'; end if;
  return changed;
end $$;

create or replace function public.correct_max_showdown_match_server(p_match_id uuid, p_expected_version bigint, p_one_points integer, p_two_points integer, p_one_goals integer, p_two_goals integer, p_one_pannas integer, p_two_pannas integer, p_status text)
returns public.max_showdown_matches
language plpgsql security definer set search_path = ''
as $$
declare changed public.max_showdown_matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_one_points < 0 or p_two_points < 0 or p_one_goals < 0 or p_two_goals < 0 or p_one_pannas < 0 or p_two_pannas < 0 or p_status not in ('draft','live','final') then raise exception 'Invalid match correction'; end if;
  select * into changed from public.max_showdown_matches where id = p_match_id for update;
  if changed.id is null then raise exception 'Match not found'; end if;
  if changed.version <> p_expected_version then raise exception 'Version conflict: refresh this match'; end if;
  update public.max_showdown_matches set player_one_points=p_one_points, player_two_points=p_two_points,
    player_one_goals=p_one_goals, player_two_goals=p_two_goals, player_one_pannas=p_one_pannas, player_two_pannas=p_two_pannas,
    status=p_status, version=version+1, updated_at=now()
  where id=p_match_id returning * into changed;
  return changed;
end $$;

revoke all on function public.register_max_showdown_player_server(text,text,text) from public, anon, authenticated;
revoke all on function public.correct_max_showdown_player_server(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.create_max_showdown_match_server(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.set_max_showdown_match_status_server(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.apply_max_showdown_score_server(uuid,uuid,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.correct_max_showdown_match_server(uuid,bigint,integer,integer,integer,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.register_max_showdown_player_server(text,text,text) to service_role;
grant execute on function public.correct_max_showdown_player_server(uuid,text,text,text) to service_role;
grant execute on function public.create_max_showdown_match_server(uuid,uuid,text) to service_role;
grant execute on function public.set_max_showdown_match_status_server(uuid,bigint,text) to service_role;
grant execute on function public.apply_max_showdown_score_server(uuid,uuid,bigint,uuid,text,text) to service_role;
grant execute on function public.correct_max_showdown_match_server(uuid,bigint,integer,integer,integer,integer,integer,integer,text) to service_role;

create or replace function public.broadcast_max_showdown_standings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'max_showdown_matches' then
    if tg_op = 'INSERT' then return null; end if;
    if old.status <> 'final' and new.status <> 'final' then return null; end if;
  end if;
  perform realtime.send(payload := jsonb_build_object('updated', true), event := 'standings_changed', topic := 'max-showdown-standings', private := false);
  return null;
end $$;

drop trigger if exists max_showdown_players_broadcast on public.max_showdown_players;
create trigger max_showdown_players_broadcast after insert or update on public.max_showdown_players
for each row execute function public.broadcast_max_showdown_standings();
drop trigger if exists max_showdown_matches_broadcast on public.max_showdown_matches;
create trigger max_showdown_matches_broadcast after insert or update on public.max_showdown_matches
for each row execute function public.broadcast_max_showdown_standings();
