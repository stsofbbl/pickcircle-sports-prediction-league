-- Avoid PL/pgSQL output-column ambiguity in the membership upsert.
-- The primary-key constraint is the existing (league_id, user_id) arbiter.
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
$$;

revoke all on function public.review_club_join_request(uuid, boolean) from public, anon;
grant execute on function public.review_club_join_request(uuid, boolean) to authenticated;
