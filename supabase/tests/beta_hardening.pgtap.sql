begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(81);

select ok(to_regclass('public.beta_invites') is not null, 'beta invites exist');
select ok(to_regclass('public.beta_memberships') is not null, 'beta memberships exist');
select ok(to_regclass('public.beta_consent_events') is not null, 'consent evidence exists');
select ok(to_regclass('public.beta_auth_events') is not null, 'auth evidence exists');

select ok(
  to_regprocedure('private.is_active_beta_user(uuid)') is not null,
  'arbitrary-user access predicate is private'
);
select ok(
  to_regprocedure('public.is_active_beta_user()') is not null,
  'self-only public access predicate exists'
);
select ok(
  to_regprocedure('public.is_active_beta_user(uuid)') is null,
  'public arbitrary-user predicate is absent'
);
select ok(
  not has_function_privilege('anon', 'public.is_active_beta_user()', 'execute'),
  'anon cannot probe beta access'
);
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot address private authorization helpers'
);
select ok(
  to_regprocedure('public.create_beta_invite(text,uuid,interval)') is not null,
  'invite creation requires an explicit admin actor'
);
select ok(
  to_regprocedure('public.create_beta_invite(text,interval)') is null,
  'unaudited invite creation overload is absent'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.create_beta_invite(text,uuid,interval)', 'execute'
  ),
  'authenticated clients cannot create beta invites directly'
);
select ok(
  has_function_privilege(
    'service_role', 'public.revoke_beta_invite(uuid)', 'execute'
  ),
  'service role can compensate a failed invite delivery'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.revoke_beta_invite(uuid)', 'execute'
  ),
  'authenticated clients cannot revoke beta invites directly'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon cannot select profiles'
);
select ok(
  not has_table_privilege('anon', 'public.brands', 'select'),
  'anon cannot select the catalog'
);
select ok(
  not has_table_privilege('anon', 'public.listings', 'select'),
  'anon cannot select listings'
);
select ok(
  not has_table_privilege('anon', 'public.listing_photos', 'select'),
  'anon cannot select image metadata'
);
select ok(
  not has_table_privilege('anon', 'public.public_profiles', 'select'),
  'anon cannot select the safe profile view'
);
select ok(
  has_table_privilege('anon', 'public.beta_legal_documents', 'select'),
  'anon can read current legal documents'
);

select ok(
  coalesce((
    select c.reloptions @> array['security_invoker=true', 'security_barrier=true']
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'public_profiles'
  ), false),
  'safe profile view is a security-invoker barrier'
);
select is(
  (
    select string_agg(a.attname, ',' order by a.attnum)
    from pg_attribute a
    where a.attrelid = 'public.public_profiles'::regclass
      and a.attnum > 0 and not a.attisdropped
  ),
  'id,username,city,bio,avatar_path,account_kind,is_merchant_verified,rating_average,rating_count,completed_deals_count,member_since',
  'safe profile view exposes only its documented columns'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.profiles', 'is_suspended', 'select'
  ),
  'suspension state is available only through the self access RPC'
);

