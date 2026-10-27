-- Allow only the passcode-verified server path to set or correct all match values.
create or replace function public.update_match_super_admin(
  p_match_id uuid,
  p_expected_version bigint,
  p_home_team text,
  p_away_team text,
  p_home_score integer,
  p_away_score integer,
  p_status public.match_status,
  p_event_day smallint,
  p_kickoff_time time,
  p_venue text,
  p_stage text
) returns public.matches
language plpgsql security definer set search_path = ''
as $$
declare
  current_match public.matches;
  home_group text;
  away_group text;
  changed public.matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server authorization required';
  end if;
  select * into current_match from public.matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  if p_expected_version is null or p_expected_version <> current_match.version then
    raise exception 'Version conflict: refresh the match before editing';
  end if;
  if p_home_team is null or p_away_team is null or p_home_team = p_away_team then
    raise exception 'Choose two different teams';
  end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 then
    raise exception 'Scores must be whole numbers of zero or more';
  end if;
  if p_event_day is null or p_event_day < 1 or p_kickoff_time is null
     or nullif(trim(p_venue), '') is null or char_length(trim(p_venue)) > 120
     or nullif(trim(p_stage), '') is null or char_length(trim(p_stage)) > 40 then
    raise exception 'Invalid match details';
  end if;
  select group_name into home_group from public.teams where name = p_home_team and active;
  if not found then raise exception 'Home team is not active'; end if;
  select group_name into away_group from public.teams where name = p_away_team and active;
  if not found then raise exception 'Away team is not active'; end if;

  update public.matches set
    home_team = p_home_team,
    away_team = p_away_team,
    home_score = p_home_score,
    away_score = p_away_score,
    status = p_status,
    event_day = p_event_day,
    kickoff_time = p_kickoff_time,
    venue = trim(p_venue),
    stage = trim(p_stage),
    group_name = case when home_group = away_group then home_group else null end,
    version = version + 1,
    updated_at = now()
  where id = p_match_id returning * into changed;
  return changed;
end;
$$;

revoke all on function public.update_match_super_admin(uuid,bigint,text,text,integer,integer,public.match_status,smallint,time,text,text) from public, anon, authenticated;
grant execute on function public.update_match_super_admin(uuid,bigint,text,text,integer,integer,public.match_status,smallint,time,text,text) to service_role;
