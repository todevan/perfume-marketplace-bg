begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(45);

select ok(
  has_function_privilege('authenticated', 'public.complete_beta_onboarding(text,text)', 'execute'),
  'authenticated users retain onboarding activation access'
);
select ok(
  not has_function_privilege('anon', 'public.complete_beta_onboarding(text,text)', 'execute'),
  'anonymous users cannot execute onboarding activation'
);
select ok(private.is_valid_city('София'), 'Cyrillic city names satisfy the meaningful-character rule');
select ok(private.is_valid_city('Велико Търново'), 'ordinary internal spaces remain valid');
select ok(private.is_valid_city('Saint-Rémy'), 'hyphenated Unicode city names remain valid');
select ok(private.is_valid_city('L''Aquila'), 'apostrophe city names remain valid');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.email,
  'test-password-hash',
  fixture.email_confirmed_at,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'username', fixture.username,
    'account_kind', 'private',
    'role', case when fixture.id = '22000000-0000-4000-8000-000000000007'::uuid then 'admin' else 'user' end
  ),
  statement_timestamp(),
  statement_timestamp()
from (
  values
    ('22000000-0000-4000-8000-000000000001'::uuid, 'blank-city@example.test', 'issue22_blank', statement_timestamp()),
    ('22000000-0000-4000-8000-000000000002'::uuid, 'unconfirmed@example.test', 'issue22_unconfirmed', null::timestamptz),
    ('22000000-0000-4000-8000-000000000003'::uuid, 'missing-terms@example.test', 'issue22_no_terms', statement_timestamp()),
    ('22000000-0000-4000-8000-000000000004'::uuid, 'missing-rules@example.test', 'issue22_no_rules', statement_timestamp()),
    ('22000000-0000-4000-8000-000000000005'::uuid, 'valid@example.test', 'issue22_valid', statement_timestamp()),
    ('22000000-0000-4000-8000-000000000006'::uuid, 'target@example.test', 'issue22_target', statement_timestamp()),
    ('22000000-0000-4000-8000-000000000007'::uuid, 'metadata-admin@example.test', 'issue22_metadata_admin', statement_timestamp())
) as fixture(id, email, username, email_confirmed_at);

do $$
declare
  fixture_id uuid;
begin
  foreach fixture_id in array array[
    '22000000-0000-4000-8000-000000000001'::uuid,
    '22000000-0000-4000-8000-000000000002'::uuid,
    '22000000-0000-4000-8000-000000000003'::uuid,
    '22000000-0000-4000-8000-000000000004'::uuid,
    '22000000-0000-4000-8000-000000000005'::uuid,
    '22000000-0000-4000-8000-000000000006'::uuid
  ] loop
    perform set_config('request.jwt.claim.sub', fixture_id::text, true);
    perform public.claim_open_registration();
  end loop;
end;
$$;

insert into public.beta_consent_events (
  profile_id, document_code, document_version, accepted_at, source
)
select fixture.profile_id, document.document_code, document.document_version,
  statement_timestamp(), 'web'
from (
  values
    ('22000000-0000-4000-8000-000000000001'::uuid, null::text),
    ('22000000-0000-4000-8000-000000000002'::uuid, null::text),
    ('22000000-0000-4000-8000-000000000003'::uuid, 'beta_terms'),
    ('22000000-0000-4000-8000-000000000004'::uuid, 'marketplace_rules'),
    ('22000000-0000-4000-8000-000000000005'::uuid, null::text)
) as fixture(profile_id, excluded_document)
cross join public.beta_legal_documents document
where document.required_for_access
  and document.effective_at <= statement_timestamp()
  and document.retired_at is null
  and document.document_code is distinct from fixture.excluded_document;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', '   ')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'confirmed registration cannot activate with a blank normalized city'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', E'\t\t')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'tab-only city cannot activate through the authenticated RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', E'\r\n')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'CR/LF-only city cannot activate through the authenticated RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', chr(160) || chr(160))$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'NBSP-only city cannot activate through the authenticated RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', E'So\tfia')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'an internal tab cannot be normalized into an accepted city by the RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', 'So' || U&'\200B' || 'fia')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'a zero-width Unicode separator cannot activate through the RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', chr(133) || chr(133))$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'U+0085 control-only city cannot activate through the RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', U&'\2060\2060')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'U+2060 format-only city cannot activate through the RPC'
);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_blank', '---')$sql$,
  '22023',
  'city must contain 2 to 100 characters',
  'punctuation-only city cannot activate through the RPC'
);
reset role;
set local role postgres;
select is(
  (select status::text from public.beta_memberships where profile_id = '22000000-0000-4000-8000-000000000001'),
  'pending',
  'blank-city rejection leaves the membership pending'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_unconfirmed', 'Sofia')$sql$,
  '42501',
  'a confirmed email and active profile are required',
  'unconfirmed email registration cannot activate'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_no_terms', 'Sofia')$sql$,
  '42501',
  'all current required beta documents must be accepted',
  'current Terms consent remains mandatory'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('issue22_no_rules', 'Sofia')$sql$,
  '42501',
  'all current required beta documents must be accepted',
  'current Marketplace Rules consent remains mandatory'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('issue22_valid', '  New York  ')$sql$,
  'confirmed email registration with all consents and a valid city activates'
);
reset role;
set local role postgres;
select is(
  (select city from public.profiles where id = '22000000-0000-4000-8000-000000000005'),
  'New York',
  'onboarding trims ordinary surrounding spaces and preserves ordinary internal spaces'
);
-- pgTAP wraps this file in one transaction, while activation intentionally uses
-- statement_timestamp(); align the fixture to the transaction snapshot used by now().
update public.beta_memberships
set activated_at = now(), onboarding_completed_at = now()
where profile_id = '22000000-0000-4000-8000-000000000005';
select ok(
  private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'a normal user with confirmed email, valid city, and current consents is active'
);
select is(
  (select phone from auth.users where id = '22000000-0000-4000-8000-000000000005'),
  null,
  'phone is not required for activation'
);

