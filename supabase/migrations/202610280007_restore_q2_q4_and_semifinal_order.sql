-- Restore Q2/Q4 to the official Group B/D pairings, and apply the requested semi-finals.
update public.knockout_fixtures
set home_source='group:B:1', away_source='group:D:2',
    home_label='TBD · Group B 1st', away_label='TBD · Group D 2nd', updated_at=now()
where code='Q2';

update public.knockout_fixtures
set home_source='group:B:2', away_source='group:D:1',
    home_label='TBD · Group B 2nd', away_label='TBD · Group D 1st', updated_at=now()
where code='Q4';

update public.knockout_fixtures
set home_source='winner:Q1', away_source='winner:Q2',
    home_label='TBD · Winner Q1', away_label='TBD · Winner Q2', updated_at=now()
where code='S1';

update public.knockout_fixtures
set home_source='winner:Q3', away_source='winner:Q4',
    home_label='TBD · Winner Q3', away_label='TBD · Winner Q4', updated_at=now()
where code='S2';

select public.refresh_knockout_bracket();
