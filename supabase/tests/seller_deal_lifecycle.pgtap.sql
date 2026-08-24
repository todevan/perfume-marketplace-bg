begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(99);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('25111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deal-seller@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"deal_seller"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('25222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deal-buyer@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"deal_buyer"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('25333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deal-outsider@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"deal_outsider"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('25444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deal-staff@example.test', '', statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"deal_staff"}'::jsonb, statement_timestamp(), statement_timestamp());

update public.profiles
set email_verified_at = statement_timestamp(),
    city = 'Sofia',
    role = case when id = '25444444-4444-4444-8444-444444444444' then 'admin'::public.platform_role else role end
where id in (
  '25111111-1111-4111-8111-111111111111',
  '25222222-2222-4222-8222-222222222222',
  '25333333-3333-4333-8333-333333333333',
  '25444444-4444-4444-8444-444444444444'
);

insert into public.beta_invites (id, email, token_hash, status, expires_at) values
  ('25511111-1111-4111-8111-111111111111', 'deal-seller@example.test', repeat('1', 64), 'pending', statement_timestamp() + interval '7 days'),
  ('25522222-2222-4222-8222-222222222222', 'deal-buyer@example.test', repeat('2', 64), 'pending', statement_timestamp() + interval '7 days'),
  ('25533333-3333-4333-8333-333333333333', 'deal-outsider@example.test', repeat('3', 64), 'pending', statement_timestamp() + interval '7 days'),
  ('25544444-4444-4444-8444-444444444444', 'deal-staff@example.test', repeat('4', 64), 'pending', statement_timestamp() + interval '7 days');
update public.beta_invites i
set status = 'accepted', accepted_by = case i.id
  when '25511111-1111-4111-8111-111111111111' then '25111111-1111-4111-8111-111111111111'::uuid
  when '25522222-2222-4222-8222-222222222222' then '25222222-2222-4222-8222-222222222222'::uuid
  when '25533333-3333-4333-8333-333333333333' then '25333333-3333-4333-8333-333333333333'::uuid
  else '25444444-4444-4444-8444-444444444444'::uuid
end;
insert into public.beta_memberships (profile_id, invite_id, status) values
  ('25111111-1111-4111-8111-111111111111', '25511111-1111-4111-8111-111111111111', 'pending'),
  ('25222222-2222-4222-8222-222222222222', '25522222-2222-4222-8222-222222222222', 'pending'),
  ('25333333-3333-4333-8333-333333333333', '25533333-3333-4333-8333-333333333333', 'pending'),
  ('25444444-4444-4444-8444-444444444444', '25544444-4444-4444-8444-444444444444', 'pending');
update public.beta_memberships set status = 'active' where profile_id::text like '25%';
update public.beta_memberships set activated_at = statement_timestamp() - interval '1 second' where profile_id::text like '25%';
insert into public.beta_consent_events (profile_id, document_code, document_version, source)
select p.id, d.document_code, d.document_version, 'web'
from public.profiles p cross join public.beta_legal_documents d
where p.id::text like '25%' and d.required_for_access and d.retired_at is null;

insert into public.brands (id, canonical_name, slug, status, normalized_key)
values ('25999999-9999-4999-8999-999999999999', 'Deal Lifecycle Brand', 'deal-lifecycle-brand', 'canonical', 'deal lifecycle brand');

alter table public.listings disable trigger user;
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
)
select
  ('2500000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  '25111111-1111-4111-8111-111111111111', 'offer', 'sale', 'retail_bottle',
  'unisex', '25999999-9999-4999-8999-999999999999',
  'Lifecycle fragrance ' || fixture.n, 'EDP', 'Lifecycle listing ' || fixture.n,
  'Deterministic deal lifecycle fixture', 'Sofia', 100.0, 90.0, false, 4000,
  'reserved', 'deal-lifecycle-' || fixture.n, statement_timestamp(),
  statement_timestamp() + interval '60 days'
from generate_series(0, 11) as fixture(n);
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
)
select
  ('250000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  '25111111-1111-4111-8111-111111111111', 'offer', 'sale', 'retail_bottle',
  'unisex', '25999999-9999-4999-8999-999999999999',
  'Lifecycle moderation fragrance ' || fixture.n, 'EDP', 'Lifecycle moderation listing ' || fixture.n,
  'Deterministic completion and moderation fixture', 'Sofia', 100.0, 90.0, false, 4000,
  'reserved', 'deal-lifecycle-moderation-' || fixture.n, statement_timestamp(),
  statement_timestamp() + interval '60 days'
from generate_series(12, 15) as fixture(n);
alter table public.listings enable trigger user;

alter table public.offers disable trigger user;
insert into public.offers (
  id, listing_id, offerer_id, kind, cash_amount_minor, status, expires_at, responded_at
)
select
  ('2600000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  ('2500000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  '25222222-2222-4222-8222-222222222222', 'cash', 3500, 'accepted',
  statement_timestamp() + interval '7 days', statement_timestamp()
from generate_series(0, 11) as fixture(n);
insert into public.offers (
  id, listing_id, offerer_id, kind, cash_amount_minor, status, expires_at, responded_at
)
select
  ('260000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  ('250000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  '25222222-2222-4222-8222-222222222222', 'cash', 3500, 'accepted',
  statement_timestamp() + interval '7 days', statement_timestamp()
from generate_series(12, 15) as fixture(n);
alter table public.offers enable trigger user;

alter table public.conversations disable trigger user;
insert into public.conversations (id, listing_id, accepted_offer_id, status)
select
  ('2800000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  ('2500000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  ('2600000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  'open'
from generate_series(0, 11) as fixture(n);
insert into public.conversations (id, listing_id, accepted_offer_id, status)
select
  ('280000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  ('250000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  ('260000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  'open'
from generate_series(12, 15) as fixture(n);
alter table public.conversations enable trigger user;

alter table public.deals disable trigger user;
insert into public.deals (
  id, listing_id, accepted_offer_id, party_a_id, party_b_id, status, disputed_at
)
select
  ('2700000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  ('2500000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  ('2600000' || to_hex(fixture.n) || '-0000-4000-8000-00000000000' || to_hex(fixture.n))::uuid,
  '25111111-1111-4111-8111-111111111111'::uuid,
  case when fixture.n in (8, 10, 11) then '25333333-3333-4333-8333-333333333333'::uuid else '25222222-2222-4222-8222-222222222222'::uuid end,
  case when fixture.n in (5, 8, 9, 10) then 'disputed'::public.deal_status else 'pending_confirmation'::public.deal_status end,
  case when fixture.n in (5, 8, 9, 10) then statement_timestamp() else null end
from generate_series(0, 11) as fixture(n);
insert into public.deals (
  id, listing_id, accepted_offer_id, party_a_id, party_b_id, status
)
select
  ('270000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  ('250000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  ('260000' || lpad(fixture.n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(fixture.n::text, 2, '0'))::uuid,
  '25111111-1111-4111-8111-111111111111',
  '25222222-2222-4222-8222-222222222222',
  'pending_confirmation'
from generate_series(12, 15) as fixture(n);
alter table public.deals enable trigger user;

alter table public.deal_confirmations disable trigger user;
insert into public.deal_confirmations (deal_id, profile_id)
values
  ('27000002-0000-4000-8000-000000000002', '25111111-1111-4111-8111-111111111111'),
  ('27000003-0000-4000-8000-000000000003', '25111111-1111-4111-8111-111111111111'),
  ('27000008-0000-4000-8000-000000000008', '25333333-3333-4333-8333-333333333333');
alter table public.deal_confirmations enable trigger user;

alter table public.reports disable trigger user;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, status, assigned_to
) values
  (
    '29000005-0000-4000-8000-000000000005',
    '25222222-2222-4222-8222-222222222222',
    'deal', '27000005-0000-4000-8000-000000000005', 'deal_dispute',
    'Disputed lifecycle fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29000008-0000-4000-8000-000000000008',
    '25111111-1111-4111-8111-111111111111',
    'deal', '27000008-0000-4000-8000-000000000008', 'deal_dispute',
    'Existing corrupted-deal moderation fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29f00001-0000-4000-8000-000000000001',
    '25111111-1111-4111-8111-111111111111',
    'profile', '25333333-3333-4333-8333-333333333333', 'profile_abuse',
    'Profile moderation fixture for corrupted stored party regression', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29120000-0000-4000-8000-000000000012',
    '25222222-2222-4222-8222-222222222222',
    'listing', '25000012-0000-4000-8000-000000000012', 'counterfeit_suspected',
    'Remove before seller completion regression fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29130000-0000-4000-8000-000000000013',
    '25222222-2222-4222-8222-222222222222',
    'listing', '25000013-0000-4000-8000-000000000013', 'counterfeit_suspected',
    'Reject before seller completion regression fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29140000-0000-4000-8000-000000000014',
    '25222222-2222-4222-8222-222222222222',
    'listing', '25000014-0000-4000-8000-000000000014', 'misleading_content',
    'Pause before seller completion regression fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  ),
  (
    '29150000-0000-4000-8000-000000000015',
    '25222222-2222-4222-8222-222222222222',
    'listing', '25000015-0000-4000-8000-000000000015', 'counterfeit_suspected',
    'Remove after seller completion regression fixture', 'investigating',
    '25444444-4444-4444-8444-444444444444'
  );
alter table public.reports enable trigger user;

alter table public.notifications disable trigger normalize_legacy_deal_notification;
insert into public.notifications (
  id, profile_id, kind, title, body, action_url, data, dedupe_key
) values
  (
    '25a00001-0000-4000-8000-000000000001',
    '25111111-1111-4111-8111-111111111111',
    'deal_confirmation_needed', 'Old confirmation title', 'Old mutual confirmation body',
    '/deals?highlight=27000002-0000-4000-8000-000000000002',
    '{"dealId":"27000002-0000-4000-8000-000000000002","confirmedBy":"25222222-2222-4222-8222-222222222222"}'::jsonb,
    'legacy-lifecycle:test:pending'
  ),
  (
    '25a00002-0000-4000-8000-000000000002',
    '25222222-2222-4222-8222-222222222222',
    'deal_confirmation_needed', 'Old sent title', 'Already sent legacy message',
    '/deals?highlight=27000002-0000-4000-8000-000000000002',
    '{"dealId":"27000002-0000-4000-8000-000000000002"}'::jsonb,
    'legacy-lifecycle:test:sent'
  ),
  (
    '25a00003-0000-4000-8000-000000000003',
    '25222222-2222-4222-8222-222222222222',
    'deal_confirmation_needed', 'Old failed title', 'Retryable legacy message',
    '/deals?highlight=27000002-0000-4000-8000-000000000002',
    '{"dealId":"27000002-0000-4000-8000-000000000002"}'::jsonb,
    'legacy-lifecycle:test:failed'
  );
alter table public.notifications enable trigger normalize_legacy_deal_notification;

insert into public.notification_email_deliveries (
  notification_id, status, attempts, updated_at
) values (
  '25a00001-0000-4000-8000-000000000001', 'pending', 0, statement_timestamp()
)
on conflict (notification_id) do update set
  status = excluded.status,
  attempts = excluded.attempts,
  worker_request_id = null,
  provider_message_id = null,
  last_error_code = null,
  claimed_at = null,
  last_attempt_at = null,
  sent_at = null,
  failed_at = null,
  updated_at = excluded.updated_at;

insert into public.notification_email_deliveries (
  notification_id, status, attempts, worker_request_id, provider_message_id,
  claimed_at, last_attempt_at, sent_at, updated_at
) values (
  '25a00002-0000-4000-8000-000000000002', 'sent', 1, 'legacy-sent-worker',
  'legacy-provider-message', statement_timestamp(), statement_timestamp(),
  statement_timestamp(), statement_timestamp()
)
on conflict (notification_id) do update set
  status = excluded.status,
  attempts = excluded.attempts,
  worker_request_id = excluded.worker_request_id,
  provider_message_id = excluded.provider_message_id,
  last_error_code = null,
  claimed_at = excluded.claimed_at,
  last_attempt_at = excluded.last_attempt_at,
  sent_at = excluded.sent_at,
  failed_at = null,
  updated_at = excluded.updated_at;

insert into public.notification_email_deliveries (
  notification_id, status, attempts, worker_request_id, last_error_code,
  claimed_at, last_attempt_at, failed_at, updated_at
) values (
  '25a00003-0000-4000-8000-000000000003', 'failed', 1, 'legacy-failed-worker',
  'provider_timeout', statement_timestamp(), statement_timestamp(),
  statement_timestamp(), statement_timestamp()
)
on conflict (notification_id) do update set
  status = excluded.status,
  attempts = excluded.attempts,
  worker_request_id = excluded.worker_request_id,
  provider_message_id = null,
  last_error_code = excluded.last_error_code,
  claimed_at = excluded.claimed_at,
  last_attempt_at = excluded.last_attempt_at,
  sent_at = null,
  failed_at = excluded.failed_at,
  updated_at = excluded.updated_at;

select private.reconcile_legacy_deal_notifications();

select ok(
  'deal_cancelled' = any(enum_range(null::public.notification_kind)::text[]),
  'deal cancellation is a notification contract value'
);
select ok(to_regprocedure('public.complete_deal(uuid)') is not null, 'seller completion RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.complete_deal(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.complete_deal(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.complete_deal(uuid)', 'execute'),
  'only authenticated users can invoke seller completion'
);
select ok(
  has_function_privilege('authenticated', 'public.cancel_deal(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.cancel_deal(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.cancel_deal(uuid,text)', 'execute'),
  'only authenticated users can invoke participant cancellation'
);
select ok(
  (select p.prosecdef and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where split_part(setting, '=', 1) = 'search_path'
      and btrim(split_part(setting, '=', 2), '"') = ''
  ) from pg_proc p where p.oid = 'public.complete_deal(uuid)'::regprocedure)
  and (select p.prosecdef and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where split_part(setting, '=', 1) = 'search_path'
      and btrim(split_part(setting, '=', 2), '"') = ''
  ) from pg_proc p where p.oid = 'public.cancel_deal(uuid,text)'::regprocedure),
  'deal lifecycle SECURITY DEFINER functions have an empty search path'
);
select ok(to_regprocedure('public.confirm_deal(uuid)') is null, 'legacy confirmation RPC is absent');
select ok(not has_table_privilege('authenticated', 'public.deal_confirmations', 'insert'), 'authenticated clients cannot insert confirmations');
select is(
  (select count(*)::integer from pg_trigger where tgrelid = 'public.deal_confirmations'::regclass and not tgisinternal),
  1,
  'only the active-membership write guard remains on historical confirmations'
);
select ok(
  position('order by l.id' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure))) > 0
  and position('order by l.id' in lower(pg_get_functiondef('public.cancel_deal(uuid,text)'::regprocedure))) > 0,
  'completion and cancellation lock involved listings deterministically'
);
select ok(
  'deal_confirmation_needed' = any(enum_range(null::public.notification_kind)::text[]),
  'historical confirmation notification values remain compatible'
);
select ok(
  (select p.prosecdef and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where split_part(setting, '=', 1) = 'search_path'
      and btrim(split_part(setting, '=', 2), '"') = ''
  ) from pg_proc p where p.oid = to_regprocedure('private.is_deal_identity_consistent(uuid,uuid,uuid,uuid,uuid)')),
  'deal identity predicate is SECURITY DEFINER with an empty search path'
);
select ok(
  (select position('private.is_deal_identity_consistent' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
      and position('is_active_beta_user' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
   from pg_policy p
   where p.polrelid = 'public.deals'::regclass
     and p.polname = 'deals_participant_read')
  and
  (select position('private.is_deal_identity_consistent' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
      and position('is_active_beta_user' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
   from pg_policy p
   where p.polrelid = 'public.deal_confirmations'::regclass
     and p.polname = 'deal_confirmations_participant_read')
  and exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deals'
  )
  and exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deal_confirmations'
  ),
  'Realtime-published deal reads require active membership and relational identity while retaining RLS enforcement'
);
select ok(
  position('private.is_deal_identity_consistent' in lower(pg_get_functiondef('public.open_deal_dispute(uuid,text)'::regprocedure))) > 0
  and position('private.is_deal_identity_consistent' in lower(pg_get_functiondef('public.resolve_deal_dispute(uuid,uuid,public.deal_status,text)'::regprocedure))) > 0
  and position('private.is_deal_identity_consistent' in lower(pg_get_functiondef('public.validate_report_insert()'::regprocedure))) > 0
  and position('private.is_deal_identity_consistent' in lower(pg_get_functiondef('public.validate_deal_dispute_report()'::regprocedure))) > 0
  and regexp_count(lower(pg_get_functiondef('public.moderate_profile(uuid,uuid,boolean,text)'::regprocedure)), 'private\.is_deal_identity_consistent') = 3
  and position('order by l.id' in lower(pg_get_functiondef('public.open_deal_dispute(uuid,text)'::regprocedure))) > 0
  and position('order by l.id' in lower(pg_get_functiondef('public.resolve_deal_dispute(uuid,uuid,public.deal_status,text)'::regprocedure))) > 0,
  'all active deal-adjacent dispute and moderation paths validate accepted-offer identity'
);
select ok(
  (select not p.prosecdef and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where split_part(setting, '=', 1) = 'search_path'
      and btrim(split_part(setting, '=', 2), '"') = ''
  ) from pg_proc p where p.oid = to_regprocedure('private.lock_profile_lifecycle(uuid,uuid)')),
  'profile lifecycle advisory helper is a fixed-path invoker function'
);
select ok(
  not coalesce((
    select bool_or(acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'private.lock_profile_lifecycle(uuid,uuid)'::regprocedure
  ), false)
  and not has_function_privilege('anon', 'private.lock_profile_lifecycle(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.lock_profile_lifecycle(uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.lock_profile_lifecycle(uuid,uuid)', 'execute'),
  'profile lifecycle advisory helper is migration-owner-only'
);
select ok(
  position('select distinct candidate.profile_id' in lower(pg_get_functiondef('private.lock_profile_lifecycle(uuid,uuid)'::regprocedure))) > 0
  and position('order by candidate.profile_id' in lower(pg_get_functiondef('private.lock_profile_lifecycle(uuid,uuid)'::regprocedure))) > 0
  and position('hashtextextended' in lower(pg_get_functiondef('private.lock_profile_lifecycle(uuid,uuid)'::regprocedure))) > 0
  and position('aromatika:profile-lifecycle:' in lower(pg_get_functiondef('private.lock_profile_lifecycle(uuid,uuid)'::regprocedure))) > 0,
  'profile lifecycle advisory helper sorts distinct profile UUIDs under a namespaced key'
);
select ok(
  position('select * into deal_snapshot' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure))) > 0
  and position('select * into deal_snapshot' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure)))
    < position('private.lock_profile_lifecycle' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure)))
  and position('private.lock_profile_lifecycle' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure)))
    < position('select * into deal_record' in lower(pg_get_functiondef('public.complete_deal(uuid)'::regprocedure)))
  and position('private.lock_profile_lifecycle' in lower(pg_get_functiondef('public.moderate_profile(uuid,uuid,boolean,text)'::regprocedure)))
    < position('order by d.id' in lower(pg_get_functiondef('public.moderate_profile(uuid,uuid,boolean,text)'::regprocedure)))
  and position('order by d.id' in lower(pg_get_functiondef('public.moderate_profile(uuid,uuid,boolean,text)'::regprocedure)))
    < position('select * into previous_profile' in lower(pg_get_functiondef('public.moderate_profile(uuid,uuid,boolean,text)'::regprocedure))),
  'completion and moderation acquire profile advisory locks before row locks'
);
select ok(
  (select position('private.is_deal_identity_consistent' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
      and position('is_active_beta_user' in lower(pg_get_expr(p.polqual, p.polrelid))) > 0
   from pg_policy p
   where p.polrelid = 'public.listings'::regclass
     and p.polname = 'listings_public_read'),
  'linked non-public listing reads require active membership and consistent deal identity'
);
select ok(
  (select not p.prosecdef and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
    where split_part(setting, '=', 1) = 'search_path'
      and btrim(split_part(setting, '=', 2), '"') = ''
  ) from pg_proc p where p.oid = to_regprocedure('private.reconcile_legacy_deal_notifications()'))
  and not has_function_privilege('anon', 'private.reconcile_legacy_deal_notifications()', 'execute')
  and not has_function_privilege('authenticated', 'private.reconcile_legacy_deal_notifications()', 'execute')
  and not has_function_privilege('service_role', 'private.reconcile_legacy_deal_notifications()', 'execute'),
  'legacy notification backfill is a fixed-path private migration-owner-only invoker helper'
);
select ok(
  (select status = 'archived'
      and read_at is not null
      and title = 'Продавачът приключва сделката'
      and body like '%продавача%'
      and not (data ? 'confirmedBy')
   from public.notifications
   where id = '25a00001-0000-4000-8000-000000000001'),
  'the production backfill rewrites and archives pre-migration confirmation notifications'
);
select is(
  (select count(*)::integer
   from public.notification_email_deliveries
   where notification_id in (
     '25a00001-0000-4000-8000-000000000001',
     '25a00003-0000-4000-8000-000000000003'
   )),
  0,
  'the production backfill removes pending and failed legacy delivery work'
);
select ok(
  (select status = 'sent'
      and provider_message_id = 'legacy-provider-message'
      and attempts = 1
   from public.notification_email_deliveries
   where notification_id = '25a00002-0000-4000-8000-000000000002'),
  'already-sent legacy delivery evidence is preserved'
);
insert into public.notification_email_deliveries (
  notification_id, status, attempts, worker_request_id, last_error_code,
  claimed_at, last_attempt_at, failed_at, updated_at
) values (
  '25a00003-0000-4000-8000-000000000003', 'failed', 1, 'legacy-failed-worker',
  'provider_timeout', statement_timestamp(), statement_timestamp(),
  statement_timestamp(), statement_timestamp()
)
on conflict (notification_id) do update set
  status = excluded.status,
  attempts = excluded.attempts,
  worker_request_id = excluded.worker_request_id,
  provider_message_id = null,
  last_error_code = excluded.last_error_code,
  claimed_at = excluded.claimed_at,
  last_attempt_at = excluded.last_attempt_at,
  sent_at = null,
  failed_at = excluded.failed_at,
  updated_at = excluded.updated_at;
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role"}', true);
select throws_ok(
  $$select public.claim_notification_email_delivery('25a00003-0000-4000-8000-000000000003', 'legacy-v1-retry-worker')$$,
  '42501', 'legacy deal confirmation email delivery is suppressed',
  'the legacy v1 claim endpoint cannot bypass durable suppression'
);
select throws_ok(
  $$select * from public.claim_notification_email_delivery_v2('25a00003-0000-4000-8000-000000000003', 'legacy-retry-worker')$$,
  '42501', 'legacy deal confirmation email delivery is suppressed',
  'retryable legacy email work is permanently excluded from claims'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select ok(
  (select count(*) = 1 from public.deals where id = '27000002-0000-4000-8000-000000000002')
  and (select count(*) = 1 from public.deal_confirmations where deal_id = '27000002-0000-4000-8000-000000000002'),
  'an active relationally valid participant can read their deal and historical confirmation'
);
select lives_ok(
  $$select public.complete_deal('27000001-0000-4000-8000-000000000001')$$,
  'the listing seller completes an accepted deal'
);
set local role postgres;
select ok(
  (select status = 'completed' from public.deals where id = '27000001-0000-4000-8000-000000000001')
  and (select status = 'completed' from public.listings where id = '25000001-0000-4000-8000-000000000001'),
  'seller completion atomically completes the deal and listing'
);
select is(
  (select sum(completed_deals_count)::integer from public.profiles where id in ('25111111-1111-4111-8111-111111111111', '25222222-2222-4222-8222-222222222222')),
  2,
  'seller completion increments both participant counters exactly once'
);
select is(
  (select count(*)::integer from public.notifications where data ->> 'dealId' = '27000001-0000-4000-8000-000000000001' and kind = 'deal_completed'),
  2,
  'seller completion creates one role-specific notification per participant'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.complete_deal('27000001-0000-4000-8000-000000000001')$$,
  '23514', 'only an active accepted deal can be completed',
  'duplicate seller completion fails closed'
);

select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$select public.complete_deal('27000002-0000-4000-8000-000000000002')$$,
  '42501', 'only the listing seller can complete this deal',
  'the buyer cannot complete the deal'
);
select set_config('request.jwt.claims', '{"sub":"25333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.complete_deal('27000002-0000-4000-8000-000000000002')$$,
  '42501', 'deal is not available to this participant',
  'an outsider cannot complete the deal'
);
select throws_ok(
  $$select public.complete_deal('ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  '42501', 'deal is not available to this participant',
  'a missing deal receives the same completion denial as a real nonparticipant deal'
);
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.complete_deal('27000008-0000-4000-8000-000000000008')$$,
  '42501', 'deal is not available to this participant',
  'completion fails closed when the accepted-offer buyer identity is inconsistent'
);
select throws_ok(
  $$insert into public.deal_confirmations (deal_id, profile_id) values ('27000002-0000-4000-8000-000000000002', '25111111-1111-4111-8111-111111111111')$$,
  '42501', 'permission denied for table deal_confirmations',
  'direct legacy confirmation inserts are denied'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer from public.deals where id = '27000008-0000-4000-8000-000000000008'),
  0,
  'a forged stored party B cannot read the inconsistent deal through RLS'
);
select is(
  (select count(*)::integer from public.deal_confirmations where deal_id = '27000008-0000-4000-8000-000000000008'),
  0,
  'a forged stored party B cannot read historical confirmations for the inconsistent deal'
);
select throws_ok(
  $$select * from public.open_deal_dispute('27000008-0000-4000-8000-000000000008', 'Forged buyer attempts to open a dispute')$$,
  '42501', 'deal is not available to this participant',
  'a forged stored party B cannot open or retrieve a dispute case'
);
select throws_ok(
  $$insert into public.reports (reporter_id, target_type, target_id, reason_code, details) values ('25333333-3333-4333-8333-333333333333', 'deal', '2700000a-0000-4000-8000-00000000000a', 'deal_dispute', 'Forged direct dispute report')$$,
  '42501', 'deal disputes require the atomic dispute workflow',
  'a forged stored party B cannot directly create a dispute report for a corrupted disputed deal'
);
select throws_ok(
  $$select public.cancel_deal('27000008-0000-4000-8000-000000000008', 'Forged buyer cancellation')$$,
  '42501', 'deal is not available to this participant',
  'a forged stored party B cannot cancel the inconsistent deal'
);
select throws_ok(
  $$select public.complete_deal('27000008-0000-4000-8000-000000000008')$$,
  '42501', 'deal is not available to this participant',
  'a forged stored party B cannot complete the inconsistent deal'
);
select throws_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('27000008-0000-4000-8000-000000000008', '25333333-3333-4333-8333-333333333333', '25111111-1111-4111-8111-111111111111', 5)$$,
  '23514', 'review deal identity is inconsistent',
  'a forged stored party B cannot unlock review eligibility'
);
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select throws_ok(
  $$select public.resolve_deal_dispute('29000008-0000-4000-8000-000000000008', '27000008-0000-4000-8000-000000000008', 'cancelled', 'Reject malformed accepted-offer identity')$$,
  '23514', 'deal identity is inconsistent',
  'assigned staff cannot resolve a moderation case against an inconsistent deal identity'
);
set local role postgres;
select ok(
  (select status = 'disputed' from public.deals where id = '27000008-0000-4000-8000-000000000008')
  and (select completed_deals_count = 1 from public.profiles where id = '25111111-1111-4111-8111-111111111111')
  and (select completed_deals_count = 0 from public.profiles where id = '25333333-3333-4333-8333-333333333333')
  and (select count(*) = 0 from public.notifications where data ->> 'dealId' = '27000008-0000-4000-8000-000000000008')
  and (select count(*) = 1 from public.reports where target_type = 'deal' and target_id = '27000008-0000-4000-8000-000000000008' and reporter_id = '25111111-1111-4111-8111-111111111111')
  and (select status = 'disputed' from public.deals where id = '2700000a-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.reports where target_type = 'deal' and target_id = '2700000a-0000-4000-8000-00000000000a'),
  'forged-party attempts leave lifecycle state, counters, reports and notifications unchanged'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$select * from public.open_deal_dispute('27000000-0000-4000-8000-000000000000', 'Legitimate buyer reports a delivery dispute')$$,
  'a relationally valid participant can open a deal dispute'
);
set local role postgres;
select ok(
  (select status = 'disputed' from public.deals where id = '27000000-0000-4000-8000-000000000000')
  and (select count(*) = 1 from public.reports where target_type = 'deal' and target_id = '27000000-0000-4000-8000-000000000000' and reason_code = 'deal_dispute' and reporter_id = '25222222-2222-4222-8222-222222222222'),
  'legitimate dispute creation atomically changes state and creates one moderation case'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $test$
  do $block$
  begin
    perform public.cancel_deal(
      '27000002-0000-4000-8000-000000000002',
      U&'\0009\0009\000A\000A\000B\000B\000C\000C\000D\000D'
    );
    raise exception 'unsafe cancellation reason accepted';
  end
  $block$
  $test$,
  '23514', 'cancellation reason must contain between 2 and 1000 characters',
  'authenticated cancellation rejects ASCII control whitespace as an empty reason'
);
select throws_ok(
  $test$
  do $block$
  begin
    perform public.cancel_deal(
      '27000002-0000-4000-8000-000000000002',
      U&'\00A0\00A0'
    );
    raise exception 'unsafe cancellation reason accepted';
  end
  $block$
  $test$,
  '23514', 'cancellation reason must contain between 2 and 1000 characters',
  'authenticated cancellation rejects non-breaking spaces as an empty reason'
);
select throws_ok(
  $test$
  do $block$
  begin
    perform public.cancel_deal(
      '27000002-0000-4000-8000-000000000002',
      U&'\0009\0009\000A\000A\000B\000B\000C\000C\000D\000D\0020\0020\00A0\00A0\1680\1680\2000\2000\2001\2001\2002\2002\2003\2003\2004\2004\2005\2005\2006\2006\2007\2007\2008\2008\2009\2009\200A\200A\2028\2028\2029\2029\202F\202F\205F\205F\3000\3000\FEFF\FEFF'
    );
    raise exception 'unsafe cancellation reason accepted';
  end
  $block$
  $test$,
  '23514', 'cancellation reason must contain between 2 and 1000 characters',
  'authenticated cancellation rejects mixed ECMAScript trim whitespace as an empty reason'
);
select lives_ok(
  $$select public.cancel_deal(
    '27000003-0000-4000-8000-000000000003',
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      || 'No delivery agreement'
      || U&'\FEFF\3000\205F\202F\2029\2028\200A\2009\2008\2007\2006\2005\2004\2003\2002\2001\2000\1680\00A0\0020\000D\000C\000B\000A\0009'
  )$$,
  'the seller cancels an active accepted deal'
);
set local role postgres;
select ok(
  (select status = 'cancelled' and cancelled_by = '25111111-1111-4111-8111-111111111111' and cancellation_reason = 'No delivery agreement' from public.deals where id = '27000003-0000-4000-8000-000000000003'),
  'seller cancellation stores the trimmed required reason'
);
select is(
  (select count(*)::integer from public.notifications where kind = 'deal_cancelled' and profile_id = '25222222-2222-4222-8222-222222222222' and data ->> 'dealId' = '27000003-0000-4000-8000-000000000003'),
  1,
  'seller cancellation notifies the buyer exactly once'
);
select is((select count(*)::integer from public.deal_confirmations where deal_id = '27000003-0000-4000-8000-000000000003'), 0, 'cancellation deletes stale confirmation records');
select ok(
  (select status = 'paused' from public.listings where id = '25000003-0000-4000-8000-000000000003')
  and (select status = 'archived' from public.conversations where id = '28000003-0000-4000-8000-000000000003'),
  'cancellation pauses reserved inventory and archives conversation'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.cancel_deal('27000003-0000-4000-8000-000000000003', 'Again')$$,
  '23514', 'only an active accepted deal can be cancelled',
  'duplicate participant cancellation fails closed'
);

select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok($$select public.cancel_deal('27000004-0000-4000-8000-000000000004', 'Buyer changed plans')$$, 'the buyer cancels an active accepted deal');
set local role postgres;
select ok(
  (select cancelled_by = '25222222-2222-4222-8222-222222222222' and cancellation_reason = 'Buyer changed plans' from public.deals where id = '27000004-0000-4000-8000-000000000004')
  and (select count(*) = 1 from public.notifications where kind = 'deal_cancelled' and profile_id = '25111111-1111-4111-8111-111111111111' and data ->> 'dealId' = '27000004-0000-4000-8000-000000000004'),
  'buyer cancellation is stored and notifies the seller'
);
set local role authenticated;
set local role postgres;
update public.profiles
set is_suspended = true
where id = '25111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$select public.cancel_deal('27000009-0000-4000-8000-000000000009', 'Buyer closes disputed deal')$$,
  'an active buyer can cancel a disputed deal with a suspended seller'
);
set local role postgres;
select ok(
  (select is_suspended from public.profiles where id = '25111111-1111-4111-8111-111111111111')
  and (select status = 'cancelled' and cancelled_by = '25222222-2222-4222-8222-222222222222' and cancellation_reason = 'Buyer closes disputed deal' from public.deals where id = '27000009-0000-4000-8000-000000000009')
  and (select count(*) = 1 from public.notifications where kind = 'deal_cancelled' and profile_id = '25111111-1111-4111-8111-111111111111' and data ->> 'dealId' = '27000009-0000-4000-8000-000000000009'),
  'buyer disputed cancellation remains available, terminal, and notifies the suspended seller once'
);
update public.profiles
set is_suspended = false
where id = '25111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25333333-3333-4333-8333-333333333333', true);
select throws_ok(
  $$select public.cancel_deal('27000006-0000-4000-8000-000000000006', 'Hostile outsider')$$,
  '42501', 'deal is not available to this participant',
  'an outsider cannot cancel the deal'
);