select ok(
  not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.cmd = 'SELECT'
      and ('public'::name = any(p.roles) or 'anon'::name = any(p.roles))
      and coalesce(p.qual, '') like '%listing-images%'
  ),
  'no anonymous storage policy can read finalized listing images'
);
select ok(
  not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname in (
        'marketplace_listing_images_create',
        'marketplace_listing_images_delete'
      )
  ),
  'clients cannot create or delete finalized listing objects directly'
);
select ok(
  exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'marketplace_listing_quarantine_create'
      and p.roles = array['authenticated'::name]
      and coalesce(p.with_check, '') like '%is_active_beta_user%'
  ),
  'quarantine uploads are authenticated and beta-gated'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_listing_upload(uuid,text,text,text,integer,integer,integer)',
    'execute'
  ),
  'authenticated clients cannot finalize evidence'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.finalize_listing_upload(uuid,text,text,text,integer,integer,integer)',
    'execute'
  ),
  'service role can finalize evidence'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.moderation_audit'::regclass
      and tgname = 'moderation_audit_append_only'
      and not tgisinternal
  ),
  'moderation audit is append-only'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.catalog_sync_runs'::regclass
      and tgname = 'catalog_sync_runs_append_only'
      and not tgisinternal
  ),
  'catalog sync audit is append-only'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'aa_validate_deal_dispute_report'
      and not tgisinternal
  ),
  'direct deal-dispute reports cannot bypass the atomic workflow'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.open_deal_dispute(uuid,text)', 'execute'
  ),
  'participants can invoke the dispute workflow'
);
select ok(
  not has_function_privilege('anon', 'public.open_deal_dispute(uuid,text)', 'execute'),
  'anon cannot invoke the dispute workflow'
);
select ok(
  exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public'
      and i.indexname = 'reports_one_live_deal_dispute_idx'
      and i.indexdef like '%UNIQUE INDEX%'
      and i.indexdef like '%deal_dispute%'
  ),
  'only one live moderation case can represent a deal dispute'
);
select ok(
  to_regprocedure(
    'public.resolve_deal_dispute(uuid,uuid,deal_status,text)'
  ) is not null,
  'report-bound dispute resolution exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_deal_dispute(uuid,uuid,deal_status,text)',
    'execute'
  ),
  'authenticated staff can invoke dispute resolution'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.resolve_deal_dispute(uuid,uuid,deal_status,text)',
    'execute'
  ),
  'anon cannot invoke dispute resolution'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.resolve_deal_dispute(uuid,uuid,deal_status,text)',
    'execute'
  ),
  'service role cannot bypass the assigned staff actor requirement'
);
select ok(
  (
    select pg_get_functiondef(
      'public.resolve_deal_dispute(uuid,uuid,deal_status,text)'::regprocedure
    ) like '%assigned investigating deal report is required%'
    and pg_get_functiondef(
      'public.resolve_deal_dispute(uuid,uuid,deal_status,text)'::regprocedure
    ) like '%delete from public.deal_confirmations%'
    and pg_get_functiondef(
      'public.resolve_deal_dispute(uuid,uuid,deal_status,text)'::regprocedure
    ) like '%update public.conversations%'
  ),
  'resolution enforces assignment and atomically unwinds deal state'
);
select ok(
  to_regprocedure(
    'public.review_merchant_application(uuid,merchant_application_status,text)'
  ) is not null,
  'merchant review has a guarded RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.review_merchant_application(uuid,merchant_application_status,text)',
    'execute'
  ),
  'authenticated staff can invoke merchant review'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.review_merchant_application(uuid,merchant_application_status,text)',
    'execute'
  ),
  'anon cannot invoke merchant review'
);
select ok(
  not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'merchant_applications'
      and p.policyname = 'merchant_staff_review'
  ),
  'staff cannot bypass the merchant review RPC with table updates'
);

select ok(
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'notifications'
      and c.column_name = 'dedupe_key'
  ),
  'notifications carry a deterministic de-duplication key'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'delete'),
  'notification event records cannot be deleted by clients'
);
select is(
  (
    select count(*)::integer from pg_trigger t
    where not t.tgisinternal and (
      (t.tgrelid = 'public.offers'::regclass and t.tgname = 'notify_offer_received')
      or (t.tgrelid = 'public.messages'::regclass and t.tgname = 'notify_message_received')
      or (t.tgrelid = 'public.deal_confirmations'::regclass and t.tgname = 'notify_deal_confirmation_needed')
      or (t.tgrelid = 'public.reviews'::regclass and t.tgname = 'notify_review_received')
      or (t.tgrelid = 'public.reports'::regclass and t.tgname in ('notify_report_created', 'notify_report_updated'))
      or (t.tgrelid = 'public.merchant_applications'::regclass and t.tgname in ('notify_merchant_application_staff', 'notify_merchant_application_owner'))
    )
  ),
  8,
  'all required in-app domain event triggers are installed'
);
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.notifications'::regclass
      and t.tgname = 'queue_notification_email_delivery'
      and not t.tgisinternal
  ),
  'every notification atomically queues its email delivery ledger row'
);
select ok(
  to_regclass('public.notification_email_deliveries') is not null,
  'content-free email delivery ledger exists'
);
select ok(
  not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'notification_email_deliveries'
      and c.column_name in ('recipient_email', 'email_address', 'title', 'body')
  ),
  'email ledger stores no recipient address or message content'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.notification_email_deliveries'::regclass
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like '%ON DELETE RESTRICT%'
  ),
  'email ledger retains notification audit identity'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.notification_email_deliveries', 'select'
  ),
  'users cannot read the email delivery ledger'
);
select ok(
  has_table_privilege(
    'service_role', 'public.notification_email_deliveries', 'select'
  ),
  'service role can inspect delivery state'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_notification_email_delivery(uuid,text)',
    'execute'
  ),
  'service role can claim delivery work'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_notification_email_delivery(uuid,text)',
    'execute'
  ),
  'users cannot claim delivery work'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mark_notification_email_sent(uuid,text,text)',
    'execute'
  ),
  'service role can finalize a sent email'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mark_notification_email_failed(uuid,text,text)',
    'execute'
  ),
  'service role can mark an email attempt failed'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.mark_notification_email_sent(uuid,text,text)',
    'execute'
  ),
  'anon cannot mutate email delivery state'
);

