begin;

-- The Auth trigger invokes this internally; it must not be exposed as a
-- PostgREST RPC to anonymous or signed-in callers.
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
