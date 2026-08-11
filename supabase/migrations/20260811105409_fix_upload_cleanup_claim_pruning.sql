create or replace function public.prune_upload_cleanup_claim_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.upload_cleanup_claim_requests r
  where r.worker_request_id in (
    select candidate.worker_request_id
    from private.upload_cleanup_claim_requests candidate
    where candidate.first_claimed_at < statement_timestamp() - interval '24 hours'
      and not exists (
        select 1 from public.upload_cleanup_queue q
        where q.worker_request_id = candidate.worker_request_id
          and q.processed_at is null
      )
    order by candidate.first_claimed_at
    limit 500
  );
  return null;
end;
$$;
