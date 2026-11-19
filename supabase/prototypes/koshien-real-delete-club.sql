-- ISOLATED ONLY: production pg_get_functiondef snapshot, not a migration.
CREATE OR REPLACE FUNCTION public.is_league_owner(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
      and lm.role = 'owner'
  );
$function$;
CREATE OR REPLACE FUNCTION public.delete_club(p_league_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if not public.is_league_owner(p_league_id) then
    raise exception 'club owner permission is required' using errcode = '42501';
  end if;

  select l.name into v_name
  from public.leagues l
  where l.id = p_league_id
    and l.created_by = auth.uid()
  for update;

  if v_name is null or btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'club name confirmation does not match' using errcode = '22023';
  end if;

  delete from public.leagues
  where id = p_league_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.delete_club(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_club(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.is_league_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_league_owner(uuid) TO authenticated;
