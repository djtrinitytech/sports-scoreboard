-- Publish the official knockout bracket as TBD slots, then resolve it from final results.
create table if not exists public.knockout_fixtures (
  code text primary key check (code in ('Q1','Q2','Q3','Q4','S1','S2','F','3P')),
  stage text not null check (stage in ('quarterfinal','semifinal','final','third_place')),
  home_source text not null,
  away_source text not null,
  home_label text not null,
  away_label text not null,
  home_team text references public.teams(name),
  away_team text references public.teams(name),
  match_id uuid unique references public.matches(id) on delete set null,
  event_day smallint not null default 2,
  kickoff_time time not null,
  venue text not null,
  resolution_error text,
  updated_at timestamptz not null default now(),
  constraint knockout_different_teams check (home_team is null or away_team is null or home_team <> away_team)
);

alter table public.knockout_fixtures enable row level security;
revoke all on public.knockout_fixtures from public;
grant select on public.knockout_fixtures to anon, authenticated;
grant select, insert, update, delete on public.knockout_fixtures to service_role;
drop policy if exists "public can read knockout bracket" on public.knockout_fixtures;
create policy "public can read knockout bracket" on public.knockout_fixtures for select to anon, authenticated using (true);

insert into public.knockout_fixtures(code,stage,home_source,away_source,home_label,away_label,kickoff_time,venue) values
  ('Q1','quarterfinal','group:A:1','group:C:2','TBD · Group A 1st','TBD · Group C 2nd','11:00','Turf 1'),
  ('Q2','quarterfinal','group:B:1','group:D:2','TBD · Group B 1st','TBD · Group D 2nd','11:45','Turf 1'),
  ('Q3','quarterfinal','group:A:2','group:C:1','TBD · Group A 2nd','TBD · Group C 1st','11:00','Turf 2'),
  ('Q4','quarterfinal','group:B:2','group:D:1','TBD · Group B 2nd','TBD · Group D 1st','11:45','Turf 2'),
  ('S1','semifinal','winner:Q1','winner:Q3','TBD · Winner Q1','TBD · Winner Q3','12:40','Turf 1'),
  ('S2','semifinal','winner:Q2','winner:Q4','TBD · Winner Q2','TBD · Winner Q4','12:40','Turf 2'),
  ('F','final','winner:S1','winner:S2','TBD · Winner S1','TBD · Winner S2','13:35','Turf 1'),
  ('3P','third_place','loser:S1','loser:S2','TBD · Loser S1','TBD · Loser S2','13:35','Turf 2')
on conflict (code) do nothing;

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
    from ranked r
    where r.fixtures >= 6 and r.completed=r.fixtures and r.position in (1,2)
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
            if source_match.home_score=source_match.away_score then
              resolution_problem := 'A completed knockout match is tied. Super Admin must enter the penalty winner as a corrected score.';
            elsif (split_part(source_code,':',1)='winner' and source_match.home_score>source_match.away_score)
               or (split_part(source_code,':',1)='loser' and source_match.home_score<source_match.away_score) then
              if source_kind='home' then resolved_home := source_match.home_team; else resolved_away := source_match.home_team; end if;
            else
              if source_kind='home' then resolved_home := source_match.away_team; else resolved_away := source_match.away_team; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;

    if resolved_home is not null and resolved_home=resolved_away then
      resolution_problem := 'Both bracket slots resolved to the same team. Super Admin review required.';
    end if;
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
            update public.matches set home_team=resolved_home, away_team=resolved_away, version=version+1, updated_at=now() where id=new_match_id;
          else
            resolution_problem := 'Qualified teams changed after this fixture started. Super Admin review required.';
          end if;
        end if;
      end if;
    end if;

    update public.knockout_fixtures set
      home_team=case when new_match_id is null then resolved_home else (select home_team from public.matches where id=new_match_id) end,
      away_team=case when new_match_id is null then resolved_away else (select away_team from public.matches where id=new_match_id) end,
      match_id=new_match_id, resolution_error=resolution_problem, updated_at=now()
    where code=fixture_row.code;
  end loop;
end $$;

revoke all on function public.refresh_knockout_bracket() from public, anon, authenticated;
grant execute on function public.refresh_knockout_bracket() to service_role;

create or replace function public.on_match_result_refresh_knockout()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status='final' or old.status='final' then
    perform public.refresh_knockout_bracket();
  end if;
  return new;
end $$;
drop trigger if exists matches_refresh_knockout on public.matches;
create trigger matches_refresh_knockout after update of status,home_score,away_score on public.matches
for each row execute function public.on_match_result_refresh_knockout();

select public.refresh_knockout_bracket();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='knockout_fixtures') then
    alter publication supabase_realtime add table public.knockout_fixtures;
  end if;
end $$;
