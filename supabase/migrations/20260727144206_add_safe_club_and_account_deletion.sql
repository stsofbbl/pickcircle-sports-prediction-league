begin;

-- Keep the stable profile/player identity after Auth deletion so past YOSO,
-- scores, and rankings remain attributable to an anonymized participant.
alter table public.profiles
  add column if not exists auth_user_id uuid,
  add column if not exists deleted_at timestamptz;

update public.profiles p
set auth_user_id = p.id
where p.auth_user_id is null
  and p.deleted_at is null
  and exists (select 1 from auth.users u where u.id = p.id);

alter table public.profiles
  drop constraint if exists profiles_id_fkey,
  drop constraint if exists profiles_auth_user_id_fkey;

alter table public.profiles
  add constraint profiles_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;

create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, auth_user_id, display_name, deleted_at)
  values (
    new.id,
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), 'YOSO member'),
    null
  )
  on conflict (id) do update
  set auth_user_id = excluded.auth_user_id,
      display_name = case
        when public.profiles.deleted_at is null then public.profiles.display_name
        else excluded.display_name
      end,
      deleted_at = null,
      updated_at = now();
  return new;
end;
$$;

-- An owner must first delete the owned club. This prevents Auth deletion from
-- leaving a club without the single required owner.
create or replace function public.prevent_owner_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop trigger if exists prevent_owner_account_deletion on auth.users;
create trigger prevent_owner_account_deletion
before delete on auth.users
for each row execute function public.prevent_owner_account_deletion();

create or replace function public.archive_deleted_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop trigger if exists archive_deleted_account on auth.users;
create trigger archive_deleted_account
after delete on auth.users
for each row execute function public.archive_deleted_account();

-- Removal means loss of current club access, not erasure of historical YOSO.
create or replace function public.remove_club_member(
  p_league_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop policy if exists league_members_select_same_league on public.league_members;
create policy league_members_select_same_league on public.league_members
for select to authenticated
using (
  membership_status = 'active'
  and public.is_league_member(league_id)
);

-- Membership removal must pass through remove_club_member so historical rows
-- cannot be bypassed by a direct table delete.
drop policy if exists league_members_delete_admin on public.league_members;

drop policy if exists profiles_select_members on public.profiles;
create policy profiles_select_members on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.league_members mine
    join public.players historical
      on historical.league_id = mine.league_id
     and historical.profile_id = profiles.id
    where mine.user_id = (select auth.uid())
      and mine.membership_status = 'active'
  )
);

revoke all on function public.prevent_owner_account_deletion() from public, anon, authenticated;
revoke all on function public.archive_deleted_account() from public, anon, authenticated;
revoke all on function public.remove_club_member(uuid, uuid) from public, anon;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
