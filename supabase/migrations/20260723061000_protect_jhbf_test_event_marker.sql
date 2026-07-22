-- Normal event saves replace events.rules. Preserve the test marker and fixed identity
-- so reset/delete RPCs remain safe after a result has been imported.

create or replace function public.protect_jhbf_import_test_event_marker()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_marker jsonb;
begin
  v_marker := coalesce(
    old.rules->'testHarness',
    old.rules->'config'->'testHarness',
    old.rules_config->'testHarness'
  );

  if old.name = '【TEST】高野連結果取込確認'
    and v_marker->>'kind' = 'jhbf_minimal_import'
    and old.id = 'jhbf-import-test-' || replace(old.league_id::text, '-', '') then
    new.name := old.name;
    new.league_id := old.league_id;
    new.preset_type := 'koshien';
    new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{testHarness}', v_marker, true);
    new.rules_config := jsonb_set(coalesce(new.rules_config, '{}'::jsonb), '{testHarness}', v_marker, true);
  end if;

  return new;
end;
$$;

drop trigger if exists protect_jhbf_import_test_event_marker on public.events;
create trigger protect_jhbf_import_test_event_marker
before update on public.events
for each row
execute function public.protect_jhbf_import_test_event_marker();

revoke all on function public.protect_jhbf_import_test_event_marker() from public, anon, authenticated;
