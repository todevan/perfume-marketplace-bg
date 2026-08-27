begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(16);

select ok(
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'beta_memberships'
      and c.column_name = 'invite_id'
      and c.is_nullable = 'YES'
  ),
  'open registrations do not require a beta invite'
);
select ok(
  to_regprocedure('public.claim_open_registration()') is not null,
  'open-registration admission function exists'
);
select ok(
  has_function_privilege('authenticated', 'public.claim_open_registration()', 'execute'),
  'authenticated users can claim open registration'
);
select ok(
  not has_function_privilege('anon', 'public.claim_open_registration()', 'execute'),
  'anonymous users cannot claim membership'
);
select ok(
  position(
    'has_verified_phone' in pg_get_functiondef('public.validate_listing_activation()'::regprocedure)
  ) = 0,
  'listing activation no longer requires a verified phone'
);
select ok(
  position(
    'has_verified_phone' in pg_get_functiondef('public.validate_offer_write()'::regprocedure)
  ) = 0,
  'offer creation no longer requires a verified phone'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmation_sent_at,
  email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '88888888-8888-4888-8888-888888888888',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'open-registration@example.test', 'test-password-hash',
  statement_timestamp() - interval '1 minute', statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"open_merchant","account_kind":"merchant"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

select is(
  (
    select p.username::text || ':' || p.account_kind::text
    from public.profiles p
    where p.id = '88888888-8888-4888-8888-888888888888'
  ),
  'open_merchant:merchant',
  'email signup metadata creates the requested safe profile shape'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '88888888-8888-4888-8888-888888888888';
select lives_ok(
  $sql$select public.claim_open_registration()$sql$,
  'an authenticated email signup can claim pending membership without an invite'
);
reset role;
set local role postgres;

select ok(
  exists (
    select 1
    from public.beta_memberships m
    where m.profile_id = '88888888-8888-4888-8888-888888888888'
      and m.invite_id is null
      and m.status = 'pending'
  ),
  'open registration creates pending invite-free membership'
);
select ok(
  not private.is_active_beta_user('88888888-8888-4888-8888-888888888888'),
  'email confirmation, onboarding and current consents remain required for activation'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmation_sent_at,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '77777777-7777-4777-8777-777777777777',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pending-registration@example.test',
  'test-password-hash', statement_timestamp(), null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"pending_registration"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

set local role authenticated;
set local "request.jwt.claim.sub" = '77777777-7777-4777-8777-777777777777';
select throws_ok(
  $sql$select public.claim_open_registration()$sql$,
  '42501',
  'open registration requires completed email confirmation',
  'an unconfirmed direct email signup cannot claim membership'
);
reset role;
set local role postgres;

select ok(
  not exists (
    select 1 from public.beta_memberships m
    where m.profile_id = '77777777-7777-4777-8777-777777777777'
  ),
  'an unconfirmed signup leaves no admission record'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmation_sent_at,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '66666666-6666-4666-8666-666666666666',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'autoconfirm-drift@example.test',
  'test-password-hash', null, statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"autoconfirm_drift"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

set local role authenticated;
set local "request.jwt.claim.sub" = '66666666-6666-4666-8666-666666666666';
select throws_ok(
  $sql$select public.claim_open_registration()$sql$,
  '42501',
  'open registration requires completed email confirmation',
  'an autoconfirm-shaped direct user cannot claim membership'
);
reset role;
set local role postgres;

select ok(
  not exists (
    select 1 from public.beta_memberships m
    where m.profile_id = '66666666-6666-4666-8666-666666666666'
  ),
  'autoconfirm drift leaves no admission record'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  invited_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '99999999-9999-4999-8999-999999999999',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'first-admin-invite@example.test',
  'test-password-hash', statement_timestamp(), statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"first_admin_invite"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

set local role authenticated;
set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';
select throws_ok(
  $sql$select public.claim_open_registration()$sql$,
  '42501',
  'open registration requires a direct email/password account',
  'Supabase invite users remain reserved for the first-admin binding workflow'
);
reset role;
set local role postgres;

insert into public.beta_memberships (profile_id, invite_id, status)
values ('99999999-9999-4999-8999-999999999999', null, 'pending');

set local role authenticated;
set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';
select lives_ok(
  $sql$select public.claim_open_registration()$sql$,
  'existing invite-era memberships continue to sign in normally'
);
reset role;
set local role postgres;

select * from finish();
rollback;
