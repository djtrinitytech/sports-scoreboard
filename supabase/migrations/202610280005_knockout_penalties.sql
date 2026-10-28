-- Knockout regulation draws are settled with a decisive penalty score.
alter table public.matches
  add column if not exists home_penalty_score integer not null default 0 check (home_penalty_score >= 0),
  add column if not exists away_penalty_score integer not null default 0 check (away_penalty_score >= 0);

create or replace function public.set_knockout_penalties_server(
  p_match_id uuid, p_expected_version bigint, p_home_penalty_score integer, p_away_penalty_score integer, p_actor_role text
) returns public.matches language plpgsql security definer set search_path = ''
as $$
declare current_match public.matches; changed public.matches;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_actor_role not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_home_penalty_score is null or p_away_penalty_score is null or p_home_penalty_score < 0 or p_away_penalty_score < 0 then
    raise exception 'Penalty scores must be non-negative whole numbers';
  end if;
  select * into current_match from public.matches where id=p_match_id for update;
  if current_match.id is null then raise exception 'Match not found'; end if;
  if current_match.version <> p_expected_version then raise exception 'Version conflict: refresh the match'; end if;
  if current_match.stage not in ('quarterfinal','semifinal','final','third_place') then raise exception 'Penalty scores are only available for knockout matches'; end if;
  if current_match.status <> 'final' or current_match.home_score <> current_match.away_score then raise exception 'End regulation time in a tied knockout match before entering penalties'; end if;
  update public.matches set home_penalty_score=p_home_penalty_score, away_penalty_score=p_away_penalty_score,
    version=version+1, updated_at=now() where id=p_match_id returning * into changed;
  return changed;
end $$;
revoke all on function public.set_knockout_penalties_server(uuid,bigint,integer,integer,text) from public,anon,authenticated;
grant execute on function public.set_knockout_penalties_server(uuid,bigint,integer,integer,text) to service_role;

-- Redefine advancement so regulation score wins first, then penalties break a tie.
create or replace function public.refresh_knockout_bracket()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  qualifiers jsonb;
  fixture_row public.knockout_fixtures;
  source_row public.knockout_fixtures;
  source_match public.matches;
  linked_match public.matches;
  resolved_home text;
  resolved_away text;
  resolution_problem text;
  new_match_id uuid;
  source_kind text;
  source_code text;
  home_won boolean;