select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select lives_ok(
  $$select public.moderate_profile('29f00001-0000-4000-8000-000000000001', '25333333-3333-4333-8333-333333333333', true, 'Suspend reported profile without trusting forged deal parties')$$,
  'staff can moderate the reported profile without trusting stored deal parties'
);
set local role postgres;
select ok(
  (select is_suspended from public.profiles where id = '25333333-3333-4333-8333-333333333333')
  and (select status = 'pending_confirmation' from public.deals where id = '2700000b-0000-4000-8000-00000000000b')
  and (select status = 'open' from public.conversations where id = '2800000b-0000-4000-8000-00000000000b'),
  'profile moderation leaves an unrelated deal and conversation with forged party B untouched'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select lives_ok($$select public.cancel_deal('27000005-0000-4000-8000-000000000005', 'Resolved directly with buyer')$$, 'a participant can cancel a disputed deal');
set local role postgres;
select ok((select status = 'investigating' from public.reports where id = '29000005-0000-4000-8000-000000000005'), 'participant cancellation leaves the moderation case live for staff closure');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select throws_ok(
  $$select public.resolve_deal_dispute('29000005-0000-4000-8000-000000000005', '27000005-0000-4000-8000-000000000005', 'pending_confirmation', 'Attempted unsafe resume')$$,
  '23514', 'a participant-cancelled deal cannot be resumed',
  'staff cannot resume a participant-cancelled terminal deal'
);
select lives_ok(
  $$select public.resolve_deal_dispute('29000005-0000-4000-8000-000000000005', '27000005-0000-4000-8000-000000000005', 'cancelled', 'Closed after participant cancellation')$$,
  'assigned staff can close the report as cancelled'
);
select ok(
  (select status = 'resolved' and resolution_code = 'deal_cancelled_by_participant' and resolution_notes = 'Closed after participant cancellation' from public.reports where id = '29000005-0000-4000-8000-000000000005'),
  'report closure records participant cancellation resolution evidence'
);
select ok(
  (select status = 'cancelled' and cancelled_by = '25111111-1111-4111-8111-111111111111' and cancellation_reason = 'Resolved directly with buyer' from public.deals where id = '27000005-0000-4000-8000-000000000005'),
  'staff report closure does not mutate the terminal cancelled deal'
);

set local role postgres;
update public.listings
set status = 'paused'
where id in (
  '25000002-0000-4000-8000-000000000002',
  '25000008-0000-4000-8000-000000000008'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer from public.listings where id = '25000008-0000-4000-8000-000000000008'),
  0,
  'a forged stored party B cannot read a linked paused listing'
);
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::integer from public.listings where id = '25000002-0000-4000-8000-000000000002'),
  1,
  'an active legitimate deal participant can read the linked paused listing'
);
set local role postgres;
update public.beta_memberships
set status = 'suspended'
where profile_id = '25222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::integer from public.listings where id = '25000002-0000-4000-8000-000000000002'),
  0,
  'a suspended legitimate deal participant cannot read the linked paused listing'
);
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select is(
  (select count(*)::integer from public.listings where id in (
    '25000002-0000-4000-8000-000000000002',
    '25000008-0000-4000-8000-000000000008'
  )),
  2,
  'active staff retain explicit access to linked paused listings'
);
set local role postgres;
update public.beta_memberships
set status = 'active'
where profile_id = '25222222-2222-4222-8222-222222222222';
update public.listings
set status = 'reserved'
where id in (
  '25000002-0000-4000-8000-000000000002',
  '25000008-0000-4000-8000-000000000008'
);

