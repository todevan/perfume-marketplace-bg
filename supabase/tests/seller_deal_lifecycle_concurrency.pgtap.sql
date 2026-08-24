-- Real three-connection proof for the complete-vs-cancel race.
-- The controller holds the deal row while both authenticated actor sessions
-- reach the same lock barrier; releasing it allows exactly one transition.

set role postgres;
set search_path = public, extensions, pg_catalog;

create temp table issue25_dblink_extension_state (
  was_present boolean not null,
  test_owned boolean not null
);
do $$
declare
  extension_oid oid;
  extension_comment text;
  ownership_marker constant text := 'issue25:seller_deal_lifecycle_concurrency:test-owned:v1';
begin
  select e.oid, obj_description(e.oid, 'pg_extension')
  into extension_oid, extension_comment
  from pg_extension e
  where e.extname = 'dblink';

  if extension_oid is not null and extension_comment = ownership_marker then
    execute 'drop extension dblink';
    extension_oid := null;
  end if;

  if extension_oid is not null then
    insert into issue25_dblink_extension_state values (true, false);
  else
    execute 'create extension dblink with schema extensions';
    execute format('comment on extension dblink is %L', ownership_marker);
    insert into issue25_dblink_extension_state values (false, true);
  end if;
end;
$$;
create extension if not exists pgtap with schema extensions;

do $$
declare
  connection_name text;
begin
  foreach connection_name in array array[
    'issue25_controller', 'issue25_complete', 'issue25_cancel'
  ] loop
    begin
      perform extensions.dblink_disconnect(connection_name);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

-- Failure-safe pre-cleanup makes the committed fixture rerunnable.
set session_replication_role = replica;
delete from public.beta_auth_events where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from public.moderation_audit where report_id in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id and n.data ->> 'reportId' in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.notifications where data ->> 'reportId' in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.reports where id in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries d
using public.notifications n
where d.notification_id = n.id
  and n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.notifications
where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.reviews where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deal_confirmations where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deal_listing_locks where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deals where id = '37000001-0000-4000-8000-000000000001';
delete from public.conversation_members where conversation_id = '38000001-0000-4000-8000-000000000001';
delete from public.conversations where id = '38000001-0000-4000-8000-000000000001';
delete from public.offers where id = '36000001-0000-4000-8000-000000000001';
delete from public.listings where id = '35000001-0000-4000-8000-000000000001';
delete from public.brands where id = '35999999-9999-4999-8999-999999999999';
delete from public.beta_consent_events where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from public.beta_memberships where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from public.beta_invites where id in (
  '35511111-1111-4111-8111-111111111111',
  '35522222-2222-4222-8222-222222222222',
  '35544444-4444-4444-8444-444444444444'
);
delete from public.profiles where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from auth.users where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
set session_replication_role = origin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('35111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-seller@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"race_seller"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('35222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-buyer@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"race_buyer"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('35444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-staff@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"race_staff"}'::jsonb, statement_timestamp(), statement_timestamp());

update public.profiles
set email_verified_at = statement_timestamp(),
    city = 'Sofia',
    completed_deals_count = 0,
    role = case
      when id = '35444444-4444-4444-8444-444444444444' then 'admin'::public.platform_role
      else role
    end
where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);

insert into public.beta_invites (id, email, token_hash, status, expires_at) values
  ('35511111-1111-4111-8111-111111111111', 'race-seller@example.test', repeat('5', 64), 'pending', statement_timestamp() + interval '7 days'),
  ('35522222-2222-4222-8222-222222222222', 'race-buyer@example.test', repeat('6', 64), 'pending', statement_timestamp() + interval '7 days'),
  ('35544444-4444-4444-8444-444444444444', 'race-staff@example.test', repeat('7', 64), 'pending', statement_timestamp() + interval '7 days');
update public.beta_invites
set status = 'accepted',
    accepted_by = case id
      when '35511111-1111-4111-8111-111111111111' then '35111111-1111-4111-8111-111111111111'::uuid
      when '35522222-2222-4222-8222-222222222222' then '35222222-2222-4222-8222-222222222222'::uuid
      else '35444444-4444-4444-8444-444444444444'::uuid
    end
where id in (
  '35511111-1111-4111-8111-111111111111',
  '35522222-2222-4222-8222-222222222222',
  '35544444-4444-4444-8444-444444444444'
);
insert into public.beta_memberships (profile_id, invite_id, status) values
  ('35111111-1111-4111-8111-111111111111', '35511111-1111-4111-8111-111111111111', 'pending'),
  ('35222222-2222-4222-8222-222222222222', '35522222-2222-4222-8222-222222222222', 'pending'),
  ('35444444-4444-4444-8444-444444444444', '35544444-4444-4444-8444-444444444444', 'pending');
update public.beta_memberships
set status = 'active', activated_at = statement_timestamp() - interval '1 second'
where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
insert into public.beta_consent_events (profile_id, document_code, document_version, source)
select p.id, d.document_code, d.document_version, 'web'
from public.profiles p
cross join public.beta_legal_documents d
where p.id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
)
  and d.required_for_access
  and d.retired_at is null;

insert into public.brands (id, canonical_name, slug, status, normalized_key)
values ('35999999-9999-4999-8999-999999999999', 'Concurrency Brand', 'concurrency-brand', 'canonical', 'concurrency brand');

set session_replication_role = replica;
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
) values (
  '35000001-0000-4000-8000-000000000001',
  '35111111-1111-4111-8111-111111111111', 'offer', 'sale', 'retail_bottle',
  'unisex', '35999999-9999-4999-8999-999999999999', 'Concurrent fragrance',
  'EDP', 'Concurrent lifecycle listing', 'Committed concurrency fixture', 'Sofia',
  100.0, 90.0, false, 4000, 'reserved', 'concurrent-lifecycle-listing',
  statement_timestamp(), statement_timestamp() + interval '60 days'
);
insert into public.offers (
  id, listing_id, offerer_id, kind, cash_amount_minor, status, expires_at, responded_at
) values (
  '36000001-0000-4000-8000-000000000001',
  '35000001-0000-4000-8000-000000000001',
  '35222222-2222-4222-8222-222222222222',
  'cash', 3500, 'accepted', statement_timestamp() + interval '7 days', statement_timestamp()
);
insert into public.conversations (id, listing_id, accepted_offer_id, status)
values (
  '38000001-0000-4000-8000-000000000001',
  '35000001-0000-4000-8000-000000000001',
  '36000001-0000-4000-8000-000000000001',
  'open'
);
insert into public.deals (
  id, listing_id, accepted_offer_id, party_a_id, party_b_id, status
) values (
  '37000001-0000-4000-8000-000000000001',
  '35000001-0000-4000-8000-000000000001',
  '36000001-0000-4000-8000-000000000001',
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  'pending_confirmation'
);
set session_replication_role = origin;

