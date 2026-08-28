begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(35);

select ok(
  to_regprocedure('private.has_staff_mfa()') is not null,
  'the central private staff-MFA helper exists'
);
select ok(
  coalesce(
    not has_function_privilege(
      'authenticated',
      to_regprocedure('private.has_staff_mfa()'),
      'execute'
    ),
    false
  ),
  'authenticated clients cannot execute the private staff-MFA helper directly'
);

select ok(
  coalesce((
    select c.convalidated
    from pg_constraint c
    where c.conrelid = 'public.listings'::regclass
      and c.conname = 'listing_wanted_non_physical_shape'
  ), false),
  'wanted-listing physical-state constraint is installed and validated'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.search_listings(text,audience,segment[],deal_mode,text,integer,integer,integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass v2 listing cursor validation through the legacy RPC'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.search_catalog(text,integer)', 'execute'
  ),
  'authenticated clients cannot bypass database catalogue pagination through the legacy RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.search_listings_v2(text,audience,segment[],deal_mode,text,listing_kind,product_format,uuid,uuid,integer,integer,text,integer,timestamp with time zone,integer,uuid)',
    'execute'
  ),
  'authenticated clients can invoke the sort-aware listing search'
);
select ok(
  not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'marketplace_report_evidence_create'
  ),
  'authenticated clients cannot bypass server validation for report evidence uploads'
);
select ok(
  exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.moderation_audit'::regclass
      and t.tgname = 'close_report_after_decision_audit'
      and not t.tgisinternal
  ),
  'moderation decisions close reports in the same database transaction'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.resolve_conversation_report(uuid,text,text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.resolve_conversation_report(uuid,text,text)', 'execute'
  ),
  'conversation report resolution is authenticated and anonymous-denied'
);
select ok(
  has_function_privilege(
    'service_role', 'public.claim_notification_email_delivery_v2(uuid,text)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.claim_notification_email_delivery_v2(uuid,text)', 'execute'
  ),
  'only the service role can claim canonical notification delivery data'
);
select ok(
  has_function_privilege(
    'service_role', 'public.get_hosted_runtime_inventory()', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.get_hosted_runtime_inventory()', 'execute'
  ),
  'hosted runtime inventory is service-role only'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'seller-test@example.test', '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"seller_test"}'::jsonb,
  statement_timestamp(), statement_timestamp()
), (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'buyer-test@example.test', '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"buyer_test"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

update public.profiles
set email_verified_at = statement_timestamp(),
    phone_verified_at = statement_timestamp()
where id = '11111111-1111-4111-8111-111111111111';

insert into public.beta_invites (
  id, email, token_hash, status, expires_at
) values (
  '31111111-1111-4111-8111-111111111111',
  'seller-test@example.test', repeat('a', 64), 'pending',
  statement_timestamp() + interval '7 days'
);
update public.beta_invites
set status = 'accepted',
    accepted_by = '11111111-1111-4111-8111-111111111111'
where id = '31111111-1111-4111-8111-111111111111';
insert into public.beta_memberships (
  profile_id, invite_id, status
) values (
  '11111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  'pending'
);
update public.beta_memberships
set status = 'active'
where profile_id = '11111111-1111-4111-8111-111111111111';
update public.beta_memberships
set activated_at = now() - interval '1 second'
where profile_id = '11111111-1111-4111-8111-111111111111';
insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select
  '11111111-1111-4111-8111-111111111111',
  d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null;

insert into public.brands (
  id, canonical_name, slug, status, normalized_key
) values (
  '41111111-1111-4111-8111-111111111111',
  'Readiness Test Brand', 'readiness-test-brand', 'canonical',
  'readiness test brand'
);

alter table public.listings disable trigger user;
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
) values (
  '51111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'offer', 'sale', 'retail_bottle', 'unisex',
  '41111111-1111-4111-8111-111111111111',
  'Readiness Fragrance', 'EDP', 'Readiness active listing',
  'Test fixture', 'Sofia', 100.0, 90.0, false, 10000, 'active',
  'readiness-active-listing-5111111111',
  statement_timestamp(), statement_timestamp() + interval '60 days'
);
alter table public.listings enable trigger user;

