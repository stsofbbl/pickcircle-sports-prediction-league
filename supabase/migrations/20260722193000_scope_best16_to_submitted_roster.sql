begin;

do $migration$
declare
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(p.oid)
  into v_before
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prepare_koshien_best16_phases'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone';

  if v_before is null then
    raise exception 'prepare_koshien_best16_phases is required';
  end if;

  v_after := replace(
    v_before,
    'where p.league_id = v_league_id and p.profile_id is not null',
    'where p.league_id = v_league_id and p.profile_id is not null
      and (select count(*) from public.phase1_picks roster where roster.event_id = p_event_id and roster.player_id = p.id) = 8'
  );
  v_after := replace(
    v_after,
    'where p2.league_id = v_league_id and p2.profile_id is not null',
    'where p2.league_id = v_league_id and p2.profile_id is not null
          and (select count(*) from public.phase1_picks roster2 where roster2.event_id = p_event_id and roster2.player_id = p2.id) = 8'
  );

  if v_after = v_before then
    raise exception 'prepare_koshien_best16_phases roster predicates were not updated';
  end if;
  execute v_after;
end
$migration$;

notify pgrst, 'reload schema';
commit;
