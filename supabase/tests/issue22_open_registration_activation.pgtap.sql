begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(50);

select ok(
  to_regprocedure('private.normalize_city(text)') is not null,
  'city normalization exists at the private database boundary'
);
select ok(
  to_regprocedure('private.is_valid_city(text)') is not null,
  'city validation exists at the private database boundary'
);
select ok(
  coalesce((
    select p.provolatile = 'i'
      and p.proparallel = 's'
      and p.proconfig @> array['search_path=""']
    from pg_proc p
    where p.oid = to_regprocedure('private.normalize_city(text)')
  ), false)
  and coalesce((
    select p.provolatile = 'i'
      and p.proparallel = 's'
      and p.proconfig @> array['search_path=""']
    from pg_proc p
    where p.oid = to_regprocedure('private.is_valid_city(text)')
  ), false),
  'city helpers are immutable, parallel-safe, and use an empty search path'
);
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('private.normalize_city(text)'), 'execute'), true)
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_city(text)'), 'execute'), true)
  and coalesce(has_function_privilege('authenticated', to_regprocedure('private.normalize_city(text)'), 'execute'), false)
  and coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_city(text)'), 'execute'), false)
  and coalesce(has_function_privilege('service_role', to_regprocedure('private.normalize_city(text)'), 'execute'), false)
  and coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_city(text)'), 'execute'), false),
  'city helpers expose only the required authenticated and service-role execution'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname = 'profiles_city_shape'
      and c.contype = 'c'
      and not c.convalidated
  ),
  'new profile writes enforce city shape without rejecting unknown legacy rows'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('31111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'invalid-city@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"invalid_city"}', statement_timestamp(), statement_timestamp()),
  ('31222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cyrillic-city@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"cyrillic_city"}', statement_timestamp(), statement_timestamp()),
  ('31333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'latin-city@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"latin_city"}', statement_timestamp(), statement_timestamp()),
  ('31444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'apostrophe-city@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"apostrophe_city"}', statement_timestamp(), statement_timestamp()),
  ('31555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'unconfirmed@example.test', 'test-password-hash', null,
   '{"provider":"email","providers":["email"]}', '{"username":"unconfirmed"}', statement_timestamp(), statement_timestamp()),
  ('31666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'missing-terms@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"missing_terms"}', statement_timestamp(), statement_timestamp()),
  ('31777777-7777-4777-8777-777777777777', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'missing-rules@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"missing_rules"}', statement_timestamp(), statement_timestamp()),
  ('31888888-8888-4888-8888-888888888888', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'suspended-member@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"suspended_member"}', statement_timestamp(), statement_timestamp()),
  ('31999999-9999-4999-8999-999999999999', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'revoked-member@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"revoked_member"}', statement_timestamp(), statement_timestamp()),
  ('31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hostile-metadata@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"hostile_user","role":"admin"}', statement_timestamp(), statement_timestamp()),
  ('31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'real-admin@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"real_admin"}', statement_timestamp(), statement_timestamp()),
  ('31cccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expired-legacy@example.test', 'test-password-hash', statement_timestamp(),
   '{"provider":"email","providers":["email"]}', '{"username":"expired_legacy"}', statement_timestamp(), statement_timestamp());

