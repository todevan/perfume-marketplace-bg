begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(22);

create or replace function pg_temp.wait_for_backend_lock(
  target_pid integer,
  timeout interval default interval '2 seconds'
)
returns boolean
language plpgsql
set search_path = 'pg_catalog'
as $$
declare
  deadline timestamptz := clock_timestamp() + timeout;
begin
  loop
    if exists (
      select 1
      from pg_catalog.pg_stat_activity a
      where a.pid = target_pid
        and a.wait_event_type = 'Lock'
    ) then
      return true;
    end if;

    if clock_timestamp() >= deadline then
      return false;
    end if;

    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$$;

do $setup_connections$
declare
  connection_string text := pg_catalog.format(
    'host=%s port=%s dbname=%s user=postgres password=postgres sslmode=disable connect_timeout=2',
    pg_catalog.inet_server_addr(),
    pg_catalog.inet_server_port(),
    pg_catalog.current_database()
  );
begin
  -- Use the server address rather than loopback so the local HBA consumes the
  -- supplied test password; dblink rejects trusted non-password connections.
  perform extensions.dblink_connect('fixture', connection_string);
  perform extensions.dblink_connect('listing_locker', connection_string);
  perform extensions.dblink_connect('deal_rpc', connection_string);
  perform extensions.dblink_connect('self_block', connection_string);
end;
$setup_connections$;

do $fixture$
begin
  perform extensions.dblink_exec(
    'fixture',
    $fixture_sql$
      begin;

      set local session_replication_role = replica;
      delete from public.notification_email_deliveries
      where notification_id in (
        select id from public.notifications
        where profile_id in (
          '24111111-1111-4111-8111-111111111111',
          '24222222-2222-4222-8222-222222222222'
        )
      );
      delete from public.notifications
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.deals
      where id = '24544444-4444-4444-8444-444444444444';
      delete from public.conversations
      where id = '24533333-3333-4333-8333-333333333333';
      delete from public.offers
      where id = '24522222-2222-4222-8222-222222222222';
      delete from public.listings
      where id = '24511111-1111-4111-8111-111111111111';
      delete from public.brands
      where id = '24411111-1111-4111-8111-111111111111';
      delete from public.beta_consent_events
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.beta_memberships
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.beta_invites
      where id in (
        '24311111-1111-4111-8111-111111111111',
        '24322222-2222-4222-8222-222222222222'
      );
      set local session_replication_role = origin;
      delete from auth.users
      where id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );

      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values
      (
        '24111111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'concurrency-seller@example.test', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"username":"concurrency_seller"}'::jsonb,
        now(), now()
      ),
      (
        '24222222-2222-4222-8222-222222222222',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'concurrency-buyer@example.test', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"username":"concurrency_buyer"}'::jsonb,
        now(), now()
      );

      update public.profiles
      set email_verified_at = now(), phone_verified_at = now()
      where id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );

      insert into public.beta_invites (
        id, email, token_hash, status, expires_at
      ) values
      (
        '24311111-1111-4111-8111-111111111111',
        'concurrency-seller@example.test', repeat('4', 64), 'pending',
        now() + interval '7 days'
      ),
      (
        '24322222-2222-4222-8222-222222222222',
        'concurrency-buyer@example.test', repeat('5', 64), 'pending',
        now() + interval '7 days'
      );

      update public.beta_invites
      set status = 'accepted',
          accepted_by = case id
            when '24311111-1111-4111-8111-111111111111'
              then '24111111-1111-4111-8111-111111111111'::uuid
            else '24222222-2222-4222-8222-222222222222'::uuid
          end
      where id in (
        '24311111-1111-4111-8111-111111111111',
        '24322222-2222-4222-8222-222222222222'
      );

      insert into public.beta_memberships (
        profile_id, invite_id, status
      ) values
      (
        '24111111-1111-4111-8111-111111111111',
        '24311111-1111-4111-8111-111111111111',
        'pending'
      ),
      (
        '24222222-2222-4222-8222-222222222222',
        '24322222-2222-4222-8222-222222222222',
        'pending'
      );

      update public.beta_memberships
      set status = 'active', activated_at = now() - interval '1 second'
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );

      insert into public.beta_consent_events (
        profile_id, document_code, document_version, source
      )
      select fixture.profile_id, document.document_code,
             document.document_version, 'web'
      from (
        values
          ('24111111-1111-4111-8111-111111111111'::uuid),
          ('24222222-2222-4222-8222-222222222222'::uuid)
      ) as fixture(profile_id)
      cross join public.beta_legal_documents document
      where document.required_for_access
        and document.retired_at is null;

      insert into public.brands (
        id, canonical_name, slug, status, normalized_key
      ) values (
        '24411111-1111-4111-8111-111111111111',
        'Concurrency Brand', 'concurrency-brand', 'canonical',
        'concurrency brand'
      );

      set local session_replication_role = replica;

      insert into public.listings (
        id, seller_id, kind, deal_mode, product_format, audience, brand_id,
        fragrance_name, concentration, title, description, city,
        bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
        slug, activated_at, expires_at
      ) values (
        '24511111-1111-4111-8111-111111111111',
        '24111111-1111-4111-8111-111111111111',
        'offer', 'sale', 'retail_bottle', 'unisex',
        '24411111-1111-4111-8111-111111111111',
        'Concurrency Fragrance', 'EDP', 'Concurrency fixture',
        'Concurrent self-block contract fixture', 'Sofia',
        100, 90, false, 10000, 'reserved',
        'concurrency-listing-2451111111',
        now(), now() + interval '30 days'
      );

      insert into public.offers (
        id, listing_id, offerer_id, kind, cash_amount_minor,
        message, status, expires_at, responded_at
      ) values (
        '24522222-2222-4222-8222-222222222222',
        '24511111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222',
        'cash', 9000, 'concurrency fixture', 'accepted',
        now() + interval '7 days', now()
      );

      insert into public.conversations (
        id, listing_id, accepted_offer_id, status
      ) values (
        '24533333-3333-4333-8333-333333333333',
        '24511111-1111-4111-8111-111111111111',
        '24522222-2222-4222-8222-222222222222',
        'open'
      );

      insert into public.conversation_members (
        conversation_id, profile_id
      ) values
      (
        '24533333-3333-4333-8333-333333333333',
        '24111111-1111-4111-8111-111111111111'
      ),
      (
        '24533333-3333-4333-8333-333333333333',
        '24222222-2222-4222-8222-222222222222'
      );

      insert into public.deals (
        id, listing_id, accepted_offer_id, party_a_id, party_b_id, status
      ) values (
        '24544444-4444-4444-8444-444444444444',
        '24511111-1111-4111-8111-111111111111',
        '24522222-2222-4222-8222-222222222222',
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222',
        'pending_confirmation'
      );

      set local session_replication_role = origin;
      commit;
    $fixture_sql$
  );