update public.beta_memberships
set status = 'suspended'
where profile_id = '25111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.complete_deal('27000002-0000-4000-8000-000000000002')$$,
  '42501', 'active beta membership is required',
  'a suspended seller cannot invoke the lifecycle transition'
);
select is(
  (select count(*)::integer from public.deals where id = '27000002-0000-4000-8000-000000000002'),
  0,
  'a suspended participant cannot directly SELECT a deal or receive its Realtime row'
);
select is(
  (select count(*)::integer from public.deal_confirmations where deal_id = '27000002-0000-4000-8000-000000000002'),
  0,
  'a suspended participant cannot directly SELECT historical confirmations or receive their Realtime rows'
);
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select ok(
  (select count(*) = 1 from public.deals where id = '27000002-0000-4000-8000-000000000002')
  and (select count(*) = 1 from public.deal_confirmations where deal_id = '27000002-0000-4000-8000-000000000002'),
  'active staff retain explicit moderation read access while a participant is suspended'
);
set local role postgres;
update public.beta_memberships
set status = 'active'
where profile_id = '25111111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok($$select public.cancel_deal('27000006-0000-4000-8000-000000000006', 'Buyer cancels first')$$, 'buyer cancellation establishes the cancel-first serialized outcome');
select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$select public.complete_deal('27000006-0000-4000-8000-000000000006')$$,
  '23514', 'only an active accepted deal can be completed',
  'completion loses the cancel-first serialized race'
);
select lives_ok($$select public.complete_deal('27000007-0000-4000-8000-000000000007')$$, 'seller completion establishes the complete-first serialized outcome');
select throws_ok(
  $$select public.cancel_deal('27000007-0000-4000-8000-000000000007', 'Too late')$$,
  '23514', 'only an active accepted deal can be cancelled',
  'cancellation loses the complete-first serialized race'
);