insert into public.beta_memberships (profile_id, invite_id, status)
select id, null, 'pending'::public.beta_membership_status
from auth.users
where id in (
  '31111111-1111-4111-8111-111111111111',
  '31222222-2222-4222-8222-222222222222',
  '31333333-3333-4333-8333-333333333333',
  '31444444-4444-4444-8444-444444444444',
  '31555555-5555-4555-8555-555555555555',
  '31666666-6666-4666-8666-666666666666',
  '31777777-7777-4777-8777-777777777777',
  '31888888-8888-4888-8888-888888888888',
  '31999999-9999-4999-8999-999999999999',
  '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select u.id, d.document_code, d.document_version, 'web'
from auth.users u
cross join public.beta_legal_documents d
where u.id in (
  '31111111-1111-4111-8111-111111111111',
  '31222222-2222-4222-8222-222222222222',
  '31333333-3333-4333-8333-333333333333',
  '31444444-4444-4444-8444-444444444444',
  '31555555-5555-4555-8555-555555555555',
  '31888888-8888-4888-8888-888888888888',
  '31999999-9999-4999-8999-999999999999',
  '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '31cccccc-cccc-4ccc-8ccc-cccccccccccc'
)
and d.required_for_access
and d.retired_at is null;

-- Model a legacy active membership whose admission window has already ended.
-- The current trigger correctly prevents creating this shape through the live
-- workflow, so the rolled-back test fixture bypasses only that trigger.
alter table public.beta_memberships disable trigger protect_beta_membership_workflow;
insert into public.beta_memberships (
  profile_id, invite_id, status, onboarding_completed_at, activated_at,
  expires_at, created_at, updated_at
) values (
  '31cccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'active',
  transaction_timestamp() - interval '3 days',
  transaction_timestamp() - interval '3 days',
  transaction_timestamp() - interval '1 day',
  transaction_timestamp() - interval '4 days',
  transaction_timestamp() - interval '3 days'
);
alter table public.beta_memberships enable trigger protect_beta_membership_workflow;

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select '31666666-6666-4666-8666-666666666666', d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null and d.document_code <> 'beta_terms';

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select '31777777-7777-4777-8777-777777777777', d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null and d.document_code <> 'marketplace_rules';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","aal":"aal1","user_metadata":{"role":"admin"}}',
  true
);
select set_config('request.jwt.claim.sub', '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok(
  $sql$select public.claim_open_registration()$sql$,
  'a hostile metadata signup can claim only ordinary pending membership'
);
reset role;
set local role postgres;

select is(
  (select p.role::text from public.profiles p where p.id = '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'user',
  'raw user metadata cannot create an administrator profile'
);
select ok(
  exists (
    select 1 from public.beta_memberships m
    where m.profile_id = '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and m.status = 'pending'
  ),
  'hostile metadata admission remains pending before onboarding'
);

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}',
  true
);
select set_config('request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', null)$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'a missing city cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', '   ')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'an ASCII-space-only city cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', E'\t\n')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'tabs and newlines cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', U&'\00A0')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'non-breaking whitespace cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', U&'\200B')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'zero-width whitespace cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', E'So\001fia')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'control characters cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', '--')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'punctuation without a letter or digit cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', 'Sofia_1')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'unsupported city characters cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', 'A')$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'a one-character city cannot activate onboarding'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('invalid_city', repeat('A', 101))$sql$,
  '22023', 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes',
  'a 101-character city cannot activate onboarding'
);
select ok(
  private.is_valid_city('AB')
  and private.is_valid_city(repeat('A', 100)),
  'city validation accepts the exact 2-character and 100-character boundaries'
);
reset role;
set local role postgres;

