-- Passcode-authorized server functions use the Supabase service role. The browser
-- does not receive direct database write privileges or either passcode.
alter table public.match_operations alter column actor_id drop not null;
alter table public.match_operations add column if not exists actor_role text;

create table if not exists public.admin_passcode_attempts (
  id bigint generated always as identity primary key,
  ip_digest text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists admin_passcode_attempts_recent_idx on public.admin_passcode_attempts(ip_digest, attempted_at desc);
alter table public.admin_passcode_attempts enable row level security;
revoke all on public.admin_passcode_attempts from public, anon, authenticated;
grant select, insert, delete on public.admin_passcode_attempts to service_role;
grant usage, select on sequence public.admin_passcode_attempts_id_seq to service_role;

create or replace function public.apply_match_action_server(
  p_operation_id uuid,
  p_match_id uuid,
  p_action_type text,
  p_payload jsonb,
  p_actor_role text
) returns public.matches
language plpgsql security definer set search_path = ''
as $$
declare current_match public.matches; requested_team text; requested_status public.match_status; expected_version bigint; changed public.matches; inserted_operation uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_actor_role not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_operation_id is null or p_match_id is null or p_action_type not in ('goal','undo','status') then raise exception 'Invalid match action'; end if;
  if exists (select 1 from public.match_operations o where o.operation_id = p_operation_id) then
    select m.* into current_match from public.match_operations o join public.matches m on m.id = o.match_id where o.operation_id = p_operation_id;
    if current_match.id is null or current_match.id <> p_match_id then raise exception 'Operation ID already used for another match'; end if;
    return current_match;
  end if;
  select * into current_match from public.matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  expected_version := (p_payload ->> 'expected_version')::bigint;
  if expected_version is null or expected_version <> current_match.version then raise exception 'Version conflict: refresh the match before editing'; end if;
  if current_match.status = 'final' and p_actor_role <> 'super_admin' then raise exception 'Only a super admin can correct a finalized match'; end if;
  if p_action_type in ('goal','undo') then
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
    if requested_status not in ('live','final') then raise exception 'Unsupported status change'; end if;
    if current_match.status = 'final' and p_actor_role <> 'super_admin' then raise exception 'Only a super admin can reopen a match'; end if;
    update public.matches set status = requested_status where id = p_match_id returning * into changed;
  end if;
  update public.matches set version = version + 1, updated_at = now() where id = p_match_id returning * into changed;
  insert into public.match_operations(operation_id, match_id, actor_id, action_type, payload, result_version, actor_role)
  values (p_operation_id, p_match_id, null, p_action_type, p_payload, changed.version, p_actor_role)
  on conflict (operation_id) do nothing returning operation_id into inserted_operation;
  if inserted_operation is null then raise exception 'Duplicate operation'; end if;
  return changed;
end $$;

create or replace function public.create_match_server(p_home_team text, p_away_team text, p_event_day smallint, p_kickoff_time time, p_venue text)
returns public.matches language plpgsql security definer set search_path = ''
as $$
declare home_group text; away_group text; created public.matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  select group_name into home_group from public.teams where name = p_home_team and active;
  select group_name into away_group from public.teams where name = p_away_team and active;
  if home_group is null or away_group is null or home_group <> away_group then raise exception 'Choose two active teams from the same group'; end if;
  if p_event_day not in (1,2) or p_kickoff_time is null or nullif(trim(p_venue),'') is null then raise exception 'Invalid fixture details'; end if;
  insert into public.matches(home_team, away_team, starts_at, venue, event_day, kickoff_time, group_name, stage)
  values (p_home_team, p_away_team, null, trim(p_venue), p_event_day, p_kickoff_time, home_group, 'group') returning * into created;
  return created;
end $$;

revoke all on function public.apply_match_action_server(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.create_match_server(text,text,smallint,time,text) from public, anon, authenticated;
grant execute on function public.apply_match_action_server(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.create_match_server(text,text,smallint,time,text) to service_role;
