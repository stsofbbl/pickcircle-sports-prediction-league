-- ISOLATED 2026-11-20 pg_get_functiondef snapshot; never apply to production.
-- Reproduce real membership RPC bodies unchanged with minimal dependencies.
ALTER TABLE public.league_members ADD CONSTRAINT league_members_pkey PRIMARY KEY (league_id,user_id);
-- Real authenticated role has SELECT on membership; isolated fixture lacked it.
GRANT SELECT ON public.league_members TO authenticated;
CREATE TABLE public.league_join_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), league_id uuid NOT NULL,
 requester_id uuid NOT NULL,status text NOT NULL DEFAULT 'pending',
 reviewed_at timestamptz,reviewed_by uuid);
CREATE TABLE public.league_admin_audit(
 league_id uuid NOT NULL,target_user_id uuid NOT NULL,
 previous_role text NOT NULL,new_role text NOT NULL,changed_by uuid NOT NULL);
CREATE TABLE public.profiles(
 id uuid PRIMARY KEY,auth_user_id uuid,display_name text NOT NULL DEFAULT '',
 deleted_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Mirror live players_insert_self_member RLS: only the applicant can create
-- their own player identity after a manager has approved membership.
GRANT INSERT ON public.players TO authenticated;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY yoso_fixture_players_insert_self ON public.players
 FOR INSERT TO authenticated
 WITH CHECK (profile_id = auth.uid() AND public.is_league_member(league_id));
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

CREATE OR REPLACE FUNCTION public.review_club_join_request(p_request_id uuid, p_approve boolean)
 RETURNS TABLE(request_id uuid, request_status text, league_id uuid, requester_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_request public.league_join_requests;
begin
  select *
  into v_request
  from public.league_join_requests r
  where r.id = p_request_id
    and r.status = 'pending'
  for update;

  if v_request.id is null then
    raise exception 'pending join request not found' using errcode = 'P0002';
  end if;
  if not public.is_league_admin(v_request.league_id) then
    raise exception 'club admin permission is required' using errcode = '42501';
  end if;

  update public.league_join_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = v_user_id
  where id = v_request.id;

  if p_approve then
    insert into public.league_members (league_id, user_id, role, membership_status)
    values (v_request.league_id, v_request.requester_id, 'member', 'active')
    on conflict on constraint league_members_pkey do update
    set role = 'member',
        membership_status = 'active',
        joined_at = now();
  end if;

  return query
  select v_request.id,
         case when p_approve then 'approved' else 'rejected' end,
         v_request.league_id,
         v_request.requester_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_league_admin(p_league_id uuid, p_user_id uuid, p_make_admin boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_previous_role text;
  v_new_role text;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if not public.is_league_owner(p_league_id) then
    raise exception 'club owner permission is required' using errcode = '42501';
  end if;

  select lm.role
  into v_previous_role
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id
    and lm.membership_status = 'active'
  for update;

  if v_previous_role is null then
    raise exception 'active club member not found' using errcode = 'P0002';
  end if;
  if v_previous_role = 'owner' then
    raise exception 'club owner role cannot be changed' using errcode = '42501';
  end if;

  v_new_role := case when p_make_admin then 'co_owner' else 'member' end;
  if v_previous_role = v_new_role then
    return jsonb_build_object(
      'league_id', p_league_id,
      'user_id', p_user_id,
      'role', v_new_role,
      'changed', false
    );
  end if;

  update public.league_members
  set role = v_new_role
  where league_id = p_league_id
    and user_id = p_user_id;

  update public.players
  set is_admin = (v_new_role = 'co_owner'),
      updated_at = now()
  where league_id = p_league_id
    and profile_id = p_user_id;

  insert into public.league_admin_audit (
    league_id,
    target_user_id,
    previous_role,
    new_role,
    changed_by
  )
  values (
    p_league_id,
    p_user_id,
    v_previous_role,
    v_new_role,
    auth.uid()
  );

  return jsonb_build_object(
    'league_id', p_league_id,
    'user_id', p_user_id,
    'role', v_new_role,
    'changed', true
  );
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

REVOKE ALL ON FUNCTION public.is_league_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_league_owner(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.review_club_join_request(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_club_join_request(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.manage_league_admin(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_league_admin(uuid,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_club_member(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_club_member(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.archive_deleted_account() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prevent_owner_account_deletion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER prevent_owner_account_deletion BEFORE DELETE ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_account_deletion();
CREATE TRIGGER archive_deleted_account AFTER DELETE ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.archive_deleted_account();
