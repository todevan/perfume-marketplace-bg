begin;

-- This ledger deliberately excludes recipients, subject, content and provider bodies.
create table private.resend_delivery_events (
  provider_event_id text primary key check (provider_event_id ~ '^msg_[A-Za-z0-9_-]{8,196}$'),
  provider_message_id uuid not null,
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
    'email.bounced', 'email.complained'
  )),
  occurred_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp()
);
create index resend_delivery_events_message_idx
  on private.resend_delivery_events (provider_message_id, occurred_at desc);
create index resend_delivery_events_received_idx on private.resend_delivery_events (received_at desc);
alter table private.resend_delivery_events enable row level security;
revoke all on private.resend_delivery_events from public, anon, authenticated, service_role;

create function public.append_resend_delivery_event(
  p_provider_event_id text, p_provider_message_id uuid, p_event_type text, p_occurred_at timestamptz
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_occurred_at is null or p_occurred_at > statement_timestamp() + interval '5 minutes'
     or not isfinite(p_occurred_at) then
    raise exception 'invalid event time' using errcode = '22023';
  end if;
  insert into private.resend_delivery_events (
    provider_event_id, provider_message_id, event_type, occurred_at
  ) values (p_provider_event_id, p_provider_message_id, p_event_type, p_occurred_at)
  on conflict (provider_event_id) do nothing;
end;
$$;
revoke execute on function public.append_resend_delivery_event(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.append_resend_delivery_event(text, uuid, text, timestamptz) to service_role;

-- Evidence checkpoints are independent of HTTP reads. In particular, verifying an
-- old backup must not refresh its data checkpoint. Full receipts remain private.
create table private.operations_checkpoints (
  sequence bigint generated always as identity primary key,
  kind text not null check (kind in ('backup_freshness', 'monitor_heartbeat', 'email_canary')),
  deployment_identity text not null check (deployment_identity ~ '^[0-9a-f]{40}$'),
  checkpoint_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp(),
  ok boolean not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$')
);
create index operations_checkpoints_latest_idx on private.operations_checkpoints (kind, sequence desc);
alter table private.operations_checkpoints enable row level security;
revoke all on private.operations_checkpoints from public, anon, authenticated, service_role;
revoke all on sequence private.operations_checkpoints_sequence_seq from public, anon, authenticated, service_role;

create function public.record_operations_checkpoint(
  p_kind text, p_deployment_identity text, p_checkpoint_at timestamptz,
  p_ok boolean, p_evidence_sha256 text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_checkpoint_at is null or not isfinite(p_checkpoint_at)
     or p_checkpoint_at > statement_timestamp() + interval '5 minutes'
     or p_checkpoint_at < statement_timestamp() - interval '35 days' then
    raise exception 'invalid checkpoint time' using errcode = '22023';
  end if;
  insert into private.operations_checkpoints (
    kind, deployment_identity, checkpoint_at, ok, evidence_sha256
  ) values (p_kind, p_deployment_identity, p_checkpoint_at, p_ok, p_evidence_sha256);
end;
$$;
revoke execute on function public.record_operations_checkpoint(text, text, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_operations_checkpoint(text, text, timestamptz, boolean, text) to service_role;

create function public.get_operations_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '3s'
as $$
declare
  jobs_healthy boolean := false;
  migration_digest text;
  schema_digest text;
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  -- Missing cron or missing job history is unavailable evidence, not a healthy result.
  if pg_catalog.to_regclass('cron.job') is not null
     and pg_catalog.to_regclass('cron.job_run_details') is not null then
    execute $query$
      select count(*) = 2 and coalesce(bool_and(coalesce(j.active and r.status = 'succeeded' and r.end_time > statement_timestamp() -
        case j.jobname when 'perfume-beta-maintenance' then interval '15 minutes'
          else interval '26 hours' end, false)), false)
      from cron.job j
      left join lateral (
        select d.end_time, d.status from cron.job_run_details d
        where d.jobid = j.jobid
        order by d.end_time desc limit 1
      ) r on true
      where j.jobname in ('perfume-beta-maintenance', 'perfume-beta-expiry-notifications')
    $query$ into jobs_healthy;
  end if;
  select encode(extensions.digest(coalesce(string_agg(version, E'\n' order by version), ''), 'sha256'), 'hex')
    into migration_digest from supabase_migrations.schema_migrations;
  -- Hash the application catalog, not data or managed-provider implementation.
  select encode(extensions.digest(coalesce(string_agg(item, E'\n' order by item), ''), 'sha256'), 'hex')
    into schema_digest from (
      select 'column:' || table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' ||
        coalesce(column_default, '') as item from information_schema.columns where table_schema = 'public'
      union all
      select 'constraint:' || c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid)
        from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
      union all
      select 'policy:' || tablename || ':' || policyname || ':' || roles::text || ':' || cmd || ':' ||
        coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_catalog.pg_policies where schemaname = 'public'
      union all
      select 'function:' || pg_get_functiondef(p.oid)
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
    ) catalog;
  select jsonb_build_object(
    'schemaVersion', 1,
    'migrationDigest', migration_digest,
    'schemaDigest', schema_digest,
    'notificationsFailed', (select count(*) from public.notification_email_deliveries where status = 'failed'),
    'notificationsStale', (select count(*) from public.notification_email_deliveries
      where status in ('pending', 'processing') and updated_at < statement_timestamp() - interval '15 minutes'),
    'emailDownstreamFailed', (select count(*) from (
      select distinct on (provider_message_id) event_type from private.resend_delivery_events
      where occurred_at > statement_timestamp() - interval '26 hours'
      order by provider_message_id, occurred_at desc, received_at desc, provider_event_id
    ) latest where event_type in ('email.failed', 'email.bounced', 'email.complained', 'email.delivery_delayed')),
    'emailDownstreamMissing', (select count(*) from public.notification_email_deliveries d
      where d.status = 'sent' and d.sent_at < statement_timestamp() - interval '15 minutes'
        and d.sent_at > statement_timestamp() - interval '26 hours'
        and not exists (select 1 from private.resend_delivery_events e
          where e.provider_message_id::text = d.provider_message_id and e.event_type <> 'email.sent')),
    'cleanupRetries', (select count(*) from public.upload_cleanup_queue
      where processed_at is null and dead_lettered_at is null and attempts > 0),
    'cleanupDeadLetters', (select count(*) from public.upload_cleanup_queue where dead_lettered_at is not null),
    'quarantineStuck', (select count(*) from public.upload_quarantine
      where status in ('pending', 'processing') and expires_at < statement_timestamp()),
    'jobsHealthy', coalesce(jobs_healthy, false),
    'dealViolations', (select count(*) from public.deals d
      left join public.offers o on o.id = d.accepted_offer_id
      left join public.conversations c on c.accepted_offer_id = d.accepted_offer_id
      where o.id is null or c.id is null or o.listing_id <> d.listing_id or c.listing_id <> d.listing_id
        or o.offerer_id <> d.party_b_id
        or (d.status <> 'cancelled' and not exists (
          select 1 from public.deal_listing_locks l where l.deal_id = d.id and l.listing_id = d.listing_id and l.item_role = 'target'))
        or (d.status = 'cancelled' and exists (select 1 from public.deal_listing_locks l where l.deal_id = d.id))
        or (select count(*) from public.conversation_members m where m.conversation_id = c.id) <> 2
        or exists (select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.profile_id not in (d.party_a_id, d.party_b_id))),
    'reportQueueOldestAt', (select min(created_at) from public.reports where status in ('open', 'investigating')),
    'safetyViolations', (
      (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
          and c.relname in ('reports', 'moderation_audit', 'messages', 'conversation_members', 'upload_quarantine', 'listing_photos'))
      + (select count(*) from storage.buckets where id in ('report-evidence', 'listing-image-quarantine') and public)
      + case when has_table_privilege('authenticated', 'public.reports', 'select')
          or has_table_privilege('authenticated', 'public.moderation_audit', 'select')
          or has_table_privilege('anon', 'public.reports', 'select') then 1 else 0 end
      + (select count(*) from public.messages m where not exists (
          select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.profile_id = m.sender_id))
    ),
    'checkpoints', coalesce((select jsonb_object_agg(kind, jsonb_build_object(
      'deploymentIdentity', deployment_identity, 'checkpointAt', checkpoint_at, 'ok', ok, 'evidenceSha256', evidence_sha256
    )) from (select distinct on (kind) * from private.operations_checkpoints order by kind, sequence desc) latest), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.get_operations_snapshot() from public, anon, authenticated;
grant execute on function public.get_operations_snapshot() to service_role;
comment on function public.get_operations_snapshot() is
  'Service-only aggregate monitoring contract. Never returns row identifiers or private content. Missing cron evidence fails closed.';
comment on table private.resend_delivery_events is
  'Append-only downstream delivery evidence. Internal notification sent continues to mean provider API acceptance.';
commit;