create or replace function private.issue25_catch_lifecycle(
  lifecycle_action text,
  target_deal_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if lifecycle_action = 'complete' then
    perform public.complete_deal(target_deal_id);
  elsif lifecycle_action = 'cancel' then
    perform public.cancel_deal(target_deal_id, 'Concurrent cancellation');
  else
    raise exception 'unknown lifecycle test action' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'action', lifecycle_action);
exception when others then
  return jsonb_build_object(
    'ok', false,
    'action', lifecycle_action,
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$$;
revoke execute on function private.issue25_catch_lifecycle(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.issue25_catch_lifecycle(text, uuid) to authenticated;

create or replace function private.issue25_catch_profile_moderation(
  target_report_id uuid,
  target_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.moderate_profile(
    target_report_id,
    target_profile_id,
    true,
    'Concurrent profile suspension race proof'
  );
  return jsonb_build_object('ok', true, 'action', 'moderate');
exception when others then
  return jsonb_build_object(
    'ok', false,
    'action', 'moderate',
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$$;
revoke execute on function private.issue25_catch_profile_moderation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.issue25_catch_profile_moderation(uuid, uuid)
  to authenticated;

create or replace function private.issue25_catch_deal_resolution(
  target_report_id uuid,
  target_deal_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.resolve_deal_dispute(
    target_report_id,
    target_deal_id,
    'pending_confirmation',
    'Concurrent dispute resume race proof'
  );
  return jsonb_build_object('ok', true, 'action', 'resolve');
exception when others then
  return jsonb_build_object(
    'ok', false,
    'action', 'resolve',
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$$;
revoke execute on function private.issue25_catch_deal_resolution(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.issue25_catch_deal_resolution(uuid, uuid)
  to authenticated;

create or replace function private.issue25_catch_listing_moderation(
  target_report_id uuid,
  target_listing_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.moderate_listing(
    target_report_id,
    target_listing_id,
    'Concurrent listing removal race proof',
    null,
    null,
    'removed'
  );
  return jsonb_build_object('ok', true, 'action', 'moderate_listing');
exception when others then
  return jsonb_build_object(
    'ok', false,
    'action', 'moderate_listing',
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$$;
revoke execute on function private.issue25_catch_listing_moderation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.issue25_catch_listing_moderation(uuid, uuid)
  to authenticated;

create temp table issue25_sessions (actor text primary key, pid integer not null);
create temp table issue25_barrier (both_waiting boolean not null, transaction_waiters integer not null);
create temp table issue25_outcomes (result jsonb not null);

select extensions.dblink_connect(
  'issue25_controller',
  'host=db port=5432 dbname=postgres user=postgres password=postgres application_name=issue25_controller'
);
select extensions.dblink_connect(
  'issue25_complete',
  'host=db port=5432 dbname=postgres user=postgres password=postgres application_name=issue25_complete'
);
select extensions.dblink_connect(
  'issue25_cancel',
  'host=db port=5432 dbname=postgres user=postgres password=postgres application_name=issue25_cancel'
);

insert into issue25_sessions
select 'controller', pid from extensions.dblink('issue25_controller', 'select pg_backend_pid()') as t(pid integer)
union all
select 'complete', pid from extensions.dblink('issue25_complete', 'select pg_backend_pid()') as t(pid integer)
union all
select 'cancel', pid from extensions.dblink('issue25_cancel', 'select pg_backend_pid()') as t(pid integer);

select extensions.dblink_exec('issue25_controller', 'begin');
select *
from extensions.dblink(
  'issue25_controller',
  $$select id::text from public.deals where id = '37000001-0000-4000-8000-000000000001' for update$$
) as locked(id text);

select extensions.dblink_exec(
  'issue25_complete',
  $$begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"35111111-1111-4111-8111-111111111111","role":"authenticated"}';
    set local "request.jwt.claim.sub" = '35111111-1111-4111-8111-111111111111'$$
);
select extensions.dblink_exec(
  'issue25_cancel',
  $$begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"35222222-2222-4222-8222-222222222222","role":"authenticated"}';
    set local "request.jwt.claim.sub" = '35222222-2222-4222-8222-222222222222'$$
);

do $send$
begin
  perform extensions.dblink_send_query(
    'issue25_complete',
    $$select private.issue25_catch_lifecycle('complete', '37000001-0000-4000-8000-000000000001')$$
  );
  perform extensions.dblink_send_query(
    'issue25_cancel',
    $$select private.issue25_catch_lifecycle('cancel', '37000001-0000-4000-8000-000000000001')$$
  );
end;
$send$;

do $$
declare
  attempt integer;
  waiting_count integer := 0;
  transaction_waiter_count integer := 0;
begin
  for attempt in 1..200 loop
    select count(*)::integer into waiting_count
    from pg_stat_activity a
    join issue25_sessions s on s.pid = a.pid
    where s.actor in ('complete', 'cancel')
      and a.state = 'active'
      and a.wait_event_type = 'Lock'
      and exists (
        select 1 from pg_locks l where l.pid = a.pid and not l.granted
      );

    select count(distinct l.pid)::integer into transaction_waiter_count
    from pg_locks l
    join issue25_sessions s on s.pid = l.pid
    where s.actor in ('complete', 'cancel')
      and l.locktype = 'transactionid'
      and not l.granted;

    exit when waiting_count = 2;
    perform pg_sleep(0.025);
  end loop;
  insert into issue25_barrier values (waiting_count = 2, transaction_waiter_count);
end;
$$;

select plan(34);
select is((select count(distinct pid)::integer from issue25_sessions), 3, 'controller and actors use three distinct PostgreSQL sessions');
select ok(
  (select both_waiting and transaction_waiters >= 1 from issue25_barrier),
  'both actor sessions reach the explicit row-lock barrier before release'
);

select extensions.dblink_exec('issue25_controller', 'commit');

do $$
declare
  attempt integer;
  complete_busy integer;
  cancel_busy integer;
  winner text;
  loser text;
begin
  for attempt in 1..200 loop
    complete_busy := extensions.dblink_is_busy('issue25_complete');
    cancel_busy := extensions.dblink_is_busy('issue25_cancel');
    exit when complete_busy + cancel_busy = 1;
    perform pg_sleep(0.025);
  end loop;
  if complete_busy + cancel_busy <> 1 then
    raise exception 'concurrency winner did not emerge before timeout';
  end if;

  if complete_busy = 0 then
    winner := 'issue25_complete'; loser := 'issue25_cancel';
  else
    winner := 'issue25_cancel'; loser := 'issue25_complete';
  end if;

  insert into issue25_outcomes
  select result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform extensions.dblink_exec(winner, 'commit');

  for attempt in 1..200 loop
    exit when extensions.dblink_is_busy(loser) = 0;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(loser) <> 0 then
    raise exception 'concurrency loser did not observe terminal state before timeout';
  end if;
  insert into issue25_outcomes
  select result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform extensions.dblink_exec(loser, 'rollback');
end;
$$;

select is(
  (select count(*)::integer from issue25_outcomes where (result ->> 'ok')::boolean),
  1,
  'exactly one lifecycle transition commits'
);
select ok(
  (select count(*) = 1
     and bool_and(result ->> 'sqlstate' = '23514')
     and bool_and(result ->> 'message' in (
       'only an active accepted deal can be completed',
       'only an active accepted deal can be cancelled'
     ))
   from issue25_outcomes
   where not (result ->> 'ok')::boolean),
  'the loser observes the committed terminal state and fails closed'
);
select ok(
  (select
    (d.status = 'completed' and exists (
      select 1 from issue25_outcomes o where (o.result ->> 'ok')::boolean and o.result ->> 'action' = 'complete'
    ))
    or
    (d.status = 'cancelled' and exists (
      select 1 from issue25_outcomes o where (o.result ->> 'ok')::boolean and o.result ->> 'action' = 'cancel'
    ))
   from public.deals d
   where d.id = '37000001-0000-4000-8000-000000000001'),
  'persisted terminal status matches the winning transition'
);
select ok(
  (select case d.status
    when 'completed' then (
      select count(*) = 2 and min(completed_deals_count) = 1 and max(completed_deals_count) = 1
      from public.profiles
      where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222')
    )
    else (
      select count(*) = 2 and min(completed_deals_count) = 0 and max(completed_deals_count) = 0
      from public.profiles
      where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222')
    )
   end
   from public.deals d
   where d.id = '37000001-0000-4000-8000-000000000001'),
  'participant counters change at most once and only for completion'
);
select ok(
  (select case d.status
    when 'completed' then (
      select count(*) = 2
        and count(distinct dedupe_key) = 2
        and count(*) filter (where kind = 'deal_cancelled') = 0
      from public.notifications
      where data ->> 'dealId' = d.id::text
    )
    else (
      select count(*) = 1
        and count(distinct dedupe_key) = 1
        and count(*) filter (where kind = 'deal_completed') = 0
      from public.notifications
      where data ->> 'dealId' = d.id::text
    )
   end
   from public.deals d
   where d.id = '37000001-0000-4000-8000-000000000001'),
  'the race emits only the winning lifecycle notifications with no duplicates'
);

-- Reuse the committed actors for a second real race. A controller-held profile
-- advisory lock makes completion and suspension overlap at the new barrier.
set session_replication_role = replica;
delete from public.notification_email_deliveries d
using public.notifications n
where d.notification_id = n.id
  and n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.notifications
where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.moderation_audit where report_id = '39f00001-0000-4000-8000-000000000001';
delete from public.notification_email_deliveries d using public.notifications n where d.notification_id = n.id and n.data ->> 'reportId' = '39f00001-0000-4000-8000-000000000001';
delete from public.notifications where data ->> 'reportId' = '39f00001-0000-4000-8000-000000000001';
delete from public.reports where id = '39f00001-0000-4000-8000-000000000001';
update public.profiles
set completed_deals_count = 0,
    is_suspended = false
where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222'
);
update public.listings
set status = 'reserved', completed_at = null
where id = '35000001-0000-4000-8000-000000000001';
update public.conversations
set status = 'open'
where id = '38000001-0000-4000-8000-000000000001';
update public.deals
set status = 'pending_confirmation',
    completed_at = null,
    cancelled_at = null,
    cancelled_by = null,
    cancellation_reason = null,
    disputed_at = null
where id = '37000001-0000-4000-8000-000000000001';
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, status, assigned_to
) values (
  '39f00001-0000-4000-8000-000000000001',
  '35222222-2222-4222-8222-222222222222',
  'profile',
  '35111111-1111-4111-8111-111111111111',
  'profile_abuse',
  'Committed completion-versus-suspension concurrency fixture',
  'investigating',
  '35444444-4444-4444-8444-444444444444'
);
set session_replication_role = origin;

create temp table issue25_profile_barrier (
  both_waiting boolean not null,
  advisory_waiters integer not null
);
create temp table issue25_profile_outcomes (result jsonb not null);

select extensions.dblink_exec('issue25_controller', 'begin');
select *
from extensions.dblink(
  'issue25_controller',
  $$select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'aromatika:profile-lifecycle:35111111-1111-4111-8111-111111111111',
        0
      )
    )::text$$
) as locked(result text);

select extensions.dblink_exec(
  'issue25_complete',
  $$begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"35111111-1111-4111-8111-111111111111","role":"authenticated"}';
    set local "request.jwt.claim.sub" = '35111111-1111-4111-8111-111111111111'$$
);
select extensions.dblink_exec(
  'issue25_cancel',
  $$begin;
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"35444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';
    set local "request.jwt.claim.sub" = '35444444-4444-4444-8444-444444444444'$$
);

do $send$
begin
  perform extensions.dblink_send_query(
    'issue25_complete',
    $$select private.issue25_catch_lifecycle('complete', '37000001-0000-4000-8000-000000000001')$$
  );
  perform extensions.dblink_send_query(
    'issue25_cancel',
    $$select private.issue25_catch_profile_moderation(
      '39f00001-0000-4000-8000-000000000001',
      '35111111-1111-4111-8111-111111111111'
    )$$
  );
end;
$send$;

do $$
declare
  attempt integer;
  advisory_waiter_count integer := 0;
begin
  for attempt in 1..400 loop
    select count(distinct actor_lock.pid)::integer into advisory_waiter_count
    from pg_locks actor_lock
    join issue25_sessions actor_session on actor_session.pid = actor_lock.pid
    where actor_session.actor in ('complete', 'cancel')
      and actor_lock.locktype = 'advisory'
      and not actor_lock.granted
      and exists (
        select 1
        from pg_locks controller_lock
        join issue25_sessions controller_session on controller_session.pid = controller_lock.pid
        where controller_session.actor = 'controller'
          and controller_lock.locktype = 'advisory'
          and controller_lock.granted
          and controller_lock.database is not distinct from actor_lock.database
          and controller_lock.classid = actor_lock.classid
          and controller_lock.objid = actor_lock.objid
          and controller_lock.objsubid = actor_lock.objsubid
      );

    exit when advisory_waiter_count = 2;
    perform pg_sleep(0.025);
  end loop;
  insert into issue25_profile_barrier values (
    advisory_waiter_count = 2,
    advisory_waiter_count
  );
end;
$$;

select ok(
  (select both_waiting and advisory_waiters = 2 from issue25_profile_barrier),
  'completion and suspension both reach the same profile advisory-lock barrier'
);

select extensions.dblink_exec('issue25_controller', 'commit');

do $$
declare
  attempt integer;
  complete_busy integer;
  moderate_busy integer;
  winner text;
  loser text;
begin
  for attempt in 1..200 loop
    complete_busy := extensions.dblink_is_busy('issue25_complete');
    moderate_busy := extensions.dblink_is_busy('issue25_cancel');
    exit when complete_busy + moderate_busy = 1;
    perform pg_sleep(0.025);
  end loop;
  if complete_busy + moderate_busy <> 1 then
    raise exception 'completion-versus-suspension winner did not emerge before timeout';
  end if;

  if complete_busy = 0 then
    winner := 'issue25_complete'; loser := 'issue25_cancel';
  else
    winner := 'issue25_cancel'; loser := 'issue25_complete';
  end if;

  insert into issue25_profile_outcomes
  select result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform extensions.dblink_exec(winner, 'commit');

  for attempt in 1..200 loop
    exit when extensions.dblink_is_busy(loser) = 0;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(loser) <> 0 then
    raise exception 'completion-versus-suspension loser did not finish before timeout';
  end if;
  insert into issue25_profile_outcomes
  select result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform extensions.dblink_exec(loser, 'commit');
end;
$$;

select is(
  (select count(*)::integer from issue25_profile_outcomes),
  2,
  'both bounded race sessions finish without deadlock or timeout'
);
select ok(
  (select count(*) = 1 and bool_and((result ->> 'ok')::boolean)
   from issue25_profile_outcomes
   where result ->> 'action' = 'moderate'),
  'profile suspension always succeeds'
);
select ok(
  (select count(*) = 1 and bool_and(
      (result ->> 'ok')::boolean
      or (
        result ->> 'sqlstate' = '23514'
        and result ->> 'message' = 'only an active accepted deal can be completed'
      )
      or (
        result ->> 'sqlstate' = '42501'
        and result ->> 'message' = 'deal participants are not active'
      )
    )
   from issue25_profile_outcomes
   where result ->> 'action' = 'complete'),
  'completion either commits first or observes the suspension terminal state'
);
select ok(
  (select p.is_suspended
   from public.profiles p
   where p.id = '35111111-1111-4111-8111-111111111111')
  and (select count(*) = 2
         and count(*) filter (where action = 'user_suspended') = 1
         and count(*) filter (where action = 'report_resolved') = 1
       from public.moderation_audit
       where report_id = '39f00001-0000-4000-8000-000000000001')
  and (select case
    when exists (
      select 1 from issue25_profile_outcomes
      where result ->> 'action' = 'complete' and (result ->> 'ok')::boolean
    ) then
      d.status = 'completed'
      and (select count(*) = 2 and min(completed_deals_count) = 1 and max(completed_deals_count) = 1
           from public.profiles
           where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222'))
      and (select count(*) = 2 and count(distinct dedupe_key) = 2
           from public.notifications
           where kind = 'deal_completed' and data ->> 'dealId' = d.id::text)
    else
      d.status = 'disputed'
      and (select count(*) = 2 and min(completed_deals_count) = 0 and max(completed_deals_count) = 0
           from public.profiles
           where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222'))
      and (select count(*) = 0 from public.notifications where data ->> 'dealId' = d.id::text)
    end
   from public.deals d
   where d.id = '37000001-0000-4000-8000-000000000001'),
  'the serialized final state preserves suspension, deal, counter, audit and notification invariants'
);

-- A disputed resume and profile suspension serialize on the same seller key.
set session_replication_role = replica;
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id and n.data ->> 'reportId' in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.notifications where data ->> 'reportId' in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.moderation_audit where report_id in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.reports where id in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id and n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.notifications where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
update public.profiles set completed_deals_count = 0, is_suspended = false
where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222');
update public.listings set status = 'reserved', completed_at = null
where id = '35000001-0000-4000-8000-000000000001';
update public.conversations set status = 'open'
where id = '38000001-0000-4000-8000-000000000001';
update public.deals set status = 'disputed', completed_at = null,
  cancelled_at = null, cancelled_by = null, cancellation_reason = null,
  disputed_at = statement_timestamp()
where id = '37000001-0000-4000-8000-000000000001';
insert into public.deal_listing_locks (listing_id, deal_id, item_role) values (
  '35000001-0000-4000-8000-000000000001', '37000001-0000-4000-8000-000000000001', 'target'
) on conflict (listing_id) do update set deal_id = excluded.deal_id, item_role = excluded.item_role;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, status, assigned_to
) values
  ('39d00001-0000-4000-8000-000000000001', '35222222-2222-4222-8222-222222222222',
   'deal', '37000001-0000-4000-8000-000000000001', 'deal_dispute',
   'Committed resume-versus-suspension concurrency fixture', 'investigating',
   '35444444-4444-4444-8444-444444444444'),
  ('39f00001-0000-4000-8000-000000000001', '35222222-2222-4222-8222-222222222222',
   'profile', '35111111-1111-4111-8111-111111111111', 'profile_abuse',
   'Committed resume-versus-suspension profile fixture', 'investigating',
   '35444444-4444-4444-8444-444444444444');
set session_replication_role = origin;

create temp table issue25_resume_barrier (both_waiting boolean not null, advisory_waiters integer not null);
create temp table issue25_resume_outcomes (result jsonb not null);
select extensions.dblink_exec('issue25_controller', 'begin');
select * from extensions.dblink(
  'issue25_controller',
  $$select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aromatika:profile-lifecycle:35111111-1111-4111-8111-111111111111', 0
  ))::text$$
) as locked(result text);
select extensions.dblink_exec('issue25_complete', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';
  set local "request.jwt.claim.sub" = '35444444-4444-4444-8444-444444444444'$$);
select extensions.dblink_exec('issue25_cancel', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';
  set local "request.jwt.claim.sub" = '35444444-4444-4444-8444-444444444444'$$);
do $send$ begin
  perform extensions.dblink_send_query('issue25_complete',
    $$select private.issue25_catch_deal_resolution(
      '39d00001-0000-4000-8000-000000000001', '37000001-0000-4000-8000-000000000001'
    )$$);
  perform extensions.dblink_send_query('issue25_cancel',
    $$select private.issue25_catch_profile_moderation(
      '39f00001-0000-4000-8000-000000000001', '35111111-1111-4111-8111-111111111111'
    )$$);
end; $send$;
do $$
declare attempt integer; advisory_waiter_count integer := 0;
begin
  for attempt in 1..400 loop
    select count(distinct actor_lock.pid)::integer into advisory_waiter_count
    from pg_locks actor_lock
    join issue25_sessions actor_session on actor_session.pid = actor_lock.pid
    where actor_session.actor in ('complete', 'cancel')
      and actor_lock.locktype = 'advisory'
      and not actor_lock.granted
      and exists (
        select 1
        from pg_locks controller_lock
        join issue25_sessions controller_session on controller_session.pid = controller_lock.pid
        where controller_session.actor = 'controller'
          and controller_lock.locktype = 'advisory'
          and controller_lock.granted
          and controller_lock.database is not distinct from actor_lock.database
          and controller_lock.classid = actor_lock.classid
          and controller_lock.objid = actor_lock.objid
          and controller_lock.objsubid = actor_lock.objsubid
      );
    exit when advisory_waiter_count = 2;
    perform pg_sleep(0.025);
  end loop;
  insert into issue25_resume_barrier values (
    advisory_waiter_count = 2, advisory_waiter_count
  );
end;
$$;
select ok((select both_waiting and advisory_waiters = 2 from issue25_resume_barrier),
  'dispute resume and suspension both reach the seller advisory-lock barrier');
select extensions.dblink_exec('issue25_controller', 'commit');
do $$
declare attempt integer; resolve_busy integer; moderate_busy integer; winner text; loser text;
begin
  for attempt in 1..200 loop
    resolve_busy := extensions.dblink_is_busy('issue25_complete');
    moderate_busy := extensions.dblink_is_busy('issue25_cancel');
    exit when resolve_busy + moderate_busy = 1;
    perform pg_sleep(0.025);
  end loop;
  if resolve_busy + moderate_busy <> 1 then
    raise exception 'resume-versus-suspension winner did not emerge before timeout';
  end if;
  if resolve_busy = 0 then winner := 'issue25_complete'; loser := 'issue25_cancel';
  else winner := 'issue25_cancel'; loser := 'issue25_complete'; end if;
  insert into issue25_resume_outcomes
  select result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform extensions.dblink_exec(winner, 'commit');
  for attempt in 1..200 loop
    exit when extensions.dblink_is_busy(loser) = 0;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(loser) <> 0 then
    raise exception 'resume-versus-suspension loser did not finish before timeout';
  end if;
  insert into issue25_resume_outcomes
  select result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform extensions.dblink_exec(loser, 'commit');
end;
$$;
select is((select count(*)::integer from issue25_resume_outcomes), 2,
  'both resume race sessions finish without deadlock or timeout');
select ok((select count(*) = 1 and bool_and((result ->> 'ok')::boolean)
  from issue25_resume_outcomes where result ->> 'action' = 'moderate'),
  'profile suspension wins or follows the disputed resume');
select ok((select count(*) = 1 and bool_and((result ->> 'ok')::boolean or (
    result ->> 'sqlstate' = '23514'
    and result ->> 'message' = 'a deal with an inactive participant cannot be resumed'
  )) from issue25_resume_outcomes where result ->> 'action' = 'resolve'),
  'dispute resume either commits before suspension or rejects the inactive seller');
select ok(
  (select is_suspended from public.profiles where id = '35111111-1111-4111-8111-111111111111')
  and (select status = 'disputed' from public.deals where id = '37000001-0000-4000-8000-000000000001')
  and (select status = 'blocked' from public.conversations where id = '38000001-0000-4000-8000-000000000001')
  and (select count(*) = 0 from public.notifications where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001')
  and (select case when exists (
      select 1 from issue25_resume_outcomes
      where result ->> 'action' = 'resolve' and (result ->> 'ok')::boolean
    ) then (select status = 'resolved' from public.reports where id = '39d00001-0000-4000-8000-000000000001')
    else (select status = 'investigating' from public.reports where id = '39d00001-0000-4000-8000-000000000001') end),
  'resume-versus-suspension preserves the final suspended and disputed state'
);

-- Seller cancellation can commit before suspension; otherwise its post-lock
-- active-user check rejects the action and moderation leaves the deal disputed.
set session_replication_role = replica;
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id and n.data ->> 'reportId' in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.notifications where data ->> 'reportId' in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.moderation_audit where report_id in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.reports where id in (
  '39d00001-0000-4000-8000-000000000001', '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id and n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.notifications where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
update public.profiles set completed_deals_count = 0, is_suspended = false
where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222');
update public.listings set status = 'reserved', completed_at = null
where id = '35000001-0000-4000-8000-000000000001';
update public.conversations set status = 'open'
where id = '38000001-0000-4000-8000-000000000001';
update public.deals set status = 'pending_confirmation', completed_at = null,
  cancelled_at = null, cancelled_by = null, cancellation_reason = null, disputed_at = null
where id = '37000001-0000-4000-8000-000000000001';
insert into public.deal_listing_locks (listing_id, deal_id, item_role) values (
  '35000001-0000-4000-8000-000000000001', '37000001-0000-4000-8000-000000000001', 'target'
) on conflict (listing_id) do update set deal_id = excluded.deal_id, item_role = excluded.item_role;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, status, assigned_to
) values (
  '39f00001-0000-4000-8000-000000000001', '35222222-2222-4222-8222-222222222222',
  'profile', '35111111-1111-4111-8111-111111111111', 'profile_abuse',
  'Committed cancellation-versus-suspension profile fixture', 'investigating',
  '35444444-4444-4444-8444-444444444444'
);
set session_replication_role = origin;

create temp table issue25_seller_cancel_barrier (both_waiting boolean not null, advisory_waiters integer not null);
create temp table issue25_seller_cancel_outcomes (result jsonb not null);
select extensions.dblink_exec('issue25_controller', 'begin');
select * from extensions.dblink(
  'issue25_controller',
  $$select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aromatika:profile-lifecycle:35111111-1111-4111-8111-111111111111', 0
  ))::text$$
) as locked(result text);
select extensions.dblink_exec('issue25_complete', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35111111-1111-4111-8111-111111111111","role":"authenticated"}';
  set local "request.jwt.claim.sub" = '35111111-1111-4111-8111-111111111111'$$);