end;
$fixture$;

do $configure_connections$
begin
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec(
    'listing_locker',
    $lock_listing$
      do $body$
      begin
        perform l.id
        from public.listings l
        where l.id = '24511111-1111-4111-8111-111111111111'
        for update;
      end;
      $body$;
    $lock_listing$
  );

  perform extensions.dblink_exec('deal_rpc', 'set role authenticated');
  perform extensions.dblink_exec(
    'deal_rpc',
    $claims$
      set request.jwt.claims =
        '{"sub":"24222222-2222-4222-8222-222222222222","role":"authenticated"}';
      set request.jwt.claim.sub =
        '24222222-2222-4222-8222-222222222222';
    $claims$
  );

  perform extensions.dblink_exec('self_block', 'set role authenticated');
  perform extensions.dblink_exec(
    'self_block',
    $claims$
      set request.jwt.claims =
        '{"sub":"24222222-2222-4222-8222-222222222222","role":"authenticated"}';
      set request.jwt.claim.sub =
        '24222222-2222-4222-8222-222222222222';
    $claims$
  );
end;
$configure_connections$;

create temp table concurrency_backend_pids (
  connection_name text primary key,
  backend_pid integer not null
) on commit drop;

insert into concurrency_backend_pids (connection_name, backend_pid)
select 'deal_rpc', pid
from extensions.dblink('deal_rpc', 'select pg_backend_pid()') as result(pid integer)
union all
select 'self_block', pid
from extensions.dblink('self_block', 'select pg_backend_pid()') as result(pid integer);

