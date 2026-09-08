begin;
set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
-- Test-only pgTAP access; the enclosing transaction rolls this grant back.
grant usage on schema extensions to anon, authenticated, service_role;
select plan(29);
select ok(to_regprocedure('public.get_operations_snapshot()') is not null,
  'one aggregate-only service operations snapshot exists');
select ok(not has_function_privilege('anon', 'public.get_operations_snapshot()', 'execute'), 'anon has no snapshot access');
select ok(not has_function_privilege('authenticated', 'public.get_operations_snapshot()', 'execute'), 'authenticated has no snapshot access');
select ok(has_function_privilege('service_role', 'public.get_operations_snapshot()', 'execute'), 'service role has snapshot access');
select ok(not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.get_operations_snapshot()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'PUBLIC has no snapshot execute');
select ok(not has_table_privilege('authenticated', 'private.resend_delivery_events', 'select,insert,update,delete'), 'provider ledger is private');
select ok(not has_table_privilege('service_role', 'private.resend_delivery_events', 'insert,update,delete'), 'even service writes require append-only RPC');
select ok(not has_function_privilege('authenticated', 'public.append_resend_delivery_event(text,uuid,text,timestamptz)', 'execute'), 'user cannot spoof provider ingestion');
select ok(not has_function_privilege('anon', 'public.record_operations_checkpoint(text,text,timestamptz,boolean,text)', 'execute'), 'anonymous cannot forge backup heartbeat');
select ok(not has_function_privilege('authenticated', 'public.record_operations_checkpoint(text,text,timestamptz,boolean,text)', 'execute'), 'user cannot forge backup heartbeat');
select ok((select relrowsecurity from pg_class where oid = 'private.resend_delivery_events'::regclass), 'provider ledger uses RLS as defense in depth');
select ok((select relrowsecurity from pg_class where oid = 'private.operations_checkpoints'::regclass), 'checkpoints use RLS as defense in depth');
set local role anon;
select throws_ok('select public.get_operations_snapshot()', '42501', 'permission denied for function get_operations_snapshot', 'anonymous actual execution is denied');
set local role authenticated;
select throws_ok('select public.get_operations_snapshot()', '42501', 'permission denied for function get_operations_snapshot', 'authenticated actual execution is denied');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok('select public.get_operations_snapshot()', 'service-only snapshot executes against the real schema');
select is((public.get_operations_snapshot()->>'schemaVersion')::integer, 1, 'snapshot version is explicit');
select ok((public.get_operations_snapshot()->>'migrationDigest') ~ '^[0-9a-f]{64}$', 'actual migration inventory is hash-bound');
select ok((public.get_operations_snapshot()->>'schemaDigest') ~ '^[0-9a-f]{64}$', 'actual application schema is hash-bound');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_operations_snapshot()) k),
  'checkpoints,cleanupDeadLetters,cleanupRetries,dealViolations,emailDownstreamFailed,emailDownstreamMissing,jobsHealthy,migrationDigest,notificationsFailed,notificationsStale,quarantineStuck,reportQueueOldestAt,safetyViolations,schemaDigest,schemaVersion',
  'output keys are a closed aggregate/digest allowlist with no user or row fields');
select public.append_resend_delivery_event('msg_operations123456', '56761188-7520-42d8-8898-ff6fc54ce618', 'email.delivered', statement_timestamp());
select public.append_resend_delivery_event('msg_operations123456', '56761188-7520-42d8-8898-ff6fc54ce618', 'email.failed', statement_timestamp());
reset role;
select is((select count(*) from private.resend_delivery_events where provider_event_id = 'msg_operations123456'), 1::bigint, 'repeat provider event ID is a no-op');
select is((select event_type from private.resend_delivery_events where provider_event_id = 'msg_operations123456'), 'email.delivered', 'duplicate never overwrites original outcome');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns
  where table_schema = 'private' and table_name = 'resend_delivery_events'),
  'event_type,occurred_at,provider_event_id,provider_message_id,received_at', 'ledger has no recipient, body, subject or user linkage fields');
set local role service_role;
select public.record_operations_checkpoint('backup_freshness', repeat('a', 40), statement_timestamp() - interval '25 hours', true, repeat('b', 64));
select ok((public.get_operations_snapshot()->'checkpoints'->'backup_freshness'->>'checkpointAt')::timestamptz < statement_timestamp() - interval '24 hours', 'rechecking a historical backup does not refresh its data checkpoint');
select throws_ok($$select public.record_operations_checkpoint('backup_freshness', repeat('a', 40), statement_timestamp() + interval '6 minutes', true, repeat('b', 64))$$,
  '22023', 'invalid checkpoint time', 'future checkpoint cannot hide stale backups');
select throws_ok($$select public.append_resend_delivery_event('msg_futureevent123', '56761188-7520-42d8-8898-ff6fc54ce618', 'email.delivered', 'infinity')$$,
  '22023', 'invalid event time', 'infinite downstream time is rejected');
reset role;
select ok(not exists(select 1 from pg_enum where enumtypid = 'public.notification_email_delivery_status'::regtype
  and enumlabel in ('delivered','bounced','complained')), 'existing internal sent acceptance states remain unchanged');
-- Faults are confined to this rolled-back local test transaction.
alter table public.messages disable row level security;
select ok((public.get_operations_snapshot()->>'safetyViolations')::bigint > 0,
  'disabled private message RLS is an immediate safety invariant violation');
alter table public.messages enable row level security;
select public.append_resend_delivery_event('msg_failedtest12345', '56761188-7520-42d8-8898-ff6fc54ce618', 'email.failed', statement_timestamp() + interval '1 second');
select ok((public.get_operations_snapshot()->>'emailDownstreamFailed')::bigint > 0,
  'actual downstream failure is counted independently of provider API acceptance');
delete from cron.job_run_details where jobid in (
  select jobid from cron.job where jobname in ('perfume-beta-maintenance', 'perfume-beta-expiry-notifications')
);
insert into cron.job_run_details(runid, jobid, status, end_time)
  select -29029, jobid, 'succeeded', statement_timestamp() from cron.job where jobname = 'perfume-beta-maintenance';
select is((public.get_operations_snapshot()->>'jobsHealthy')::boolean, false,
  'a successful job cannot hide missing history for the other required job');
select * from finish();
rollback;
