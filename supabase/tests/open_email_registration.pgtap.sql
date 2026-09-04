begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(31);

select ok(
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'beta_memberships'
      and c.column_name = 'invite_id' and c.is_nullable = 'YES'
  ),
  'open registrations do not require a beta invite'
);
select ok(to_regprocedure('public.claim_open_registration()') is not null, 'open-registration admission function exists');
select ok(has_function_privilege('authenticated', 'public.claim_open_registration()', 'execute'), 'authenticated users can claim open registration');
select ok(not has_function_privilege('anon', 'public.claim_open_registration()', 'execute'), 'anonymous users cannot claim membership');
select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.claim_open_registration()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'claim_open_registration has no default PUBLIC execute grant'
);
select ok(not has_function_privilege('service_role', 'public.claim_open_registration()', 'execute'), 'claim_open_registration is authenticated-only');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.claim_open_registration()'::regprocedure), 'claim_open_registration remains SECURITY DEFINER');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.claim_open_registration()'::regprocedure),
  array['search_path=""']::text[],
  'claim_open_registration has an empty search_path'
);
select ok(to_regprocedure('public.claim_open_registration(uuid)') is null, 'no foreign-profile claim overload exists');
select ok(position('has_verified_phone' in pg_get_functiondef('public.validate_listing_activation()'::regprocedure)) = 0, 'listing activation no longer requires a verified phone');
select ok(position('has_verified_phone' in pg_get_functiondef('public.validate_offer_write()'::regprocedure)) = 0, 'offer creation no longer requires a verified phone');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  confirmation_sent_at, email_confirmed_at, invited_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '88888888-8888-4888-8888-888888888888', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'valid-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:00:00+00', null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"valid_merchant","account_kind":"merchant"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '87777777-7777-4777-8777-777777777777', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'foreign-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"foreign_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '99999999-9999-4999-8999-999999999999', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'invite-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00', timestamptz '2026-09-01 07:55:00+00',
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"invite_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '77777777-7777-4777-8777-777777777777', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'unconfirmed-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', null, null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"unconfirmed_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '66666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'missing-sent-registration@example.test', 'test-password-hash',
    null, timestamptz '2026-09-01 08:01:00+00', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"missing_sent_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'reversed-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:02:00+00', timestamptz '2026-09-01 08:01:00+00', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"reversed_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'metadata-role-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00', null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"metadata_role_user","role":"admin"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'oauth-registration@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00', null,
    '{"provider":"google","providers":["google"]}'::jsonb, '{"username":"oauth_user"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  );

select is(
  (select p.role::text || ':' || p.account_kind::text from public.profiles p where p.id = '44444444-4444-4444-8444-444444444444'),
  'user:private',
  'user-controlled metadata cannot create a privileged profile'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'authentication required', 'a missing actor cannot claim open registration');
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select lives_ok($sql$select public.claim_open_registration()$sql$, 'a directly confirmed email/password actor can claim one pending membership');
reset role;
set local role postgres;

select ok(
  exists (
    select 1 from public.beta_memberships m
    where m.profile_id = '88888888-8888-4888-8888-888888888888'
      and m.invite_id is null and m.status = 'pending'
      and m.onboarding_completed_at is null and m.activated_at is null
  ),
  'a valid claim creates exactly one pending invite-free membership'
);
select ok(
  not exists (select 1 from public.beta_memberships m where m.profile_id = '87777777-7777-4777-8777-777777777777'),
  'claiming as one actor never creates a foreign user membership'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select throws_ok(
  $sql$select public.claim_open_registration()$sql$, '42501',
  'open registration is no longer available for this account',
  'a repeated claim fails closed instead of using a historical idempotent branch'
);
reset role;
set local role postgres;
select ok(
  exists (
    select 1 from public.beta_memberships m
    where m.profile_id = '88888888-8888-4888-8888-888888888888'
      and m.status = 'pending' and m.created_at = m.updated_at
      and m.onboarding_completed_at is null and m.activated_at is null
  ),
  'a rejected second claim leaves the existing membership unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration requires a directly confirmed email/password account', 'an invited account cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '99999999-9999-4999-8999-999999999999'), 'an invited account failure creates no membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration requires a directly confirmed email/password account', 'an unconfirmed account cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '77777777-7777-4777-8777-777777777777'), 'an unconfirmed account failure creates no membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration requires a directly confirmed email/password account', 'a missing confirmation-sent timestamp cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '66666666-6666-4666-8666-666666666666'), 'a missing confirmation-sent timestamp creates no membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration requires a directly confirmed email/password account', 'reversed confirmation timestamps cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '55555555-5555-4555-8555-555555555555'), 'reversed confirmation timestamps create no membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration metadata is not eligible', 'user-controlled role metadata cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '44444444-4444-4444-8444-444444444444'), 'a metadata role escalation attempt creates no membership');

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok($sql$select public.claim_open_registration()$sql$, '42501', 'open registration requires a directly confirmed email/password account', 'a non-email provider cannot claim open registration');
reset role;
set local role postgres;
select ok(not exists (select 1 from public.beta_memberships where profile_id = '33333333-3333-4333-8333-333333333333'), 'a non-email-provider failure creates no membership');

select is((select count(*)::integer from public.beta_memberships where invite_id is null), 1, 'all invalid actor directions leave only the one valid open-registration membership');

select * from finish();
rollback;