select extensions.dblink_exec('issue25_cancel', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';
  set local "request.jwt.claim.sub" = '35444444-4444-4444-8444-444444444444'$$);
do $send$ begin
  perform extensions.dblink_send_query('issue25_complete',
    $$select private.issue25_catch_lifecycle('cancel', '37000001-0000-4000-8000-000000000001')$$);
  perform extensions.dblink_send_query('issue25_cancel',
    $$select private.issue25_catch_profile_moderation(
      '39f00001-0000-4000-8000-000000000001', '35111111-1111-4111-8111-111111111111'
    )$$);
end; $send$;
do $$
declare attempt integer; advisory_waiter_count integer := 0;
begin
  for attempt in 1..400 loop
    select count(distinct actor_lock.pid)::integer into advisory_waiter_count
    from pg_locks actor_lock
    join issue25_sessions actor_session on actor_session.pid = actor_lock.pid
    where actor_session.actor in ('complete', 'cancel')
      and actor_lock.locktype = 'advisory'
      and not actor_lock.granted
      and exists (
        select 1
        from pg_locks controller_lock
        join issue25_sessions controller_session on controller_session.pid = controller_lock.pid
        where controller_session.actor = 'controller'
          and controller_lock.locktype = 'advisory'
          and controller_lock.granted
          and controller_lock.database is not distinct from actor_lock.database
          and controller_lock.classid = actor_lock.classid
          and controller_lock.objid = actor_lock.objid
          and controller_lock.objsubid = actor_lock.objsubid
      );
    exit when advisory_waiter_count = 2;
    perform pg_sleep(0.025);
  end loop;
  insert into issue25_seller_cancel_barrier values (
    advisory_waiter_count = 2, advisory_waiter_count
  );