alter table public.offers disable trigger user;
insert into public.offers (
  id, listing_id, offerer_id, kind, cash_amount_minor, status, expires_at, created_at
) values (
  '61111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'cash', 9000, 'pending',
  statement_timestamp() - interval '1 second',
  statement_timestamp() - interval '2 days'
);
alter table public.offers enable trigger user;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select ok(
  public.is_active_beta_user(),
  'the authenticated fixture satisfies the real active-beta RLS predicate'
);
select throws_ok(
  $sql$
    select public.accept_offer('61111111-1111-4111-8111-111111111111')
  $sql$,
  'P0002',
  'pending offer not found',
  'a seller cannot accept an offer after its expiry instant even before maintenance runs'
);
reset role;
set local role postgres;
alter table public.offers disable trigger user;
update public.offers
set expires_at = null
where id = '61111111-1111-4111-8111-111111111111';
alter table public.offers enable trigger user;
set local role authenticated;

select throws_ok(
  $sql$
    update public.listings
    set title = 'Changed active marketplace terms'
    where id = '51111111-1111-4111-8111-111111111111'
  $sql$,
  '42501',
  'pause the listing before changing marketplace terms',
  'an owner cannot materially edit an active listing directly'
);
select lives_ok(
  $sql$
    update public.listings
    set status = 'paused'
    where id = '51111111-1111-4111-8111-111111111111'
  $sql$,
  'an owner can explicitly pause an active listing'
);
select is(
  (
    select status::text
    from public.offers
    where id = '61111111-1111-4111-8111-111111111111'
  ),
  'expired',
  'pausing a listing expires every pending offer made against its old terms'
);
select throws_ok(
  $sql$
    select *
    from public.search_listings_v2(
      cursor_activated_at => statement_timestamp()
    )
  $sql$,
  '22023',
  'newest cursor is incomplete',
  'listing search rejects a half newest cursor at the database boundary'
);

reset role;
set local role postgres;

select throws_ok(
  $sql$
    insert into public.listings (
      seller_id, kind, deal_mode, product_format, audience, brand_id,
      fragrance_name, concentration, title, description, city,
      bottle_volume_ml, remaining_ml, is_sealed, status, slug
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'wanted', 'sale', 'retail_bottle', 'unisex',
      '41111111-1111-4111-8111-111111111111',
      'Invalid Wanted', 'EDP', 'Invalid wanted fixture', '', 'Sofia',
      100.0, null, false, 'draft', 'invalid-wanted-fixture'
    )
  $sql$,
  '23514',
  null,
  'database rejects physical state on a wanted listing'
);

update public.profiles
set is_suspended = true
where id = '11111111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select throws_ok(
  $sql$
    select public.accept_beta_consent('beta_terms', '2026-07-22')
  $sql$,
  '42501',
  'an unsuspended beta membership is required before accepting documents',
  'suspended users cannot append consent events'
);

reset role;
set local role postgres;
update public.profiles
set is_suspended = false
where id = '11111111-1111-4111-8111-111111111111';

insert into public.notifications (
  id, profile_id, kind, title, body, action_url, dedupe_key
) values (
  '71111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'report_updated', 'Canonical title', 'Canonical body',
  '/notifications', 'readiness-notification-71111111'
);

set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select results_eq(
  $sql$
    select profile_id, kind, title, body, action_url
    from public.claim_notification_email_delivery_v2(
      '71111111-1111-4111-8111-111111111111',
      'readiness-worker-request'
    )
  $sql$,
  $expected$
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      'report_updated'::text,
      'Canonical title'::text,
      'Canonical body'::text,
      '/notifications'::text
    )
  $expected$,
  'notification claim returns canonical database recipient and message content'
);

reset role;
set local role postgres;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
update public.profiles
set role = 'admin'
where id = '11111111-1111-4111-8111-111111111111';