select ok(
  position(
    '''/messages?conversation=''' in pg_get_functiondef(
      'public.notify_message_received()'::regprocedure
    )
  ) > 0,
  'message notifications link to the messages conversation query'
);
select ok(
  position(
    '''/messages?conversation=''' in pg_get_functiondef(
      'public.normalize_notification_action_url()'::regprocedure
    )
  ) > 0,
  'accepted-offer notifications normalize to the messages conversation query'
);
select ok(
  position(
    '''/deals?highlight=''' in pg_get_functiondef(
      'public.notify_deal_confirmation_needed()'::regprocedure
    )
  ) > 0,
  'deal confirmation notifications link to the highlighted deal'
);
select ok(
  position(
    '''/deals?highlight=''' in pg_get_functiondef(
      'public.notify_review_received()'::regprocedure
    )
  ) > 0,
  'review notifications link to the review deal'
);
select ok(
  position(
    '''/admin?case=''' in pg_get_functiondef(
      'public.notify_report_created()'::regprocedure
    )
  ) > 0,
  'staff report notifications link to the admin case query'
);
select ok(
  position(
    '''/notifications''' in pg_get_functiondef(
      'public.notify_report_updated()'::regprocedure
    )
  ) > 0,
  'reporter updates link to the private notification inbox'
);
select ok(
  position(
    '''/merchant-application''' in pg_get_functiondef(
      'public.notify_merchant_application_owner()'::regprocedure
    )
  ) > 0,
  'merchant application updates link to the application route'
);

select ok(
  (
    select count(*) = 5
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'upload_cleanup_queue'
      and c.column_name in (
        'worker_request_id', 'claimed_at', 'attempts',
        'next_attempt_at', 'dead_lettered_at'
      )
  ),
  'cleanup queue records leases, attempts, retry time and dead-letter state'
);
select ok(
  to_regprocedure('public.claim_upload_cleanup(integer,text)') is not null,
  'bounded cleanup claim RPC exists'
);
select ok(
  to_regprocedure('public.complete_upload_cleanup(bigint,text)') is not null,
  'cleanup completion RPC exists'
);
select ok(
  to_regprocedure('public.fail_upload_cleanup(bigint,text,text)') is not null,
  'cleanup failure RPC exists'
);
select ok(
  to_regprocedure('public.mark_upload_cleanup_complete(bigint,text)') is null,
  'unleased legacy cleanup mutation RPC is removed'
);
select ok(
  has_function_privilege(
    'service_role', 'public.claim_upload_cleanup(integer,text)', 'execute'
  ),
  'service role can atomically claim cleanup work'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.claim_upload_cleanup(integer,text)', 'execute'
  ),
  'users cannot claim cleanup work'
);
select ok(
  has_function_privilege(
    'service_role', 'public.complete_upload_cleanup(bigint,text)', 'execute'
  ) and has_function_privilege(
    'service_role', 'public.fail_upload_cleanup(bigint,text,text)', 'execute'
  ),
  'service role can complete or fail its cleanup lease'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.complete_upload_cleanup(bigint,text)', 'execute'
  ) and not has_function_privilege(
    'authenticated', 'public.fail_upload_cleanup(bigint,text,text)', 'execute'
  ),
  'users cannot resolve cleanup leases'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.upload_cleanup_queue', 'select'
  ),
  'storage cleanup paths are not exposed to users'
);
select ok(
  not has_table_privilege(
    'service_role', 'public.upload_cleanup_queue', 'update'
  ),
  'service workers must mutate cleanup jobs through lease RPCs'
);
select ok(
  position(
    'FOR UPDATE SKIP LOCKED' in upper(pg_get_functiondef(
      'public.claim_upload_cleanup(integer,text)'::regprocedure
    ))
  ) > 0
  and position(
    'INTERVAL ''5 MINUTES''' in upper(pg_get_functiondef(
      'public.claim_upload_cleanup(integer,text)'::regprocedure
    ))
  ) > 0,
  'cleanup claims skip locked rows and reclaim stale five-minute leases'
);
select is(
  pg_get_function_result(
    'public.claim_upload_cleanup(integer,text)'::regprocedure
  ),
  'TABLE(queue_id bigint, bucket_id text, storage_path text, reason text, attempts integer, claimed_at timestamp with time zone)',
  'cleanup claim exposes the exact service worker payload'
);

select ok(
  not has_function_privilege('anon', 'public.search_catalog(text,integer)', 'execute'),
  'anon cannot search the catalog'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.search_listings(text,audience,segment[],deal_mode,text,integer,integer,integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'anon cannot search listings'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.run_beta_maintenance(integer)', 'execute'
  ),
  'authenticated clients cannot run maintenance'
);
select ok(
  has_function_privilege('service_role', 'public.run_beta_maintenance(integer)', 'execute'),
  'service role can run bounded maintenance'
);

select * from finish();
rollback;