do $start_rpc$
begin
  if extensions.dblink_send_query(
    'deal_rpc',
    $rpc$
      select public.cancel_deal(
        '24544444-4444-4444-8444-444444444444',
        'concurrency guard'
      )
    $rpc$
  ) <> 1 then
    raise exception 'could not start cancel_deal concurrency probe';
  end if;
end;
$start_rpc$;

select ok(
  pg_temp.wait_for_backend_lock(
    (
      select backend_pid
      from concurrency_backend_pids
      where connection_name = 'deal_rpc'
    )
  ),
  'cancel_deal reaches the downstream listing lock after authorization'
);

do $start_self_block$
begin
  if extensions.dblink_send_query(
    'self_block',
    $block$
      update public.conversation_members
      set blocked_at = statement_timestamp()
      where conversation_id = '24533333-3333-4333-8333-333333333333'
        and profile_id = auth.uid()
    $block$
  ) <> 1 then
    raise exception 'could not start concurrent self-block probe';
  end if;
end;
$start_self_block$;

select ok(
  pg_temp.wait_for_backend_lock(
    (
      select backend_pid
      from concurrency_backend_pids
      where connection_name = 'self_block'
    )
  ),
  'a concurrent self-block waits for the authorized deal RPC to finish'
);

do $release_and_drain$
declare
  ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');

  select result into ignored
  from extensions.dblink_get_result('deal_rpc') as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);

  select result into ignored
  from extensions.dblink_get_result('self_block') as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$release_and_drain$;

-- Reuse the same isolated fixture for deterministic terminal-transition races.
-- A postgres-held deal lock makes both lifecycle calls wait before either can
-- observe or mutate state; releasing it then proves the row lock serializes the
-- competing outcomes.
do $reset_for_complete_cancel$
begin
  perform extensions.dblink_exec(
    'fixture',
    $reset$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries
      where notification_id in (
        select id from public.notifications
        where profile_id in (
          '24111111-1111-4111-8111-111111111111',
          '24222222-2222-4222-8222-222222222222'
        )
      );
      delete from public.notifications
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      update public.deals
      set status = 'pending_confirmation', completed_at = null,
          cancelled_at = null, cancelled_by = null, cancellation_reason = null
      where id = '24544444-4444-4444-8444-444444444444';
      update public.listings set status = 'reserved', completed_at = null
      where id = '24511111-1111-4111-8111-111111111111';
      update public.conversations set status = 'open'
      where id = '24533333-3333-4333-8333-333333333333';
      update public.conversation_members set blocked_at = null
      where conversation_id = '24533333-3333-4333-8333-333333333333';
      set local session_replication_role = origin;
      commit;
    $reset$
  );
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec(
    'listing_locker',
    $lock_deal$
      do $body$
      begin
        perform 1 from public.deals
        where id = '24544444-4444-4444-8444-444444444444'
        for update;
      end;
      $body$;
    $lock_deal$
  );
  perform extensions.dblink_exec('deal_rpc', 'reset role');
  perform extensions.dblink_exec('deal_rpc', 'set role authenticated');
  perform extensions.dblink_exec(
    'deal_rpc',
    $seller_claims$
      set request.jwt.claims =
        '{"sub":"24111111-1111-4111-8111-111111111111","role":"authenticated"}';
      set request.jwt.claim.sub =
        '24111111-1111-4111-8111-111111111111';
    $seller_claims$
  );
  perform extensions.dblink_exec('self_block', 'reset role');
  perform extensions.dblink_exec('self_block', 'set role authenticated');
  perform extensions.dblink_exec(
    'self_block',
    $buyer_claims$
      set request.jwt.claims =
        '{"sub":"24222222-2222-4222-8222-222222222222","role":"authenticated"}';
      set request.jwt.claim.sub =
        '24222222-2222-4222-8222-222222222222';
    $buyer_claims$
  );
end;
$reset_for_complete_cancel$;

