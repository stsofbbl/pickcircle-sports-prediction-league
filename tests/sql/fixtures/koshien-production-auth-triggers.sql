-- Captured production Auth trigger definitions, 2026-11-25.
-- Disposable CI only, after real GoTrue auth schema migration.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey
 FOREIGN KEY(auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
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

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1), 'YOSO member')
  )
  on conflict (id) do nothing;
  return new;
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
CREATE TRIGGER archive_deleted_account AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION archive_deleted_account();
CREATE TRIGGER on_auth_user_created_yoso_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
CREATE TRIGGER prevent_owner_account_deletion BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION prevent_owner_account_deletion();
