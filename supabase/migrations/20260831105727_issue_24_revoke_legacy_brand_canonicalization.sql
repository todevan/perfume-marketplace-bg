begin;

revoke execute on function public.canonicalize_brand(uuid, uuid, uuid, text) from authenticated;

commit;