end;
$$;
select ok((select both_waiting and advisory_waiters = 2 from issue25_seller_cancel_barrier),
  'seller cancellation and suspension both reach the seller advisory-lock barrier');
select extensions.dblink_exec('issue25_controller', 'commit');
do $$
declare attempt integer; cancel_busy integer; moderate_busy integer; winner text; loser text;
begin
  for attempt in 1..200 loop
    cancel_busy := extensions.dblink_is_busy('issue25_complete');
    moderate_busy := extensions.dblink_is_busy('issue25_cancel');
    exit when cancel_busy + moderate_busy = 1;
    perform pg_sleep(0.025);
  end loop;
  if cancel_busy + moderate_busy <> 1 then
    raise exception 'cancellation-versus-suspension winner did not emerge before timeout';
  end if;
  if cancel_busy = 0 then winner := 'issue25_complete'; loser := 'issue25_cancel';
  else winner := 'issue25_cancel'; loser := 'issue25_complete'; end if;
  insert into issue25_seller_cancel_outcomes
  select result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform result from extensions.dblink_get_result(winner) as t(result jsonb);
  perform extensions.dblink_exec(winner, 'commit');
  for attempt in 1..200 loop
    exit when extensions.dblink_is_busy(loser) = 0;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(loser) <> 0 then
    raise exception 'cancellation-versus-suspension loser did not finish before timeout';
  end if;
  insert into issue25_seller_cancel_outcomes
  select result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform result from extensions.dblink_get_result(loser) as t(result jsonb);
  perform extensions.dblink_exec(loser, 'commit');
