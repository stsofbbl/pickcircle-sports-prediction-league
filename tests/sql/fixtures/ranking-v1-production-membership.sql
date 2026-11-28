-- Captured production function definitions, for synthetic fixture only.
CREATE OR REPLACE FUNCTION public.archive_deleted_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_anonymous_name text := '退会済みメンバー-' || left(old.id::text, 8);
begin
  update public.profiles
  set auth_user_id = null,
      display_name = v_anonymous_name,
      deleted_at = now(),
      updated_at = now()
  where id = old.id;

  update public.league_members
  set membership_status = 'removed',
      role = 'member'
  where user_id = old.id;

  update public.players
  set display_name = v_anonymous_name,
      is_admin = false,
      updated_at = now()
  where profile_id = old.id;

  return old;
end;
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

CREATE OR REPLACE FUNCTION public.prevent_owner_account_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1
    from public.league_members lm
    where lm.user_id = old.id
      and lm.role = 'owner'
      and lm.membership_status = 'active'
  ) then
    raise exception 'club owner must delete or transfer owned clubs before deleting the account'
      using errcode = '23503';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_club_member(p_league_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target_role text;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if not public.is_league_admin(p_league_id) then
    raise exception 'club admin permission is required' using errcode = '42501';
  end if;

  select lm.role
  into v_target_role
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id
    and lm.membership_status = 'active'
  for update;

  if v_target_role is null then
    raise exception 'active club member not found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' then
    raise exception 'club owner cannot be removed' using errcode = '42501';
  end if;
  if not public.is_league_owner(p_league_id) and v_target_role <> 'member' then
    raise exception 'co-owner can remove members only' using errcode = '42501';
  end if;

  update public.league_members
  set membership_status = 'removed',
      role = 'member'
  where league_id = p_league_id
    and user_id = p_user_id;

  update public.players
  set is_admin = false,
      updated_at = now()
  where league_id = p_league_id
    and profile_id = p_user_id;

  return jsonb_build_object(
    'league_id', p_league_id,
    'user_id', p_user_id,
    'removed', true,
    'history_preserved', true
  );
end;
$function$;
CREATE TRIGGER archive_deleted_account AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.archive_deleted_account();
CREATE TRIGGER prevent_owner_account_deletion BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_account_deletion();
-- Seed bindings for the historical fixture only, which was inserted before
-- prototype installation. Deliberately malformed/missing-player cases are
-- left to the existing negative finalization tests.
INSERT INTO ranking_v1_private.prediction_players
 SELECT p.event_id,p.user_id,e.league_id,pl.id
 FROM public.predictions p JOIN public.events e ON e.id=p.event_id
 JOIN public.players pl ON pl.league_id=e.league_id AND pl.profile_id=p.user_id
 WHERE e.preset_type='ranking_v1';
