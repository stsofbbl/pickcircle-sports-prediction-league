begin;

-- Existing clubs must have a single, active creator membership before their
-- legacy admin role can be safely split into CLUB Owner and Co-Owner.
do $$
begin
  if exists (
    select 1
    from public.leagues l
    left join public.league_members lm
      on lm.league_id = l.id
     and lm.user_id = l.created_by
    group by l.id
    having count(lm.user_id) <> 1
  ) then
    raise exception 'cannot migrate club roles: a league creator membership is missing or ambiguous'
      using errcode = '23514';
  end if;
end;
$$;

alter table public.league_members
  add column if not exists membership_status text not null default 'active'
  check (membership_status in ('active', 'removed'));

alter table public.league_members
  drop constraint if exists league_members_role_check;

-- The legacy trigger protects the last `admin`. It must not run while the
-- legacy role value is being replaced by the owner/co-owner model.
drop trigger if exists protect_last_league_admin on public.league_members;

update public.league_members lm
set role = 'owner'
from public.leagues l
where l.id = lm.league_id
  and lm.user_id = l.created_by;

update public.league_members
set role = 'co_owner'
where role = 'admin';

alter table public.league_members
  add constraint league_members_role_check
  check (role in ('owner', 'co_owner', 'member'));

create unique index if not exists league_members_one_active_owner_idx
  on public.league_members (league_id)
  where role = 'owner' and membership_status = 'active';

create index if not exists league_members_active_user_idx
  on public.league_members (user_id, league_id)
  where membership_status = 'active';

create table if not exists public.league_join_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  unique (league_id, requester_id)
);

create index if not exists league_join_requests_pending_review_idx
  on public.league_join_requests (league_id, requested_at)
  where status = 'pending';

alter table public.league_join_requests enable row level security;

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
  );
$$;

create or replace function public.is_league_admin(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
      and lm.role in ('owner', 'co_owner')
  );
$$;

create or replace function public.is_league_owner(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
      and lm.role = 'owner'
  );
$$;

drop policy if exists profiles_select_members on public.profiles;
create policy profiles_select_members on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.league_members mine
    join public.league_members peer on peer.league_id = mine.league_id
    where mine.user_id = (select auth.uid())
      and mine.membership_status = 'active'
      and peer.membership_status = 'active'
      and peer.user_id = profiles.id
  )
);

drop policy if exists league_members_select_same_league on public.league_members;
create policy league_members_select_same_league on public.league_members
for select to authenticated
using (public.is_league_member(league_id));

drop policy if exists league_members_insert_admin_or_creator on public.league_members;
create policy league_members_insert_admin_or_creator on public.league_members
for insert to authenticated
with check (
  public.is_league_admin(league_id)
  or (
    user_id = (select auth.uid())
    and role = 'owner'
    and membership_status = 'active'
    and exists (
      select 1
      from public.leagues l
      where l.id = league_id
        and l.created_by = (select auth.uid())
    )
  )
);

drop policy if exists league_join_requests_requester_select on public.league_join_requests;
create policy league_join_requests_requester_select on public.league_join_requests
for select to authenticated
using (
  requester_id = (select auth.uid())
  or public.is_league_admin(league_id)
);

revoke all on public.league_join_requests from anon, authenticated;

create or replace function public.create_club(p_name text)
returns table (
  league_id uuid,
  league_name text,
  invite_code text,
  membership_role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_league public.leagues;
  v_attempt integer := 0;
begin
  if v_user_id is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'club name must be between 1 and 80 characters' using errcode = '22023';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, coalesce(nullif(auth.jwt()->'user_metadata'->>'display_name', ''), split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), 'YOSO member'))
  on conflict (id) do nothing;

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 8 then
      raise exception 'could not generate a unique invite code' using errcode = '23505';
    end if;
    v_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

    begin
      insert into public.leagues (name, invite_code, created_by)
      values (v_name, v_code, v_user_id)
      returning * into v_league;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  insert into public.league_members (league_id, user_id, role, membership_status)
  values (v_league.id, v_user_id, 'owner', 'active');

  return query
  select v_league.id, v_league.name, v_league.invite_code, 'owner'::text;
end;
$$;

create or replace function public.search_clubs(p_query text)
returns table (
  league_id uuid,
  league_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    raise exception 'enter at least two characters' using errcode = '22023';
  end if;

  return query
  select l.id, l.name
  from public.leagues l
  where l.name ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  order by l.name
  limit 10;
end;
$$;

create or replace function public.lookup_club_invite(p_invite_code text)
returns table (
  league_id uuid,
  league_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_invite_code, '')));
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if char_length(v_code) < 6 or char_length(v_code) > 32 then
    raise exception 'invite code format is invalid' using errcode = '22023';
  end if;

  return query
  select l.id, l.name
  from public.leagues l
  where l.invite_code = v_code;