end;
$$;
select is((select count(*)::integer from issue25_seller_cancel_outcomes), 2,
  'both seller-cancellation race sessions finish without deadlock or timeout');
select ok((select count(*) = 1 and bool_and((result ->> 'ok')::boolean)
  from issue25_seller_cancel_outcomes where result ->> 'action' = 'moderate'),
  'profile suspension succeeds around seller cancellation');
select ok((select count(*) = 1 and bool_and((result ->> 'ok')::boolean or (
    result ->> 'sqlstate' = '42501' and result ->> 'message' = 'active beta membership is required'
  )) from issue25_seller_cancel_outcomes where result ->> 'action' = 'cancel'),
  'seller cancellation commits first or rejects the subsequently inactive seller');
select ok(
  (select is_suspended from public.profiles where id = '35111111-1111-4111-8111-111111111111')
  and (select status = 'resolved' from public.reports where id = '39f00001-0000-4000-8000-000000000001')
  and (select status = 'blocked' from public.conversations where id = '38000001-0000-4000-8000-000000000001')
  and (select case when exists (
      select 1 from issue25_seller_cancel_outcomes
      where result ->> 'action' = 'cancel' and (result ->> 'ok')::boolean
    ) then d.status = 'cancelled'
      and d.cancelled_by = '35111111-1111-4111-8111-111111111111'
      and d.cancellation_reason = 'Concurrent cancellation'
      and (select status = 'paused' from public.listings where id = '35000001-0000-4000-8000-000000000001')
      and (select count(*) = 1 from public.notifications where kind = 'deal_cancelled' and data ->> 'dealId' = d.id::text)
      and (select count(*) = 0 from public.deal_listing_locks where deal_id = d.id)
    else d.status = 'disputed'
      and d.cancelled_at is null and d.cancelled_by is null and d.cancellation_reason is null
      and (select status = 'reserved' from public.listings where id = '35000001-0000-4000-8000-000000000001')
      and (select count(*) = 0 from public.notifications where data ->> 'dealId' = d.id::text)
      and (select count(*) = 1 from public.deal_listing_locks where deal_id = d.id)
    end from public.deals d where d.id = '37000001-0000-4000-8000-000000000001'),
  'cancellation-versus-suspension preserves a consistent cancelled-or-disputed state'
);

