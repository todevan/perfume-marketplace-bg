begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(1);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $sql$
  do $body$
  begin
    if exists (select 1 from public.upload_cleanup_queue)
       or exists (select 1 from private.upload_cleanup_claim_requests)
    then
      raise exception 'cleanup regression requires empty state';
    end if;

    perform 1
    from public.claim_upload_cleanup(1, 'a8-empty-cleanup-regression');
  end;
  $body$;
  $sql$,
  'cleanup claims execute against empty state through the pruning trigger'
);

select * from finish();
rollback;
