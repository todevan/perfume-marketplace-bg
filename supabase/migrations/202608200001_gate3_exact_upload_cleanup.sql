create or replace function public.claim_exact_upload_cleanup(
  target_queue_id bigint,
  target_bucket_id text,
  target_storage_path text,
  worker_request_id text
)
returns table (
  queue_id bigint,
  bucket_id text,
  storage_path text,
  reason text,
  attempts integer,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_time timestamptz := statement_timestamp();
begin
  return query
  update public.upload_cleanup_queue as q
  set worker_request_id = btrim($4),
      claimed_at = lease_time,
      attempts = q.attempts + 1
  where target_queue_id > 0
    and target_bucket_id = 'report-evidence'
    and target_storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
    and q.id = target_queue_id
    and q.bucket_id = target_bucket_id
    and q.storage_path = target_storage_path
    and q.processed_at is null
    and q.dead_lettered_at is null
    and q.next_attempt_at <= lease_time
    and (
      q.claimed_at is null
      or q.claimed_at <= lease_time - interval '5 minutes'
    )
    and q.attempts < 8
    and char_length(btrim(coalesce($4, ''))) between 8 and 200
    and $4 = btrim($4)
    and coalesce(auth.jwt() ->> 'role', '') = 'service_role'
  returning q.id, q.bucket_id, q.storage_path, q.reason, q.attempts, q.claimed_at;
end;
$$;

revoke execute on function public.claim_exact_upload_cleanup(bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_exact_upload_cleanup(bigint, text, text, text)
  to service_role;

comment on function public.claim_exact_upload_cleanup(bigint, text, text, text) is
  'Service-only lease for one exact upload cleanup queue coordinate tuple. It never scans or claims foreign work.';
