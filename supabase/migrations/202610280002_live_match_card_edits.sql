-- Admins can record/correct discipline and fair-play values at any match status.
create or replace function public.update_match_discipline_server(
  p_match_id uuid,
  p_expected_version bigint,
  p_home_yellow_cards integer,
  p_away_yellow_cards integer,
  p_home_red_cards integer,
  p_away_red_cards integer,
  p_home_fair_play_score integer,
  p_away_fair_play_score integer,
  p_actor_role text
) returns public.matches
language plpgsql security definer set search_path = ''
as $$
declare current_match public.matches; changed public.matches;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_actor_role not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_home_yellow_cards < 0 or p_away_yellow_cards < 0 or p_home_red_cards < 0 or p_away_red_cards < 0
     or p_home_fair_play_score is null or p_away_fair_play_score is null then raise exception 'Invalid card or fair-play values'; end if;
  select * into current_match from public.matches where id = p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  if p_expected_version is null or current_match.version <> p_expected_version then raise exception 'Version conflict: refresh the match before editing'; end if;
  update public.matches set home_yellow_cards=p_home_yellow_cards, away_yellow_cards=p_away_yellow_cards,
    home_red_cards=p_home_red_cards, away_red_cards=p_away_red_cards,
    home_fair_play_score=p_home_fair_play_score, away_fair_play_score=p_away_fair_play_score,
    version=version+1, updated_at=now()
  where id=p_match_id returning * into changed;
  return changed;
end $$;

revoke all on function public.update_match_discipline_server(uuid,bigint,integer,integer,integer,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.update_match_discipline_server(uuid,bigint,integer,integer,integer,integer,integer,integer,text) to service_role;