select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('27000001-0000-4000-8000-000000000001', '25222222-2222-4222-8222-222222222222', '25111111-1111-4111-8111-111111111111', 5)$$,
  'reviews unlock after seller completion'
);
select throws_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('27000002-0000-4000-8000-000000000002', '25222222-2222-4222-8222-222222222222', '25111111-1111-4111-8111-111111111111', 5)$$,
  '23514', 'reviews require a seller-completed deal',
  'reviews remain locked while the deal is pending'
);
select throws_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('27000003-0000-4000-8000-000000000003', '25222222-2222-4222-8222-222222222222', '25111111-1111-4111-8111-111111111111', 5)$$,
  '23514', 'reviews require a seller-completed deal',
  'reviews remain locked after cancellation'
);

set local role postgres;
update public.profiles
set is_suspended = false
where id = '25333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select lives_ok(
  $$select public.moderate_listing('29120000-0000-4000-8000-000000000012', '25000012-0000-4000-8000-000000000012', 'Remove before seller completion regression', null, null, 'removed')$$,
  'report-bound staff removal succeeds before seller completion'
);
select lives_ok(
  $$select public.moderate_listing('29130000-0000-4000-8000-000000000013', '25000013-0000-4000-8000-000000000013', 'Reject before seller completion regression', null, null, 'rejected')$$,
  'report-bound staff rejection succeeds before seller completion'
);
select lives_ok(
  $$select public.moderate_listing('29140000-0000-4000-8000-000000000014', '25000014-0000-4000-8000-000000000014', 'Pause before seller completion regression', null, null, 'paused')$$,
  'report-bound staff pause succeeds before seller completion'
);