select extensions.dblink_send_query(
  'deal_rpc',
  $$ select public.complete_deal('24544444-4444-4444-8444-444444444444')::text $$
);
select extensions.dblink_send_query(
  'self_block',
  $$ select public.cancel_deal('24544444-4444-4444-8444-444444444444', 'race cancellation') $$
);
select ok(
  pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'deal_rpc')),
  'complete_deal waits on the canonical deal lock in a complete-vs-cancel race'
);
select ok(
  pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'self_block')),
  'cancel_deal waits on the canonical deal lock in a complete-vs-cancel race'
);
do $drain_complete_cancel$
declare ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');
  select result into ignored from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  select result into ignored from extensions.dblink_get_result('self_block', false) as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$drain_complete_cancel$;
select ok(
  (select status in ('completed', 'cancelled') from public.deals where id = '24544444-4444-4444-8444-444444444444'),
  'complete-vs-cancel produces one valid terminal outcome'
);
select is(
  (
    select count(*) from public.notifications
    where kind in ('deal_completed', 'deal_cancelled')
      and data ->> 'dealId' = '24544444-4444-4444-8444-444444444444'
  ),
  case
    when (select status = 'completed' from public.deals where id = '24544444-4444-4444-8444-444444444444') then 2::bigint
    else 1::bigint
  end,
  'complete-vs-cancel emits side effects for only the serialized winner'
);

do $reset_for_duplicate_complete$
begin
  perform extensions.dblink_exec(
    'fixture',
    $reset$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries where notification_id in
        (select id from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444');
      delete from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444';
      update public.deals set status = 'pending_confirmation', completed_at = null,
        cancelled_at = null, cancelled_by = null, cancellation_reason = null
      where id = '24544444-4444-4444-8444-444444444444';
      update public.listings set status = 'reserved', completed_at = null
      where id = '24511111-1111-4111-8111-111111111111';
      update public.conversations set status = 'open'
      where id = '24533333-3333-4333-8333-333333333333';
      set local session_replication_role = origin;
      commit;
    $reset$
  );
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec(
    'listing_locker',
    $$ do $body$ begin perform 1 from public.deals where id = '24544444-4444-4444-8444-444444444444' for update; end; $body$; $$
  );
  perform extensions.dblink_exec('self_block', 'reset role');
  perform extensions.dblink_exec('self_block', 'set role authenticated');
  perform extensions.dblink_exec(
    'self_block',
    $$ set request.jwt.claims = '{"sub":"24111111-1111-4111-8111-111111111111","role":"authenticated"}'; set request.jwt.claim.sub = '24111111-1111-4111-8111-111111111111'; $$
  );
end;
$reset_for_duplicate_complete$;
select extensions.dblink_send_query('deal_rpc', $$ select public.complete_deal('24544444-4444-4444-8444-444444444444')::text $$);
select extensions.dblink_send_query('self_block', $$ select public.complete_deal('24544444-4444-4444-8444-444444444444')::text $$);
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'deal_rpc')), 'the first concurrent completion waits on the deal lock');
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'self_block')), 'the second concurrent completion waits on the deal lock');
do $drain_duplicate_complete$
declare ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');
  select result into ignored from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  select result into ignored from extensions.dblink_get_result('self_block', false) as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$drain_duplicate_complete$;
select is((select status::text from public.deals where id = '24544444-4444-4444-8444-444444444444'), 'completed', 'complete-vs-complete completes exactly once');
select is((select count(*) from public.notifications where kind = 'deal_completed' and data ->> 'dealId' = '24544444-4444-4444-8444-444444444444'), 2::bigint, 'complete-vs-complete emits one notification per participant');