alter table public.reports disable trigger user;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, status, assigned_to
) values (
  '81111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'listing', '51111111-1111-4111-8111-111111111111',
  'misleading_content', 'investigating',
  '11111111-1111-4111-8111-111111111111'
);
alter table public.reports enable trigger user;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select is(
  public.is_staff(),
  false,
  'an AAL1 staff identity is denied at the database boundary'
);
select is(
  public.is_admin(),
  false,
  'an AAL1 administrator is denied at the database boundary'
);
select throws_ok(
  $sql$
    select public.resolve_conversation_report(
      'a1111111-1111-4111-8111-111111111111',
      'keep',
      'Hostile AAL1 direct RPC attempt.'
    )
  $sql$,
  '42501',
  'active staff access required',
  'an AAL1 administrator cannot invoke a privileged moderation RPC directly'
  );
select throws_ok(
	$sql$
		update public.reports
		set status = 'open'
		where id = '81111111-1111-4111-8111-111111111111'
	$sql$,
	'42501',
	'staff access required for report workflow changes',
	'an AAL1 administrator cannot mutate a staff workflow through the table API'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select is(
  public.is_staff(),
  false,
  'a staff JWT without an assurance claim fails closed'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"unexpected"}',
  true
);
select is(
  public.is_staff(),
  false,
  'a staff JWT with an unknown assurance claim fails closed'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',
  true
);
select is(
  public.is_staff(),
  true,
  'an AAL2 staff identity remains authorized at the database boundary'
);
select is(
  public.is_admin(),
  true,
  'an AAL2 administrator remains authorized at the database boundary'
);
select public.moderate_listing(
  '81111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111',
  'Verified fixture decision.',
  null,
  null,
  'removed'
);
select is(
  (
    select status::text
    from public.reports
    where id = '81111111-1111-4111-8111-111111111111'
  ),
  'resolved',
  'decision audit closes its report atomically'
);
select is(
  (
    select resolution_code
    from public.reports
    where id = '81111111-1111-4111-8111-111111111111'
  ),
  'content_removed',
  'the atomic report resolution records the moderation outcome'
);

reset role;
set local role postgres;
alter table public.reports disable trigger user;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, status, assigned_to
) values (
  '91111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'listing', '51111111-1111-4111-8111-111111111111',
  'misleading_content', 'investigating',
  '11111111-1111-4111-8111-111111111111'
);
alter table public.reports enable trigger user;
create function pg_temp.reject_test_report_close()
returns trigger
language plpgsql
as $$
begin
  raise exception 'forced report closure failure' using errcode = '40001';
end;
$$;
create trigger reject_test_report_close
before update on public.reports
for each row
when (
  new.id = '91111111-1111-4111-8111-111111111111'::uuid
  and new.status = 'resolved'
)
execute function pg_temp.reject_test_report_close();
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select throws_ok(
  $sql$
    insert into public.moderation_audit (
      actor_id, report_id, action, target_type, target_id, rationale
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '91111111-1111-4111-8111-111111111111',
      'content_removed', 'listing',
      '51111111-1111-4111-8111-111111111111',
      'This decision must roll back.'
    )
  $sql$,
  '40001',
  'forced report closure failure',
  'a report-closure failure rolls back the moderation audit insert'
);
drop trigger reject_test_report_close on public.reports;
select is(
  (
    select count(*)::integer
    from public.moderation_audit
    where report_id = '91111111-1111-4111-8111-111111111111'
  ),
  0,
  'failed atomic report closure leaves no partial decision audit'
);

reset role;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select ok(
	public.is_admin('11111111-1111-4111-8111-111111111111'),
	'the service role retains its explicit trusted-system administrator path'
);
select is(
	public.is_admin('22222222-2222-4222-8222-222222222222'),
	false,
	'the service role cannot elevate an ordinary profile to administrator'
);

reset role;
set local role postgres;
update public.profiles
set is_suspended = true
where id = '11111111-1111-4111-8111-111111111111';
set local role service_role;
select is(
	public.is_admin('11111111-1111-4111-8111-111111111111'),
	false,
	'the service role cannot elevate a suspended administrator'
);

reset role;
set local role postgres;
update public.profiles
set is_suspended = false
where id = '11111111-1111-4111-8111-111111111111';

select * from finish();
rollback;