select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.complete_deal('27000012-0000-4000-8000-000000000012')$$,
  'seller completion succeeds after staff removed the listing'
);
select lives_ok(
  $$select public.complete_deal('27000013-0000-4000-8000-000000000013')$$,
  'seller completion succeeds after staff rejected the listing'
);
select lives_ok(
  $$select public.complete_deal('27000014-0000-4000-8000-000000000014')$$,
  'seller completion succeeds after staff paused the listing'
);
set local role postgres;
select ok(
  (select status = 'completed' from public.deals where id = '27000012-0000-4000-8000-000000000012')
  and (select status = 'removed' from public.listings where id = '25000012-0000-4000-8000-000000000012'),
  'seller completion preserves a prior staff removal while completing the deal'
);
select ok(
  (select status = 'completed' from public.deals where id = '27000013-0000-4000-8000-000000000013')
  and (select status = 'rejected' from public.listings where id = '25000013-0000-4000-8000-000000000013'),
  'seller completion preserves a prior staff rejection while completing the deal'
);
select ok(
  (select status = 'completed' from public.deals where id = '27000014-0000-4000-8000-000000000014')
  and (select status = 'paused' from public.listings where id = '25000014-0000-4000-8000-000000000014'),
  'seller completion preserves another prior moderation state while completing the deal'
);
select ok(
  (select count(*) = 2 and min(completed_deals_count) = 5 and max(completed_deals_count) = 5
   from public.profiles
   where id in ('25111111-1111-4111-8111-111111111111', '25222222-2222-4222-8222-222222222222'))
  and (select count(*) = 6 and count(distinct dedupe_key) = 6
       from public.notifications
       where kind = 'deal_completed'
         and data ->> 'dealId' in (
           '27000012-0000-4000-8000-000000000012',
           '27000013-0000-4000-8000-000000000013',
           '27000014-0000-4000-8000-000000000014'
         )),
  'moderated-listing completion preserves participant counters and completion notifications'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$insert into public.reviews (deal_id, reviewer_id, reviewee_id, rating) values ('27000012-0000-4000-8000-000000000012', '25222222-2222-4222-8222-222222222222', '25111111-1111-4111-8111-111111111111', 5)$$,
  'review eligibility remains unlocked after completion preserves listing moderation'
);

