-- Official group-stage teams and fixtures transcribed from Schedule.pdf.
-- The source gives Day 1 / Day 2 and kickoff times, but no calendar dates.
alter table public.teams add column if not exists group_name text;
alter table public.teams add column if not exists active boolean not null default true;
alter table public.matches add column if not exists event_day smallint;
alter table public.matches add column if not exists kickoff_time time;
alter table public.matches add column if not exists group_name text;
alter table public.matches add column if not exists stage text not null default 'group';
alter table public.matches alter column starts_at drop not null;

insert into public.teams(name, short_name, color, group_name, active) values
 ('KPMSOL - Sharks','Sharks','#c4ddc9','A',true),
 ('Baghubai A - Solar','Solar','#e5cd9c','A',true),
 ('DJSCE A - Wolves','Wolves','#d3bce0','A',true),
 ('MPSTME - Onyx','Onyx','#c3d4df','A',true),
 ('Baghubai K - Aurel','Aurel','#edb5a8','B',true),
 ('TCET - Kairo','Kairo','#bfd5e6','B',true),
 ('DJSCE B - Zenith','Zenith','#d8dca9','B',true),
 ('NM - Nova','Nova','#d9c6b5','B',true),
 ('NMIMS CIS - Elara','Elara','#c5d8c0','C',true),
 ('VJTI - Raptor','Raptor','#e8c783','C',true),
 ('ATLAS - Orion','Orion','#cebfe3','C',true),
 ('SPCE - Sable','Sable','#efb6a7','C',true),
 ('NM Shirpur - Astra','Astra','#bad2e2','D',true),
 ('Thakur Sci - Zeno','Zeno','#daddaa','D',true),
 ('Mithibai - Valen','Valen','#e9c5a4','D',true),
 ('PDSE - Titan','Titan','#c3d9ca','D',true)
on conflict (name) do update set short_name = excluded.short_name, color = excluded.color, group_name = excluded.group_name, active = true;

-- Retain any old records that are already referenced, but keep non-official teams out of this board.
update public.teams set active = false where group_name is null;

create unique index if not exists matches_schedule_key on public.matches(home_team, away_team, event_day, kickoff_time, venue);

with schedule(event_day, kickoff_time, turf, home_short, away_short, group_name) as (values
 (1,'09:00'::time,'Turf 1','Sharks','Solar','A'),
 (1,'09:45'::time,'Turf 1','Wolves','Onyx','A'),
 (1,'11:15'::time,'Turf 1','Sharks','Wolves','A'),
 (1,'13:30'::time,'Turf 1','Solar','Wolves','A'),
 (2,'08:00'::time,'Turf 1','Sharks','Onyx','A'),
 (2,'09:30'::time,'Turf 1','Solar','Onyx','A'),
 (1,'10:30'::time,'Turf 1','Aurel','Nova','B'),
 (1,'12:00'::time,'Turf 1','Zenith','Nova','B'),
 (1,'12:45'::time,'Turf 1','Aurel','Kairo','B'),
 (1,'14:15'::time,'Turf 1','Kairo','Zenith','B'),
 (2,'08:45'::time,'Turf 1','Aurel','Zenith','B'),
 (2,'10:15'::time,'Turf 1','Kairo','Nova','B'),
 (1,'09:00'::time,'Turf 2','Elara','Raptor','C'),
 (1,'10:30'::time,'Turf 2','Elara','Orion','C'),
 (1,'12:00'::time,'Turf 2','Orion','Sable','C'),
 (1,'14:15'::time,'Turf 2','Raptor','Sable','C'),
 (2,'08:00'::time,'Turf 2','Elara','Sable','C'),
 (2,'08:45'::time,'Turf 2','Raptor','Orion','C'),
 (1,'09:45'::time,'Turf 2','Astra','Zeno','D'),
 (1,'11:15'::time,'Turf 2','Valen','Titan','D'),
 (1,'12:45'::time,'Turf 2','Astra','Titan','D'),
 (1,'13:30'::time,'Turf 2','Zeno','Valen','D'),
 (2,'09:30'::time,'Turf 2','Astra','Valen','D'),
 (2,'10:15'::time,'Turf 2','Zeno','Titan','D')
)
insert into public.matches(home_team, away_team, home_score, away_score, status, starts_at, venue, version, event_day, kickoff_time, group_name, stage)
select h.name, a.name, 0, 0, 'upcoming', null, s.turf, 1, s.event_day, s.kickoff_time, s.group_name, 'group'
from schedule s
join public.teams h on h.short_name = s.home_short and h.group_name = s.group_name
join public.teams a on a.short_name = s.away_short and a.group_name = s.group_name
on conflict (home_team, away_team, event_day, kickoff_time, venue) do nothing;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$ select coalesce((select p.role from public.profiles p where p.id = (select auth.uid())), 'public'::public.app_role) $$;