update public.profiles
set city = null
where id = '22000000-0000-4000-8000-000000000005';
select ok(
  not private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'an active membership fails closed if its city is cleared'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('issue22_valid', '  Plovdiv  ')$sql$,
  'an inactive legacy membership can repair its missing city through onboarding'
);
reset role;
set local role postgres;
select ok(
  (select city = 'Plovdiv' from public.profiles where id = '22000000-0000-4000-8000-000000000005')
    and private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'repair stores the normalized city and restores active access'
);
select throws_ok(
  $sql$
    update public.profiles
    set city = 'X'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'database rejects a non-null city shorter than two normalized characters'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
  true
);
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $sql$
    update public.profiles set city = E'\t\t'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects a tab-only city'
);
select throws_ok(
  $sql$
    update public.profiles set city = chr(160) || chr(160)
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects an NBSP-only city'
);
select throws_ok(
  $sql$
    update public.profiles set city = E'Sofia\r\n'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects CR/LF whitespace'
);
select throws_ok(
  $sql$
    update public.profiles set city = 'So' || U&'\200B' || 'fia'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects a zero-width Unicode separator'
);
select throws_ok(
  $sql$
    update public.profiles set city = chr(133) || chr(133)
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects U+0085 control-only city'
);
select throws_ok(
  $sql$
    update public.profiles set city = U&'\2060\2060'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects U+2060 format-only city'
);
select throws_ok(
  $sql$
    update public.profiles set city = '---'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '23514',
  null,
  'direct own-profile update rejects punctuation-only city'
);
select is_empty(
  $sql$
    update public.profiles
    set city = 'Varna'
    where id = '22000000-0000-4000-8000-000000000006'
    returning id
  $sql$,
  'a normal user cannot modify another profile'
);
select throws_ok(
  $sql$
    update public.beta_memberships
    set status = 'active'
    where profile_id = '22000000-0000-4000-8000-000000000006'
  $sql$,
  '42501',
  null,
  'a normal user cannot modify another membership'
);
select throws_ok(
  $sql$
    insert into public.beta_consent_events (
      profile_id, document_code, document_version, accepted_at, source
    ) values (
      '22000000-0000-4000-8000-000000000006',
      'beta_terms', '2026-07-22', statement_timestamp(), 'web'
    )
  $sql$,
  '42501',
  null,
  'a normal user cannot create consent evidence for another profile'
);
select throws_ok(
  $sql$
    update public.profiles
    set role = 'admin'
    where id = '22000000-0000-4000-8000-000000000005'
  $sql$,
  '42501',
  'privileged profile fields cannot be changed by this user',
  'a normal user cannot elevate their stored role'
);
reset role;
set local role postgres;
select is(
  (select role::text from public.profiles where id = '22000000-0000-4000-8000-000000000005'),
  'user',
  'failed role escalation leaves the normal-user role unchanged'
);
select is(
  (select role::text from public.profiles where id = '22000000-0000-4000-8000-000000000007'),
  'user',
  'signup metadata cannot choose an administrator role'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}',
  true
);
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000007', true);
select is(
  public.is_admin(),
  false,
  'an AAL2 claim does not turn user-controlled signup metadata into admin access'
);

reset role;
set local role postgres;
alter table public.profiles drop constraint profiles_city_shape;
update public.profiles
set city = chr(160) || chr(160)
where id = '22000000-0000-4000-8000-000000000005';
select ok(
  not private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'a legacy active row with Unicode whitespace-only city remains fail-closed'
);
update public.profiles
set city = chr(133) || chr(133)
where id = '22000000-0000-4000-8000-000000000005';
select ok(
  not private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'a legacy active row with U+0085 control-only city remains fail-closed'
);
update public.profiles
set city = U&'\2060\2060'
where id = '22000000-0000-4000-8000-000000000005';
select ok(
  not private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'a legacy active row with U+2060 format-only city remains fail-closed'
);
update public.profiles
set city = '---'
where id = '22000000-0000-4000-8000-000000000005';
select ok(
  not private.is_active_beta_user('22000000-0000-4000-8000-000000000005'),
  'a legacy active row with punctuation-only city remains fail-closed'
);

reset role;
set local role postgres;
select * from finish();
rollback;