do $reset_for_duplicate_cancel$
begin
  perform extensions.dblink_exec(
    'fixture',
    $reset$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries where notification_id in
        (select id from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444');
      delete from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444';
      update public.deals set status = 'pending_confirmation', completed_at = null,
        cancelled_at = null, cancelled_by = null, cancellation_reason = null
      where id = '24544444-4444-4444-8444-444444444444';
      update public.listings set status = 'reserved', completed_at = null
      where id = '24511111-1111-4111-8111-111111111111';
      update public.conversations set status = 'open'
      where id = '24533333-3333-4333-8333-333333333333';
      set local session_replication_role = origin;
      commit;
    $reset$
  );
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec('listing_locker', $$ do $body$ begin perform 1 from public.deals where id = '24544444-4444-4444-8444-444444444444' for update; end; $body$; $$);
  perform extensions.dblink_exec('self_block', 'reset role');
  perform extensions.dblink_exec('self_block', 'set role authenticated');
  perform extensions.dblink_exec(
    'self_block',
    $$ set request.jwt.claims = '{"sub":"24222222-2222-4222-8222-222222222222","role":"authenticated"}'; set request.jwt.claim.sub = '24222222-2222-4222-8222-222222222222'; $$
  );
end;
$reset_for_duplicate_cancel$;
select extensions.dblink_send_query('deal_rpc', $$ select public.cancel_deal('24544444-4444-4444-8444-444444444444', 'seller race cancellation') $$);
select extensions.dblink_send_query('self_block', $$ select public.cancel_deal('24544444-4444-4444-8444-444444444444', 'buyer race cancellation') $$);
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'deal_rpc')), 'the first concurrent cancellation waits on the deal lock');
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'self_block')), 'the second concurrent cancellation waits on the deal lock');
do $drain_duplicate_cancel$
declare ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');
  select result into ignored from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  select result into ignored from extensions.dblink_get_result('self_block', false) as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$drain_duplicate_cancel$;
select is((select status::text from public.deals where id = '24544444-4444-4444-8444-444444444444'), 'cancelled', 'cancel-vs-cancel cancels exactly once');
select is((select count(*) from public.notifications where kind = 'deal_cancelled' and data ->> 'dealId' = '24544444-4444-4444-8444-444444444444'), 1::bigint, 'cancel-vs-cancel emits exactly one counterparty notification');

do $reset_for_completion_moderation$
begin
  perform extensions.dblink_exec(
    'fixture',
    $$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries where notification_id in
        (select id from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444');
      delete from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444';
      update public.deals set status = 'pending_confirmation', completed_at = null,
        cancelled_at = null, cancelled_by = null, cancellation_reason = null
      where id = '24544444-4444-4444-8444-444444444444';
      update public.listings set status = 'reserved', completed_at = null
      where id = '24511111-1111-4111-8111-111111111111';
      update public.conversations set status = 'open'
      where id = '24533333-3333-4333-8333-333333333333';
      set local session_replication_role = origin;
      commit;
    $$
  );
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec('listing_locker', $$ do $body$ begin perform 1 from public.listings where id = '24511111-1111-4111-8111-111111111111' for update; end; $body$; $$);
  perform extensions.dblink_exec('deal_rpc', 'reset role');
  perform extensions.dblink_exec('deal_rpc', 'set role authenticated');
  perform extensions.dblink_exec('deal_rpc', $$ set request.jwt.claims = '{"sub":"24111111-1111-4111-8111-111111111111","role":"authenticated"}'; set request.jwt.claim.sub = '24111111-1111-4111-8111-111111111111'; $$);
  perform extensions.dblink_exec('self_block', 'reset role');
end;
$reset_for_completion_moderation$;
select extensions.dblink_send_query('deal_rpc', $$ select public.complete_deal('24544444-4444-4444-8444-444444444444')::text $$);
select extensions.dblink_send_query('self_block', $$ update public.listings set status = 'removed' where id = '24511111-1111-4111-8111-111111111111' $$);
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'deal_rpc')), 'completion reaches the listing lock in a lifecycle-vs-moderation race');
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'self_block')), 'moderation waits on the same listing lock as completion');
do $drain_completion_moderation$
declare ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');
  select result into ignored from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  select result into ignored from extensions.dblink_get_result('self_block', false) as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$drain_completion_moderation$;
select is((select status::text from public.deals where id = '24544444-4444-4444-8444-444444444444'), 'completed', 'completion remains atomic when moderation races it');
select is((select status::text from public.listings where id = '24511111-1111-4111-8111-111111111111'), 'removed', 'moderation wins over completion listing restoration regardless of lock winner');