drop policy if exists "profiles readable by self or super admin" on public.profiles;
create policy "profiles readable by self or super admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.current_app_role()) = 'super_admin'::public.app_role);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.profiles(id, email, role) values (new.id, new.email, 'public')
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function public.handle_new_auth_user();
insert into public.profiles(id, email, role) select id, email, 'public' from auth.users on conflict (id) do update set email = excluded.email;

create or replace function public.create_match(p_home_team text, p_away_team text, p_event_day smallint, p_kickoff_time time, p_venue text)
returns public.matches language plpgsql security definer set search_path = ''
as $$
declare home_group text; away_group text; created public.matches;
begin
  if public.current_app_role() <> 'super_admin'::public.app_role then raise exception 'Super admin permission required'; end if;
  if p_event_day not in (1,2) then raise exception 'Group stage day must be 1 or 2'; end if;
  select group_name into home_group from public.teams where name = p_home_team and active;
  select group_name into away_group from public.teams where name = p_away_team and active;
  if home_group is null or away_group is null or home_group <> away_group then raise exception 'Choose two active teams from the same group'; end if;
  insert into public.matches(home_team, away_team, starts_at, venue, event_day, kickoff_time, group_name, stage)
  values (p_home_team, p_away_team, null, p_venue, p_event_day, p_kickoff_time, home_group, 'group')
  returning * into created;
  return created;
end $$;

create or replace function public.apply_match_action(p_operation_id uuid, p_match_id uuid, p_action_type text, p_payload jsonb)
returns public.matches language plpgsql security definer set search_path = ''
as $$
declare actor uuid := auth.uid(); role_name public.app_role; current_match public.matches; requested_team text; requested_status public.match_status; expected_version bigint; changed public.matches; inserted_operation uuid;
begin
  role_name := public.current_app_role();
  if actor is null then raise exception 'Authentication required'; end if;
  if role_name not in ('admin'::public.app_role, 'super_admin'::public.app_role) then raise exception 'Administrator permission required'; end if;
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
  if current_match.status = 'final' and role_name <> 'super_admin'::public.app_role then raise exception 'Only a super admin can correct a finalized match'; end if;
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
    if current_match.status = 'final' and requested_status <> 'live' then raise exception 'Match is already final'; end if;
    if current_match.status = 'final' and role_name <> 'super_admin'::public.app_role then raise exception 'Only a super admin can reopen a match'; end if;
    update public.matches set status = requested_status where id = p_match_id returning * into changed;
  end if;
  update public.matches set version = version + 1, updated_at = now() where id = p_match_id returning * into changed;
  insert into public.match_operations(operation_id, match_id, actor_id, action_type, payload, result_version)
  values (p_operation_id, p_match_id, actor, p_action_type, p_payload, changed.version) on conflict (operation_id) do nothing returning operation_id into inserted_operation;
  if inserted_operation is null then raise exception 'Duplicate operation'; end if;
  return changed;
end $$;

create or replace function public.list_access_profiles()
returns table(id uuid, email text, role public.app_role) language plpgsql security definer set search_path = ''
as $$ begin
  if public.current_app_role() <> 'super_admin'::public.app_role then raise exception 'Super admin permission required'; end if;
  return query select p.id, p.email, p.role from public.profiles p order by p.email;
end $$;

create or replace function public.set_profile_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = ''
as $$
declare remaining_super_admins integer;
begin
  if public.current_app_role() <> 'super_admin'::public.app_role then raise exception 'Super admin permission required'; end if;
  if p_role not in ('public'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role) then raise exception 'Invalid role'; end if;
  if exists(select 1 from public.profiles where id = p_user_id and role = 'super_admin') and p_role <> 'super_admin' then
    select count(*) into remaining_super_admins from public.profiles where role = 'super_admin';
    if remaining_super_admins <= 1 then raise exception 'Cannot remove the last super admin'; end if;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'Account not found'; end if;
end $$;

revoke all on function public.create_match(text,text,smallint,time,text) from public;
revoke all on function public.list_access_profiles() from public;
revoke all on function public.set_profile_role(uuid,public.app_role) from public;
grant execute on function public.create_match(text,text,smallint,time,text) to authenticated;
grant execute on function public.apply_match_action(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.list_access_profiles() to authenticated;
grant execute on function public.set_profile_role(uuid,public.app_role) to authenticated;

-- Promote the intended super admin after creating that user in Supabase Auth:
-- update public.profiles set role = 'super_admin' where email = 'owner@example.org';

do $$ begin
  execute 'alter publication supabase_realtime add table public.matches';
exception when duplicate_object then null;
when undefined_object then null;
end $$;