-- Queue report-bound listing removal before seller completion at the same
-- controller-held listing row. Releasing the controller proves that moderation
-- commits first and completion observes, but does not overwrite, that state.
set session_replication_role = replica;
delete from public.notification_email_deliveries d using public.notifications n
where d.notification_id = n.id
  and (
    n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001'
    or n.data ->> 'reportId' = '39c00001-0000-4000-8000-000000000001'
  );
delete from public.notifications
where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001'
   or data ->> 'reportId' = '39c00001-0000-4000-8000-000000000001';
delete from public.moderation_audit
where report_id = '39c00001-0000-4000-8000-000000000001';
delete from public.reports
where id = '39c00001-0000-4000-8000-000000000001';
delete from public.reviews
where deal_id = '37000001-0000-4000-8000-000000000001';
update public.profiles
set completed_deals_count = 0,
    is_suspended = false
where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222'
);
update public.listings
set status = 'reserved', completed_at = null
where id = '35000001-0000-4000-8000-000000000001';
update public.conversations
set status = 'open'
where id = '38000001-0000-4000-8000-000000000001';
update public.deals
set status = 'pending_confirmation',
    completed_at = null,
    cancelled_at = null,
    cancelled_by = null,
    cancellation_reason = null,
    disputed_at = null
where id = '37000001-0000-4000-8000-000000000001';
insert into public.deal_listing_locks (listing_id, deal_id, item_role) values (
  '35000001-0000-4000-8000-000000000001',
  '37000001-0000-4000-8000-000000000001',
  'target'
) on conflict (listing_id) do update
set deal_id = excluded.deal_id,
    item_role = excluded.item_role;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, status, assigned_to
) values (
  '39c00001-0000-4000-8000-000000000001',
  '35222222-2222-4222-8222-222222222222',
  'listing',
  '35000001-0000-4000-8000-000000000001',
  'counterfeit_suspected',
  'Committed listing moderation before completion concurrency fixture',
  'investigating',
  '35444444-4444-4444-8444-444444444444'
);
set session_replication_role = origin;

