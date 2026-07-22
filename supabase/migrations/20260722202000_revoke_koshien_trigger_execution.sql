begin;

revoke all on function public.protect_koshien_opened_later_results() from anon, authenticated, public;

commit;
