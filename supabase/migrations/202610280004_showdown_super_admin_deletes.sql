-- Super Admin can correct carry-over points and remove a player or a whole fixture/history.
alter table public.max_showdown_legacy_entries
  drop constraint if exists max_showdown_legacy_entries_player_id_fkey;
alter table public.max_showdown_legacy_entries
  add constraint max_showdown_legacy_entries_player_id_fkey foreign key (player_id)
  references public.max_showdown_players(id) on delete cascade;
alter table public.max_showdown_matches
  drop constraint if exists max_showdown_matches_player_one_id_fkey;
alter table public.max_showdown_matches
  add constraint max_showdown_matches_player_one_id_fkey foreign key (player_one_id)
  references public.max_showdown_players(id) on delete cascade;
alter table public.max_showdown_matches
  drop constraint if exists max_showdown_matches_player_two_id_fkey;
alter table public.max_showdown_matches
  add constraint max_showdown_matches_player_two_id_fkey foreign key (player_two_id)
  references public.max_showdown_players(id) on delete cascade;
alter table public.max_showdown_operations
  drop constraint if exists max_showdown_operations_player_id_fkey;
alter table public.max_showdown_operations
  add constraint max_showdown_operations_player_id_fkey foreign key (player_id)
  references public.max_showdown_players(id) on delete cascade;

drop function if exists public.correct_max_showdown_player_server(uuid,text,text,text);
create or replace function public.correct_max_showdown_player_server(p_player_id uuid, p_full_name text, p_college_name text, p_phone_number text, p_legacy_points integer)
returns public.max_showdown_players language plpgsql security definer set search_path = ''
as $$
declare changed public.max_showdown_players;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if nullif(btrim(p_full_name),'') is null or char_length(btrim(p_full_name)) > 100 then raise exception 'Enter a valid full name'; end if;
  if p_college_name is not null and char_length(btrim(p_college_name)) > 120 then raise exception 'College name must be 120 characters or fewer'; end if;
  if nullif(btrim(p_phone_number),'') is null or char_length(btrim(p_phone_number)) not between 5 and 30 then raise exception 'Enter a valid phone number'; end if;
  if p_legacy_points is null or p_legacy_points < 0 then raise exception 'Carry-over score must be a non-negative whole number'; end if;
  update public.max_showdown_players set full_name=btrim(p_full_name), college_name=nullif(btrim(p_college_name),''),
    phone_number=btrim(p_phone_number), legacy_points=p_legacy_points, updated_at=now()
  where id=p_player_id returning * into changed;
  if changed.id is null then raise exception 'Player not found'; end if;
  return changed;
end $$;

create or replace function public.delete_max_showdown_player_server(p_player_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  delete from public.max_showdown_players where id=p_player_id;
  if not found then raise exception 'Player not found'; end if;
  return p_player_id;
end $$;

create or replace function public.delete_max_showdown_match_server(p_match_id uuid, p_expected_version bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare current_version bigint;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  select version into current_version from public.max_showdown_matches where id=p_match_id for update;
  if current_version is null then raise exception 'Match not found'; end if;
  if current_version <> p_expected_version then raise exception 'Version conflict: refresh this match'; end if;
  delete from public.max_showdown_matches where id=p_match_id;
  return p_match_id;
end $$;

revoke all on function public.correct_max_showdown_player_server(uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.delete_max_showdown_player_server(uuid) from public,anon,authenticated;
revoke all on function public.delete_max_showdown_match_server(uuid,bigint) from public,anon,authenticated;
grant execute on function public.correct_max_showdown_player_server(uuid,text,text,text,integer) to service_role;
grant execute on function public.delete_max_showdown_player_server(uuid) to service_role;
grant execute on function public.delete_max_showdown_match_server(uuid,bigint) to service_role;

create or replace function public.broadcast_max_showdown_standings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='max_showdown_matches' then
    if tg_op='INSERT' then return null; end if;
    if tg_op='UPDATE' then
      if old.status <> 'final' and new.status <> 'final' then return null; end if;
    end if;
  end if;
  perform realtime.send(payload := jsonb_build_object('updated',true),event := 'standings_changed',topic := 'max-showdown-standings',private := false);
  return null;
end $$;
drop trigger if exists max_showdown_players_broadcast on public.max_showdown_players;
create trigger max_showdown_players_broadcast after insert or update or delete on public.max_showdown_players
for each row execute function public.broadcast_max_showdown_standings();
drop trigger if exists max_showdown_matches_broadcast on public.max_showdown_matches;
create trigger max_showdown_matches_broadcast after insert or update or delete on public.max_showdown_matches
for each row execute function public.broadcast_max_showdown_standings();
