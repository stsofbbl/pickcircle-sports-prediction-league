begin;

-- matchMessage is transient UI state. Keep it out of the canonical result payload
-- so a loading message cannot survive reloads or app restarts.
create or replace function public.strip_koshien_match_message_from_results()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(coalesce(new.payload, '{}'::jsonb)) = 'object' then
    new.payload := coalesce(new.payload, '{}'::jsonb) - 'matchMessage';
  end if;
  return new;
end;
$$;

drop trigger if exists strip_koshien_match_message_from_results on public.results;
create trigger strip_koshien_match_message_from_results
before insert or update of payload on public.results
for each row execute function public.strip_koshien_match_message_from_results();

update public.results
set payload = payload - 'matchMessage',
    updated_at = now()
where payload ? 'matchMessage';

revoke all on function public.strip_koshien_match_message_from_results() from public, anon, authenticated;

commit;