begin
  with appearances as (
    select m.group_name, m.home_team as team, m.away_team as opponent,
      m.home_score as gf, m.away_score as ga,
      case when m.home_score > m.away_score then 3 when m.home_score = m.away_score then 1 else 0 end as points,
      coalesce(m.home_fair_play_score,0) as fair_play
    from public.matches m where m.stage = 'group' and m.status = 'final'
    union all
    select m.group_name, m.away_team, m.home_team, m.away_score, m.home_score,
      case when m.away_score > m.home_score then 3 when m.away_score = m.home_score then 1 else 0 end,
      coalesce(m.away_fair_play_score,0)
    from public.matches m where m.stage = 'group' and m.status = 'final'
  ), group_progress as (
    select group_name, count(*) as fixtures, count(*) filter (where status = 'final') as completed
    from public.matches where stage = 'group' and group_name is not null group by group_name
  ), stats as (
    select t.name, t.group_name,
      coalesce(sum(a.points),0)::bigint as points,
      coalesce(sum(a.gf),0)::bigint as goals_for,
      coalesce(sum(a.ga),0)::bigint as goals_against,
      coalesce(sum(a.fair_play),0)::bigint as fair_play
    from public.teams t left join appearances a on a.team=t.name and a.group_name=t.group_name
    where t.active and t.group_name in ('A','B','C','D')
    group by t.name,t.group_name
  ), h2h as (
    select a.name,
      coalesce(sum(x.points),0)::bigint as h2h_points,
      coalesce(sum(x.gf-x.ga),0)::bigint as h2h_difference,
      coalesce(sum(x.gf),0)::bigint as h2h_goals
    from stats a left join appearances x on x.team=a.name and x.group_name=a.group_name
    left join stats b on b.name=x.opponent and b.group_name=a.group_name and b.points=a.points
    where x.team is null or b.name is not null
    group by a.name
  ), ranked as (
    select s.*, coalesce(h.h2h_points,0) as h2h_points,
      coalesce(h.h2h_difference,0) as h2h_difference, coalesce(h.h2h_goals,0) as h2h_goals,
      gp.fixtures, gp.completed,
      rank() over(partition by s.group_name order by s.points desc,
        coalesce(h.h2h_points,0) desc, coalesce(h.h2h_difference,0) desc,
        coalesce(h.h2h_goals,0) desc, s.goals_for-s.goals_against desc,
        s.goals_for desc, s.fair_play desc) as position
    from stats s left join h2h h on h.name=s.name
    left join group_progress gp on gp.group_name=s.group_name
  ), unique_qualifiers as (
    select r.*, count(*) over(partition by r.group_name,r.position) as tied
    from ranked r where r.fixtures >= 6 and r.completed=r.fixtures and r.position in (1,2)
  )
  select coalesce(jsonb_object_agg(group_name||':'||position,to_jsonb(name)),'{}'::jsonb)
  into qualifiers from unique_qualifiers where tied=1;

  for fixture_row in select * from public.knockout_fixtures order by
    case stage when 'quarterfinal' then 1 when 'semifinal' then 2 when 'final' then 3 else 4 end, code
    for update
  loop
    resolved_home := null; resolved_away := null; resolution_problem := null; new_match_id := fixture_row.match_id;
    foreach source_kind in array array['home','away'] loop
      if source_kind='home' then source_code := fixture_row.home_source; else source_code := fixture_row.away_source; end if;
      if split_part(source_code,':',1)='group' then
        if source_kind='home' then resolved_home := qualifiers ->> (split_part(source_code,':',2)||':'||split_part(source_code,':',3));
        else resolved_away := qualifiers ->> (split_part(source_code,':',2)||':'||split_part(source_code,':',3)); end if;
      else
        select * into source_row from public.knockout_fixtures where code=split_part(source_code,':',2);
        if source_row.match_id is not null then
          select * into source_match from public.matches where id=source_row.match_id;
          if source_match.status='final' then
            if source_match.home_score=source_match.away_score and source_match.home_penalty_score=source_match.away_penalty_score then
              resolution_problem := 'Regulation ended tied. Enter a decisive penalty score to advance.';
            else
              home_won := source_match.home_score > source_match.away_score or
                (source_match.home_score=source_match.away_score and source_match.home_penalty_score>source_match.away_penalty_score);
              if (split_part(source_code,':',1)='winner' and home_won)
                 or (split_part(source_code,':',1)='loser' and not home_won) then
                if source_kind='home' then resolved_home := source_match.home_team; else resolved_away := source_match.home_team; end if;
              else
                if source_kind='home' then resolved_home := source_match.away_team; else resolved_away := source_match.away_team; end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    end loop;

    if resolved_home is not null and resolved_home=resolved_away then resolution_problem := 'Both bracket slots resolved to the same team. Super Admin review required.'; end if;
    if new_match_id is not null and (resolved_home is null or resolved_away is null) and resolution_problem is null then
      resolution_problem := 'An earlier result was reopened or changed. Super Admin review required before this fixture can proceed.';
    end if;
    if resolved_home is not null and resolved_away is not null and resolution_problem is null then
      if new_match_id is null then
        insert into public.matches(home_team,away_team,starts_at,venue,event_day,kickoff_time,group_name,stage)
        values (resolved_home,resolved_away,null,fixture_row.venue,fixture_row.event_day,fixture_row.kickoff_time,null,fixture_row.stage)
        returning id into new_match_id;
      else
        select * into linked_match from public.matches where id=new_match_id for update;
        if linked_match.home_team is distinct from resolved_home or linked_match.away_team is distinct from resolved_away then
          if linked_match.status='upcoming' and linked_match.home_score=0 and linked_match.away_score=0 then
            update public.matches set home_team=resolved_home,away_team=resolved_away,version=version+1,updated_at=now() where id=new_match_id;
          else resolution_problem := 'Qualified teams changed after this fixture started. Super Admin review required.';
          end if;
        end if;
      end if;
    end if;
    update public.knockout_fixtures set
      home_team=case when new_match_id is null then resolved_home else (select home_team from public.matches where id=new_match_id) end,
      away_team=case when new_match_id is null then resolved_away else (select away_team from public.matches where id=new_match_id) end,
      match_id=new_match_id,resolution_error=resolution_problem,updated_at=now()
    where code=fixture_row.code;
  end loop;
end $$;

-- Re-run advancement whenever a final regulation or penalty score is corrected.
create or replace function public.on_match_result_refresh_knockout()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status='final' or old.status='final' then perform public.refresh_knockout_bracket(); end if;
  return new;
end $$;
drop trigger if exists matches_refresh_knockout on public.matches;
create trigger matches_refresh_knockout after update of status,home_score,away_score,home_penalty_score,away_penalty_score on public.matches
for each row execute function public.on_match_result_refresh_knockout();

select public.refresh_knockout_bracket();

select public.refresh_knockout_bracket();
