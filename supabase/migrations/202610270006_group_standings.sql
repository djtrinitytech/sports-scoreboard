-- Store match discipline and fair-play scores used by the public group standings.
alter table public.matches
  add column if not exists home_yellow_cards integer not null default 0 check (home_yellow_cards >= 0),
  add column if not exists away_yellow_cards integer not null default 0 check (away_yellow_cards >= 0),
  add column if not exists home_red_cards integer not null default 0 check (home_red_cards >= 0),
  add column if not exists away_red_cards integer not null default 0 check (away_red_cards >= 0),
  add column if not exists home_fair_play_score integer not null default 0,
  add column if not exists away_fair_play_score integer not null default 0;

-- The existing server-only Super Admin correction path now includes discipline fields.
drop function if exists public.update_match_super_admin(uuid,bigint,text,text,integer,integer,public.match_status,smallint,time,text,text);

create or replace function public.update_match_super_admin(
  p_match_id uuid,
  p_expected_version bigint,
  p_home_team text,
  p_away_team text,
  p_home_score integer,
  p_away_score integer,
  p_home_yellow_cards integer,
  p_away_yellow_cards integer,
  p_home_red_cards integer,
  p_away_red_cards integer,
  p_home_fair_play_score integer,
  p_away_fair_play_score integer,
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
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0
     or p_home_yellow_cards is null or p_home_yellow_cards < 0 or p_away_yellow_cards is null or p_away_yellow_cards < 0
     or p_home_red_cards is null or p_home_red_cards < 0 or p_away_red_cards is null or p_away_red_cards < 0
     or p_home_fair_play_score is null or p_away_fair_play_score is null then
    raise exception 'Scores, cards, and fair-play points must be whole numbers in range';
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
    home_yellow_cards = p_home_yellow_cards,
    away_yellow_cards = p_away_yellow_cards,
    home_red_cards = p_home_red_cards,
    away_red_cards = p_away_red_cards,
    home_fair_play_score = p_home_fair_play_score,
    away_fair_play_score = p_away_fair_play_score,
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

revoke all on function public.update_match_super_admin(uuid,bigint,text,text,integer,integer,integer,integer,integer,integer,integer,integer,public.match_status,smallint,time,text,text) from public, anon, authenticated;
grant execute on function public.update_match_super_admin(uuid,bigint,text,text,integer,integer,integer,integer,integer,integer,integer,integer,public.match_status,smallint,time,text,text) to service_role;
