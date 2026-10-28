-- Swap the Q2 and Q4 bracket pairings while retaining each slot's time and turf.
update public.knockout_fixtures
set home_source = case code when 'Q2' then 'group:B:2' else 'group:B:1' end,
    away_source = case code when 'Q2' then 'group:D:1' else 'group:D:2' end,
    home_label = case code when 'Q2' then 'TBD · Group B 2nd' else 'TBD · Group B 1st' end,
    away_label = case code when 'Q2' then 'TBD · Group D 1st' else 'TBD · Group D 2nd' end,
    updated_at = now()
where code in ('Q2','Q4');

select public.refresh_knockout_bracket();