select set_config('request.jwt.claims', '{"sub":"25111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$select public.complete_deal('27000015-0000-4000-8000-000000000015')$$,
  'ordinary seller completion succeeds while the listing is reserved'
);
set local role postgres;
select ok(
  (select status = 'completed' from public.deals where id = '27000015-0000-4000-8000-000000000015')
  and (select status = 'completed' from public.listings where id = '25000015-0000-4000-8000-000000000015'),
  'ordinary seller completion transitions a reserved linked listing to completed'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', '25444444-4444-4444-8444-444444444444', true);
select lives_ok(
  $$select public.moderate_listing('29150000-0000-4000-8000-000000000015', '25000015-0000-4000-8000-000000000015', 'Remove after seller completion regression', null, null, 'removed')$$,
  'report-bound staff removal succeeds after seller completion'
);
set local role postgres;
select ok(
  (select status = 'completed' from public.deals where id = '27000015-0000-4000-8000-000000000015')
  and (select status = 'removed' from public.listings where id = '25000015-0000-4000-8000-000000000015'),
  'later valid staff moderation remains authoritative after completion'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"25333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '25333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer
   from public.listings
   where id in (
     '25000012-0000-4000-8000-000000000012',
     '25000013-0000-4000-8000-000000000013',
     '25000014-0000-4000-8000-000000000014'
   )),
  0,
  'an active unrelated user cannot read removed, rejected, or paused listings after deal completion'
);

select * from finish();
rollback;