create temp table issue25_listing_moderation_barrier (
  moderation_waiting boolean not null,
  both_waiting boolean not null,
  lock_waiters integer not null
);
insert into issue25_listing_moderation_barrier values (false, false, 0);
create temp table issue25_listing_moderation_outcomes (result jsonb not null);

select extensions.dblink_exec('issue25_controller', 'begin');
select * from extensions.dblink(
  'issue25_controller',
  $$select id::text from public.listings where id = '35000001-0000-4000-8000-000000000001' for update$$
) as locked(id text);
select extensions.dblink_exec('issue25_cancel', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';
  set local "request.jwt.claim.sub" = '35444444-4444-4444-8444-444444444444'$$);
select extensions.dblink_send_query(
  'issue25_cancel',
  $$select private.issue25_catch_listing_moderation(
    '39c00001-0000-4000-8000-000000000001',
    '35000001-0000-4000-8000-000000000001'
  )$$
);
do $$
declare
  attempt integer;
  moderation_is_waiting boolean := false;
begin
  for attempt in 1..400 loop
    select exists (
      select 1
      from pg_stat_activity activity
      join issue25_sessions session on session.pid = activity.pid
      where session.actor = 'cancel'
        and activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and exists (
          select 1 from pg_locks actor_lock
          where actor_lock.pid = activity.pid and not actor_lock.granted
        )
    ) into moderation_is_waiting;
    exit when moderation_is_waiting;
    perform pg_sleep(0.025);
  end loop;
  update issue25_listing_moderation_barrier
  set moderation_waiting = moderation_is_waiting;
end;
$$;
select ok(
  (select moderation_waiting from issue25_listing_moderation_barrier),
  'report-bound listing removal is queued first at the controller-held listing row'
);

select extensions.dblink_exec('issue25_complete', $$begin;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"35111111-1111-4111-8111-111111111111","role":"authenticated"}';
  set local "request.jwt.claim.sub" = '35111111-1111-4111-8111-111111111111'$$);
select extensions.dblink_send_query(
  'issue25_complete',
  $$select private.issue25_catch_lifecycle('complete', '37000001-0000-4000-8000-000000000001')$$
);
do $$
declare
  attempt integer;
  waiter_count integer := 0;
begin
  for attempt in 1..400 loop
    select count(*)::integer into waiter_count
    from pg_stat_activity activity
    join issue25_sessions session on session.pid = activity.pid
    where session.actor in ('complete', 'cancel')
      and activity.state = 'active'
      and activity.wait_event_type = 'Lock'
      and exists (
        select 1 from pg_locks actor_lock
        where actor_lock.pid = activity.pid and not actor_lock.granted
      );
    exit when waiter_count = 2;
    perform pg_sleep(0.025);
  end loop;
  update issue25_listing_moderation_barrier
  set both_waiting = waiter_count = 2,
      lock_waiters = waiter_count;
end;
$$;
select ok(
  (select both_waiting and lock_waiters = 2 from issue25_listing_moderation_barrier),
  'staff removal and seller completion overlap at the same listing-row barrier'
);

select extensions.dblink_exec('issue25_controller', 'commit');
do $$
declare
  attempt integer;
begin
  for attempt in 1..400 loop
    exit when extensions.dblink_is_busy('issue25_cancel') = 0
      and extensions.dblink_is_busy('issue25_complete') = 1;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy('issue25_cancel') <> 0
     or extensions.dblink_is_busy('issue25_complete') <> 1 then
    raise exception 'queued listing moderation did not finish first before timeout';
  end if;

  insert into issue25_listing_moderation_outcomes
  select result from extensions.dblink_get_result('issue25_cancel') as t(result jsonb);
  perform result from extensions.dblink_get_result('issue25_cancel') as t(result jsonb);
  perform extensions.dblink_exec('issue25_cancel', 'commit');

  for attempt in 1..400 loop
    exit when extensions.dblink_is_busy('issue25_complete') = 0;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy('issue25_complete') <> 0 then
    raise exception 'seller completion did not finish after moderation committed';
  end if;
  insert into issue25_listing_moderation_outcomes
  select result from extensions.dblink_get_result('issue25_complete') as t(result jsonb);
  perform result from extensions.dblink_get_result('issue25_complete') as t(result jsonb);
  perform extensions.dblink_exec('issue25_complete', 'commit');
end;
$$;