end;
$$;

create or replace function public.request_club_join(p_league_id uuid)
returns table (
  request_id uuid,
  request_status text,
  league_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.league_join_requests;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'login required' using errcode = '42501';
  end if;

  select l.name into v_name
  from public.leagues l
  where l.id = p_league_id;
  if v_name is null then
    raise exception 'club not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_user_id
      and lm.membership_status = 'active'
  ) then
    raise exception 'already a club member' using errcode = '23505';
  end if;

  insert into public.league_join_requests (league_id, requester_id)
  values (p_league_id, v_user_id)
  returning * into v_request;

  return query
  select v_request.id, v_request.status, v_name;
exception
  when unique_violation then
    raise exception 'join request is already pending' using errcode = '23505';
end;
$$;

create or replace function public.list_my_club_join_requests()
returns table (
  request_id uuid,
  league_id uuid,
  league_name text,
  request_status text,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, l.id, l.name, r.status, r.requested_at
  from public.league_join_requests r
  join public.leagues l on l.id = r.league_id
  where r.requester_id = (select auth.uid())
  order by r.requested_at desc;
$$;

create or replace function public.list_my_clubs()
returns table (
  league_id uuid,
  league_name text,
  membership_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, lm.role
  from public.league_members lm
  join public.leagues l on l.id = lm.league_id
  where lm.user_id = (select auth.uid())
    and lm.membership_status = 'active'
  order by l.name;
$$;

create or replace function public.list_pending_club_join_requests(p_league_id uuid)
returns table (
  request_id uuid,
  requester_id uuid,
  requester_display_name text,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'club admin permission is required' using errcode = '42501';
  end if;

  return query
  select r.id, r.requester_id, p.display_name, r.requested_at
  from public.league_join_requests r
  join public.profiles p on p.id = r.requester_id
  where r.league_id = p_league_id
    and r.status = 'pending'
  order by r.requested_at;
end;
$$;

create or replace function public.review_club_join_request(
  p_request_id uuid,
  p_approve boolean
)
returns table (
  request_id uuid,
  request_status text,
  league_id uuid,
  requester_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
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
    on conflict (league_id, user_id) do update
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
$$;

-- The old client must never be able to turn an invite code into an immediate
-- membership while a new release is rolling out.
create or replace function public.join_league_by_invite(p_invite_code text)
returns public.leagues
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'join via approval request is required' using errcode = '42501';
end;
$$;

update public.league_admin_audit
set previous_role = 'co_owner'
where previous_role = 'admin';

update public.league_admin_audit
set new_role = 'co_owner'
where new_role = 'admin';

alter table public.league_admin_audit
  drop constraint if exists league_admin_audit_previous_role_check,
  drop constraint if exists league_admin_audit_new_role_check;

alter table public.league_admin_audit
  add constraint league_admin_audit_previous_role_check
  check (previous_role in ('owner', 'co_owner', 'member')),
  add constraint league_admin_audit_new_role_check
  check (new_role in ('owner', 'co_owner', 'member'));

create or replace function public.manage_league_admin(
  p_league_id uuid,
  p_user_id uuid,
  p_make_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.is_league_member(uuid) from public, anon;
revoke all on function public.is_league_admin(uuid) from public, anon;
revoke all on function public.is_league_owner(uuid) from public, anon;
grant execute on function public.is_league_member(uuid) to authenticated;
grant execute on function public.is_league_admin(uuid) to authenticated;
grant execute on function public.is_league_owner(uuid) to authenticated;

revoke all on function public.create_club(text) from public, anon;
revoke all on function public.search_clubs(text) from public, anon;
revoke all on function public.lookup_club_invite(text) from public, anon;
revoke all on function public.request_club_join(uuid) from public, anon;
revoke all on function public.list_my_club_join_requests() from public, anon;
revoke all on function public.list_my_clubs() from public, anon;
revoke all on function public.list_pending_club_join_requests(uuid) from public, anon;
revoke all on function public.review_club_join_request(uuid, boolean) from public, anon;
revoke all on function public.manage_league_admin(uuid, uuid, boolean) from public, anon;
revoke all on function public.join_league_by_invite(text) from public, anon;

grant execute on function public.create_club(text) to authenticated;
grant execute on function public.search_clubs(text) to authenticated;
grant execute on function public.lookup_club_invite(text) to authenticated;
grant execute on function public.request_club_join(uuid) to authenticated;
grant execute on function public.list_my_club_join_requests() to authenticated;
grant execute on function public.list_my_clubs() to authenticated;
grant execute on function public.list_pending_club_join_requests(uuid) to authenticated;
grant execute on function public.review_club_join_request(uuid, boolean) to authenticated;
grant execute on function public.manage_league_admin(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