select is(
  (select m.status::text from public.beta_memberships m where m.profile_id = '31111111-1111-4111-8111-111111111111'),
  'pending',
  'rejected cities leave onboarding membership pending'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claims', '{"sub":"31555555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('unconfirmed', 'Sofia')$sql$,
  '42501', 'a confirmed email and active profile are required',
  'an unconfirmed user cannot activate'
);
select set_config('request.jwt.claim.sub', '31666666-6666-4666-8666-666666666666', true);
select set_config('request.jwt.claims', '{"sub":"31666666-6666-4666-8666-666666666666","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('missing_terms', 'Sofia')$sql$,
  '42501', 'all current required beta documents must be accepted',
  'missing current Terms consent cannot activate'
);
select set_config('request.jwt.claim.sub', '31777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claims', '{"sub":"31777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('missing_rules', 'Sofia')$sql$,
  '42501', 'all current required beta documents must be accepted',
  'missing current Marketplace Rules consent cannot activate'
);

select set_config('request.jwt.claim.sub', '31222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"31222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
create temp table cyrillic_onboarding_result on commit drop as
select public.complete_beta_onboarding('cyrillic_city', '  София  ') as payload;
select set_config('request.jwt.claim.sub', '31333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claims', '{"sub":"31333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('latin_city', 'Stara-Zagora')$sql$,
  'Latin city input with a hyphen activates'
);
select set_config('request.jwt.claim.sub', '31444444-4444-4444-8444-444444444444', true);
select set_config('request.jwt.claims', '{"sub":"31444444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('apostrophe_city', 'O''Fallon')$sql$,
  'city input with an apostrophe activates'
);
select set_config('request.jwt.claim.sub', '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims', '{"sub":"31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","aal":"aal1","user_metadata":{"role":"admin"}}', true);
create temp table hostile_onboarding_result on commit drop as
select public.complete_beta_onboarding('hostile_user', 'Sofia') as payload;
reset role;
set local role postgres;

select is(
  (select (payload ->> 'isActive')::boolean from cyrillic_onboarding_result),
  true,
  'fresh phone-null onboarding reports canonical active access immediately'
);
select is(
  (select (payload ->> 'isActive')::boolean from hostile_onboarding_result),
  true,
  'fresh hostile-metadata onboarding reports canonical active access immediately'
);

select is(
  (select p.city from public.profiles p where p.id = '31222222-2222-4222-8222-222222222222'),
  'София',
  'onboarding removes only surrounding ASCII spaces from city input'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '31222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"31222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
select is(
  public.is_active_beta_user(),
  true,
  'the phone-null onboarding user satisfies the canonical active-access gate'
);
reset role;
set local role postgres;
select ok(
  (select m.status = 'active' from public.beta_memberships m where m.profile_id = '31222222-2222-4222-8222-222222222222')
  and (select p.phone_verified_at is null from public.profiles p where p.id = '31222222-2222-4222-8222-222222222222'),
  'valid onboarding activates membership without requiring phone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claims', '{"sub":"31333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}', true);
update public.profiles set city = null where id = '31333333-3333-4333-8333-333333333333';
select is(public.is_active_beta_user(), false, 'clearing an active city fails access closed');
select lives_ok(
  $sql$select public.complete_beta_onboarding('latin_city', 'Plovdiv')$sql$,
  'valid onboarding repairs a cleared active city'
);
reset role;
set local role postgres;
select throws_ok(
  $sql$update public.profiles set city = 'Sofia_1' where id = '31333333-3333-4333-8333-333333333333'$sql$,
  '23514', null,
  'the city-shape constraint rejects unsupported characters on new writes'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims', '{"sub":"31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","aal":"aal1","user_metadata":{"role":"admin"}}', true);
select throws_ok(
  $sql$update public.profiles set role = 'admin' where id = '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$sql$,
  '42501', 'privileged profile fields cannot be changed by this user',
  'an otherwise active user cannot self-escalate profile role'
);
select lives_ok(
  $sql$update public.profiles set bio = 'cross-user write' where id = '31222222-2222-4222-8222-222222222222'$sql$,
  'a cross-user profile update is denied without leaking an authorization error'
);
reset role;
set local role postgres;
select is(
  (select p.role::text from public.profiles p where p.id = '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'user',
  'a user cannot self-escalate profile role'
);
select is(
  (select p.bio from public.profiles p where p.id = '31222222-2222-4222-8222-222222222222'),
  null,
  'a user cannot update another profile'
);

-- Recreate a legacy invalid active city inside this rolled-back test transaction.
-- NOT VALID preserves such rows in deployed databases, while the onboarding RPC
-- must remain the only safe repair path.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_city_shape'
  ) then
    execute 'alter table public.profiles drop constraint profiles_city_shape';
  end if;
  update public.profiles set city = U&'\200B'
  where id = '31222222-2222-4222-8222-222222222222';
  if to_regprocedure('private.is_valid_city(text)') is not null then
    execute $ddl$
      alter table public.profiles add constraint profiles_city_shape check (
        city is null or (
          city = private.normalize_city(city)
          and private.is_valid_city(city)
        )
      ) not valid
    $ddl$;
  end if;
end;
$$;

select is(
  private.is_active_beta_user('31222222-2222-4222-8222-222222222222'),
  false,
  'legacy invalid city content fails active access closed'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '31222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"31222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('cyrillic_city', '  Пловдив  ')$sql$,
  'active onboarding safely repairs a legacy invalid city'
);
reset role;
set local role postgres;
select is(
  (select p.city from public.profiles p where p.id = '31222222-2222-4222-8222-222222222222'),
  'Пловдив',
  'legacy city repair stores the normalized valid city'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31cccccc-cccc-4ccc-8ccc-cccccccccccc', true);
select set_config('request.jwt.claims', '{"sub":"31cccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","aal":"aal1"}', true);
create temp table expired_legacy_repair_result on commit drop as
select public.complete_beta_onboarding('expired_legacy', 'Sofia') as payload;
reset role;
set local role postgres;
select is(
  (select (payload ->> 'isActive')::boolean from expired_legacy_repair_result),
  private.is_active_beta_user('31cccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'legacy repair response matches the canonical active predicate for an expired membership'
);
select is(
  private.is_active_beta_user('31cccccc-cccc-4ccc-8ccc-cccccccccccc'),
  false,
  'repairing an expired legacy membership does not reactivate access'
);
select is(
  (select p.city from public.profiles p where p.id = '31cccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Sofia',
  'expired legacy onboarding still repairs the invalid city safely'
);

update public.beta_memberships
set status = 'active'
where profile_id in (
  '31888888-8888-4888-8888-888888888888',
  '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);
update public.beta_memberships
set activated_at = transaction_timestamp()
where profile_id = '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.beta_memberships
set status = 'suspended'
where profile_id = '31888888-8888-4888-8888-888888888888';
update public.beta_memberships
set status = 'revoked'
where profile_id = '31999999-9999-4999-8999-999999999999';
update public.profiles
set city = 'Sofia',
    role = case when id = '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      then 'admin'::public.platform_role else role end
where id in (
  '31888888-8888-4888-8888-888888888888',
  '31999999-9999-4999-8999-999999999999',
  '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31888888-8888-4888-8888-888888888888', true);
select set_config('request.jwt.claims', '{"sub":"31888888-8888-4888-8888-888888888888","role":"authenticated","aal":"aal1"}', true);
select lives_ok($sql$select public.claim_open_registration()$sql$, 'a suspended member claim is idempotent');
select set_config('request.jwt.claim.sub', '31999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claims', '{"sub":"31999999-9999-4999-8999-999999999999","role":"authenticated","aal":"aal1"}', true);
select lives_ok($sql$select public.claim_open_registration()$sql$, 'a revoked member claim is idempotent');
reset role;
set local role postgres;
select is(
  (select string_agg(m.status::text, ',' order by m.profile_id)
   from public.beta_memberships m
   where m.profile_id in (
     '31888888-8888-4888-8888-888888888888',
     '31999999-9999-4999-8999-999999999999'
   )),
  'suspended,revoked',
  'open-registration claims never reactivate suspended or revoked memberships'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims', '{"sub":"31aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","aal":"aal2","user_metadata":{"role":"admin"}}', true);
select is(public.is_active_beta_user(), true, 'the hostile-metadata identity is otherwise fully active');
select is(public.is_admin(), false, 'hostile user metadata cannot grant administrator authority even at AAL2');

select set_config('request.jwt.claim.sub', '31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claims', '{"sub":"31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","aal":"aal1","user_metadata":{"role":"admin"}}', true);
select is(public.is_admin(), false, 'a real administrator remains denied at AAL1');
select set_config('request.jwt.claims', '{"sub":"31bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","aal":"aal2","user_metadata":{"role":"user"}}', true);
select is(public.is_admin(), true, 'a real active administrator is admitted only at AAL2');

select * from finish();
rollback;