select ok(
  (select count(*) = 2
     and count(*) filter (where result ->> 'action' = 'moderate_listing') = 1
     and count(*) filter (where result ->> 'action' = 'complete') = 1
     and bool_and((result ->> 'ok')::boolean)
   from issue25_listing_moderation_outcomes),
  'both ordered operations finish successfully without deadlock'
);
select ok(
  (select status = 'completed' from public.deals where id = '37000001-0000-4000-8000-000000000001')
  and (select status = 'removed' from public.listings where id = '35000001-0000-4000-8000-000000000001')
  and (select count(*) = 2
         and count(*) filter (where action = 'content_removed') = 1
         and count(*) filter (where action = 'report_resolved') = 1
       from public.moderation_audit where report_id = '39c00001-0000-4000-8000-000000000001'),
  'moderation commits first, the deal completes, and the listing remains removed'
);
select ok(
  (select count(*) = 2 and min(completed_deals_count) = 1 and max(completed_deals_count) = 1
   from public.profiles
   where id in ('35111111-1111-4111-8111-111111111111', '35222222-2222-4222-8222-222222222222'))
  and (select count(*) = 2 and count(distinct dedupe_key) = 2
       from public.notifications
       where kind = 'deal_completed'
         and data ->> 'dealId' = '37000001-0000-4000-8000-000000000001')
  and has_function_privilege('authenticated', 'public.complete_deal(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.complete_deal(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.complete_deal(uuid)', 'execute'),
  'ordered completion preserves counters, notifications, and the existing execute boundary'
);
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"35222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select set_config('request.jwt.claim.sub', '35222222-2222-4222-8222-222222222222', false);
select lives_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('37000001-0000-4000-8000-000000000001', '35222222-2222-4222-8222-222222222222', '35111111-1111-4111-8111-111111111111', 5)$$,
  'review eligibility remains available after ordered moderation and completion'
);
reset role;
set role postgres;

select extensions.dblink_disconnect('issue25_controller');
select extensions.dblink_disconnect('issue25_complete');
select extensions.dblink_disconnect('issue25_cancel');
drop function private.issue25_catch_lifecycle(text, uuid);
drop function private.issue25_catch_profile_moderation(uuid, uuid);
drop function private.issue25_catch_deal_resolution(uuid, uuid);
drop function private.issue25_catch_listing_moderation(uuid, uuid);

set session_replication_role = replica;
delete from public.beta_auth_events where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
create temp table issue25_cleanup_report_notification_ids as
select id from public.notifications where data ->> 'reportId' in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.moderation_audit where report_id in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries
where notification_id in (select id from issue25_cleanup_report_notification_ids);
delete from public.notifications where id in (select id from issue25_cleanup_report_notification_ids);
delete from public.reports where id in (
  '39c00001-0000-4000-8000-000000000001',
  '39d00001-0000-4000-8000-000000000001',
  '39f00001-0000-4000-8000-000000000001'
);
delete from public.notification_email_deliveries d
using public.notifications n
where d.notification_id = n.id
  and n.data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.notifications
where data ->> 'dealId' = '37000001-0000-4000-8000-000000000001';
delete from public.reviews where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deal_confirmations where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deal_listing_locks where deal_id = '37000001-0000-4000-8000-000000000001';
delete from public.deals where id = '37000001-0000-4000-8000-000000000001';
delete from public.conversation_members where conversation_id = '38000001-0000-4000-8000-000000000001';
delete from public.conversations where id = '38000001-0000-4000-8000-000000000001';
delete from public.offers where id = '36000001-0000-4000-8000-000000000001';
delete from public.listings where id = '35000001-0000-4000-8000-000000000001';
delete from public.brands where id = '35999999-9999-4999-8999-999999999999';
delete from public.beta_consent_events where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from public.beta_memberships where profile_id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from public.beta_invites where id in (
  '35511111-1111-4111-8111-111111111111',
  '35522222-2222-4222-8222-222222222222',
  '35544444-4444-4444-8444-444444444444'
);
delete from public.profiles where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
delete from auth.users where id in (
  '35111111-1111-4111-8111-111111111111',
  '35222222-2222-4222-8222-222222222222',
  '35444444-4444-4444-8444-444444444444'
);
set session_replication_role = origin;

select is(
  (select count(*)::integer from public.profiles where id in (
    '35111111-1111-4111-8111-111111111111',
    '35222222-2222-4222-8222-222222222222',
    '35444444-4444-4444-8444-444444444444'
  )),
  0,
  'committed concurrency cleanup removes both fixture profiles'
);
select is(
  (select count(*)::integer from auth.users where id in (
    '35111111-1111-4111-8111-111111111111',
    '35222222-2222-4222-8222-222222222222',
    '35444444-4444-4444-8444-444444444444'
  )),
  0,
  'committed concurrency cleanup removes both fixture Auth users'
);
select is(
  (select count(*)::integer from public.beta_auth_events where profile_id in (
    '35111111-1111-4111-8111-111111111111',
    '35222222-2222-4222-8222-222222222222',
    '35444444-4444-4444-8444-444444444444'
  )),
  0,
  'committed concurrency cleanup removes fixture verification audit events'
);
select is(
  (select count(*)::integer from public.notifications where data ->> 'reportId' in (
    '39c00001-0000-4000-8000-000000000001',
    '39d00001-0000-4000-8000-000000000001',
    '39f00001-0000-4000-8000-000000000001'
  )),
  0,
  'committed concurrency cleanup removes fixture report notifications'
);
select is(
  (select count(*)::integer from public.notification_email_deliveries
   where notification_id in (select id from issue25_cleanup_report_notification_ids)),
  0,
  'committed concurrency cleanup removes fixture report delivery rows'
);
select is(
  (select count(*)::integer from public.reports where id = '39c00001-0000-4000-8000-000000000001')
  + (select count(*)::integer from public.moderation_audit where report_id = '39c00001-0000-4000-8000-000000000001'),
  0,
  'committed concurrency cleanup removes listing moderation report and audit residue'
);

select * from finish();

do $$
declare
  ownership_marker constant text := 'issue25:seller_deal_lifecycle_concurrency:test-owned:v1';
begin
  if (select test_owned from issue25_dblink_extension_state)
     and exists (
       select 1
       from pg_extension e
       where e.extname = 'dblink'
         and obj_description(e.oid, 'pg_extension') = ownership_marker
     )
  then
    execute 'drop extension dblink';
  end if;
end;
$$;