do $reset_for_cancellation_moderation$
begin
  perform extensions.dblink_exec(
    'fixture',
    $$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries where notification_id in
        (select id from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444');
      delete from public.notifications where data ->> 'dealId' = '24544444-4444-4444-8444-444444444444';
      update public.deals set status = 'pending_confirmation', completed_at = null,
        cancelled_at = null, cancelled_by = null, cancellation_reason = null
      where id = '24544444-4444-4444-8444-444444444444';
      update public.listings set status = 'reserved', completed_at = null
      where id = '24511111-1111-4111-8111-111111111111';
      update public.conversations set status = 'open'
      where id = '24533333-3333-4333-8333-333333333333';
      set local session_replication_role = origin;
      commit;
    $$
  );
  perform extensions.dblink_exec('listing_locker', 'begin');
  perform extensions.dblink_exec('listing_locker', $$ do $body$ begin perform 1 from public.listings where id = '24511111-1111-4111-8111-111111111111' for update; end; $body$; $$);
  perform extensions.dblink_exec('deal_rpc', 'reset role');
  perform extensions.dblink_exec('deal_rpc', 'set role authenticated');
  perform extensions.dblink_exec('deal_rpc', $$ set request.jwt.claims = '{"sub":"24222222-2222-4222-8222-222222222222","role":"authenticated"}'; set request.jwt.claim.sub = '24222222-2222-4222-8222-222222222222'; $$);
  perform extensions.dblink_exec('self_block', 'reset role');
end;
$reset_for_cancellation_moderation$;
select extensions.dblink_send_query('deal_rpc', $$ select public.cancel_deal('24544444-4444-4444-8444-444444444444', 'moderation race cancellation') $$);
select extensions.dblink_send_query('self_block', $$ update public.listings set status = 'removed' where id = '24511111-1111-4111-8111-111111111111' $$);
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'deal_rpc')), 'cancellation reaches the listing lock in a lifecycle-vs-moderation race');
select ok(pg_temp.wait_for_backend_lock((select backend_pid from concurrency_backend_pids where connection_name = 'self_block')), 'moderation waits on the same listing lock as cancellation');
do $drain_cancellation_moderation$
declare ignored text;
begin
  perform extensions.dblink_exec('listing_locker', 'commit');
  select result into ignored from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  perform * from extensions.dblink_get_result('deal_rpc', false) as completed(result text);
  select result into ignored from extensions.dblink_get_result('self_block', false) as completed(result text);
  perform * from extensions.dblink_get_result('self_block', false) as completed(result text);
end;
$drain_cancellation_moderation$;
select is((select status::text from public.deals where id = '24544444-4444-4444-8444-444444444444'), 'cancelled', 'cancellation remains atomic when moderation races it');
select is((select status::text from public.listings where id = '24511111-1111-4111-8111-111111111111'), 'removed', 'moderation wins over cancellation listing restoration regardless of lock winner');

do $cleanup$
begin
  perform extensions.dblink_exec(
    'fixture',
    $cleanup_sql$
      begin;
      set local session_replication_role = replica;
      delete from public.notification_email_deliveries
      where notification_id in (
        select id from public.notifications
        where profile_id in (
          '24111111-1111-4111-8111-111111111111',
          '24222222-2222-4222-8222-222222222222'
        )
      );
      delete from public.notifications
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.deals
      where id = '24544444-4444-4444-8444-444444444444';
      delete from public.conversations
      where id = '24533333-3333-4333-8333-333333333333';
      delete from public.offers
      where id = '24522222-2222-4222-8222-222222222222';
      delete from public.listings
      where id = '24511111-1111-4111-8111-111111111111';
      delete from public.brands
      where id = '24411111-1111-4111-8111-111111111111';
      delete from public.beta_consent_events
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.beta_memberships
      where profile_id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      delete from public.beta_invites
      where id in (
        '24311111-1111-4111-8111-111111111111',
        '24322222-2222-4222-8222-222222222222'
      );
      set local session_replication_role = origin;
      delete from auth.users
      where id in (
        '24111111-1111-4111-8111-111111111111',
        '24222222-2222-4222-8222-222222222222'
      );
      commit;
    $cleanup_sql$
  );

  perform extensions.dblink_disconnect('self_block');
  perform extensions.dblink_disconnect('deal_rpc');
  perform extensions.dblink_disconnect('listing_locker');
  perform extensions.dblink_disconnect('fixture');
end;
$cleanup$;

select * from finish();
rollback;
