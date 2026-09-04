begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(60);

select ok(to_regprocedure('private.normalize_profile_city(text)') is not null, 'the canonical private city normalizer exists');
select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'private.normalize_profile_city(text)'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'the private city normalizer has no default PUBLIC execute grant'
);
select ok(not has_function_privilege('anon', 'private.normalize_profile_city(text)', 'execute'), 'anon cannot execute the private city normalizer');
select ok(not has_function_privilege('authenticated', 'private.normalize_profile_city(text)', 'execute'), 'authenticated clients cannot execute the private city normalizer');
select ok(not has_function_privilege('service_role', 'private.normalize_profile_city(text)', 'execute'), 'service role cannot execute the private city normalizer');
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'private.normalize_profile_city(text)'::regprocedure),
  'i',
  'the city normalizer is immutable'
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'private.normalize_profile_city(text)'::regprocedure),
  array['search_path=""']::text[],
  'the city normalizer has an empty search_path'
);
select ok(has_function_privilege('authenticated', 'private.is_active_beta_user(uuid)', 'execute'), 'the existing authenticated active-user helper grant is preserved');
select ok(has_function_privilege('service_role', 'private.is_active_beta_user(uuid)', 'execute'), 'the existing service-role active-user helper grant is preserved');
select ok(not has_function_privilege('anon', 'private.is_active_beta_user(uuid)', 'execute'), 'anon still cannot execute the arbitrary-user active predicate');
select ok(to_regprocedure('public.complete_beta_onboarding(text,text)') is not null, 'the onboarding RPC signature is unchanged');
select ok(has_function_privilege('authenticated', 'public.complete_beta_onboarding(text,text)', 'execute'), 'authenticated onboarding execute remains granted');
select ok(not has_function_privilege('anon', 'public.complete_beta_onboarding(text,text)', 'execute'), 'anonymous onboarding execute remains revoked');
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'enforce_active_profile_city' and not t.tgisinternal
  ),
  'active profile city mutations are trigger-enforced'
);
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.beta_memberships'::regclass
      and t.tgname = 'protect_beta_membership_workflow' and not t.tgisinternal
  ),
  'membership transition enforcement remains installed'
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.complete_beta_onboarding(text,text)'::regprocedure),
  array['search_path=""']::text[],
  'complete_beta_onboarding retains an empty search_path'
);
select ok(position('normalize_profile_city' in pg_get_functiondef('private.is_active_beta_user(uuid)'::regprocedure)) > 0, 'active access depends on the canonical city contract');

-- Mirrors tests/fixtures/city-validation.ts exactly.
select is(private.normalize_profile_city('София'), 'София', 'accepts single Cyrillic name');
select is(private.normalize_profile_city('Стара Загора'), 'Стара Загора', 'accepts multi-word Cyrillic name');
select is(private.normalize_profile_city('Св. Влас'), 'Св. Влас', 'accepts natural punctuation');
select is(private.normalize_profile_city('42'), '42', 'accepts number-only city identifier');
select is(
  private.normalize_profile_city(
    'Стара'
    || chr(x'0020'::int) || chr(x'00A0'::int) || chr(x'1680'::int)
    || chr(x'2000'::int) || chr(x'2001'::int) || chr(x'2002'::int)
    || chr(x'2003'::int) || chr(x'2004'::int) || chr(x'2005'::int)
    || chr(x'2006'::int) || chr(x'2007'::int) || chr(x'2008'::int)
    || chr(x'2009'::int) || chr(x'200A'::int) || chr(x'202F'::int)
    || chr(x'205F'::int) || chr(x'3000'::int) || 'Загора'
  ),
  'Стара Загора',
  'every Unicode Space_Separator collapses to one ASCII space'
);
select is(private.normalize_profile_city(chr(x'3000'::int) || 'София' || chr(x'00A0'::int)), 'София', 'leading and trailing Unicode spaces are trimmed');
select is(private.normalize_profile_city(repeat(chr(x'10400'::int), 2)), repeat(chr(x'10400'::int), 2), 'accepts two astral Unicode letters as two code points');
select is(private.normalize_profile_city(repeat(chr(x'10400'::int), 100)), repeat(chr(x'10400'::int), 100), 'accepts one hundred astral Unicode letters as one hundred code points');
select is(
  private.normalize_profile_city(repeat(' ', 399) || '42'),
  null::text,
  'rejects a 401-byte city before it can normalize to a valid short value'
);

select is(private.normalize_profile_city(''), null::text, 'rejects empty city');
select is(private.normalize_profile_city('   '), null::text, 'rejects ASCII whitespace-only city');
select is(private.normalize_profile_city(chr(x'00A0'::int) || chr(x'00A0'::int)), null::text, 'rejects NBSP-only city');
select is(private.normalize_profile_city(chr(x'200B'::int)), null::text, 'rejects zero-width-format-only city');
select is(private.normalize_profile_city('Со' || chr(x'200B'::int) || 'фия'), null::text, 'rejects embedded zero-width format');
select throws_ok(
  $sql$select convert_from(decode('d0a1d0be00d184d0b8d18f', 'hex'), 'UTF8')$sql$,
  '22021', 'invalid byte sequence for encoding "UTF8": 0x00',
  'PostgreSQL rejects the exact embedded-NUL C0 fixture before SQL text validation'
);
select is(private.normalize_profile_city('Со' || chr(x'0085'::int) || 'фия'), null::text, 'rejects embedded C1 control');
select is(private.normalize_profile_city('---'), null::text, 'rejects punctuation-only city');
select is(private.normalize_profile_city(chr(x'10400'::int)), null::text, 'rejects one Unicode code point');
select is(private.normalize_profile_city(repeat(chr(x'10400'::int), 101)), null::text, 'rejects one hundred and one Unicode code points');

select ok(
  not exists (
    select 1 from (
      select generate_series(x'0001'::int, x'001F'::int) as cp
      union all select generate_series(x'007F'::int, x'009F'::int)
    ) controls
    where private.normalize_profile_city('Со' || chr(controls.cp) || 'фия') is not null
  ),
  'all PostgreSQL-representable C0 and C1 controls are rejected'
);
select ok(
  not exists (
    select 1 from (
      select x'00AD'::int as cp
      union all select generate_series(x'0600'::int, x'0605'::int)
      union all select x'061C'::int union all select x'06DD'::int union all select x'070F'::int
      union all select generate_series(x'0890'::int, x'0891'::int)
      union all select x'08E2'::int union all select x'180E'::int
      union all select generate_series(x'200B'::int, x'200F'::int)
      union all select generate_series(x'202A'::int, x'202E'::int)
      union all select generate_series(x'2060'::int, x'2064'::int)
      union all select generate_series(x'2066'::int, x'206F'::int)
      union all select x'FEFF'::int
      union all select generate_series(x'FFF9'::int, x'FFFB'::int)
      union all select x'110BD'::int union all select x'110CD'::int
      union all select generate_series(x'13430'::int, x'1343F'::int)
      union all select generate_series(x'1BCA0'::int, x'1BCA3'::int)
      union all select generate_series(x'1D173'::int, x'1D17A'::int)
      union all select x'E0001'::int
      union all select generate_series(x'E0020'::int, x'E007F'::int)
    ) format_points
    where private.normalize_profile_city('Со' || chr(format_points.cp) || 'фия') is not null
  ),
  'all 170 Unicode 17.0 Format code points are rejected'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  confirmation_sent_at, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '81111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'city-onboarding@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00',
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"city_onboarding"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '82222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'city-pending@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00',
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"city_pending"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '83333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'city-suspended@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00',
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"city_suspended"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  ),
  (
    '84444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'city-legacy@example.test', 'test-password-hash',
    timestamptz '2026-09-01 08:00:00+00', timestamptz '2026-09-01 08:01:00+00',
    '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"city_legacy"}'::jsonb,
    statement_timestamp(), statement_timestamp()
  );

insert into public.beta_memberships (profile_id, invite_id, status)
values
  ('81111111-1111-4111-8111-111111111111', null, 'pending'),
  ('82222222-2222-4222-8222-222222222222', null, 'pending'),
  ('83333333-3333-4333-8333-333333333333', null, 'pending'),
  ('84444444-4444-4444-8444-444444444444', null, 'pending');

insert into public.beta_consent_events (
  profile_id, document_code, document_version, accepted_at, source
)
select actors.profile_id, d.document_code, d.document_version, statement_timestamp(), 'web'
from (
  values
    ('81111111-1111-4111-8111-111111111111'::uuid),
    ('83333333-3333-4333-8333-333333333333'::uuid),
    ('84444444-4444-4444-8444-444444444444'::uuid)
) actors(profile_id)
cross join public.beta_legal_documents d
where d.required_for_access
  and d.effective_at <= statement_timestamp()
  and d.retired_at is null;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('city_onboarding', '---')$sql$,
  '22023', 'city must be a normalized value containing 2 to 100 Unicode letters or numbers',
  'invalid onboarding city is rejected before mutation'
);
reset role;
set local role postgres;
select ok(
  exists (
    select 1 from public.profiles p
    join public.beta_memberships m on m.profile_id = p.id
    where p.id = '81111111-1111-4111-8111-111111111111'
      and p.city is null and m.status = 'pending'
      and m.onboarding_completed_at is null and m.activated_at is null
  ),
  'invalid onboarding rolls back profile, membership, and timestamps together'
);

set local statement_timeout = '100ms';
set local role authenticated;
select set_config('request.jwt.claim.sub', '82222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $sql$select public.complete_beta_onboarding('city_pending', repeat(' ', 1000000) || 'София')$sql$,
  '22023', 'city must be a normalized value containing 2 to 100 Unicode letters or numbers',
  'authenticated onboarding rejects very large otherwise-normalizable city input within the local statement timeout'
);
reset role;
set local role postgres;
set local statement_timeout = 0;
select ok(
  exists (
    select 1 from public.profiles p
    join public.beta_memberships m on m.profile_id = p.id
    where p.id = '82222222-2222-4222-8222-222222222222'
      and p.city is null and m.status = 'pending'
      and m.onboarding_completed_at is null and m.activated_at is null
      and m.updated_at = m.created_at
  ),
  'oversized onboarding leaves the pending profile and membership unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $sql$select public.complete_beta_onboarding('city_onboarding', '  Стара  Загора  ')$sql$,
  'valid onboarding normalizes city and activates atomically'
);
reset role;
set local role postgres;
select ok(
  exists (
    select 1 from public.profiles p
    join public.beta_memberships m on m.profile_id = p.id
    where p.id = '81111111-1111-4111-8111-111111111111'
      and p.city = 'Стара Загора' and m.status = 'active'
      and m.onboarding_completed_at is not null and m.activated_at is not null
  ),
  'onboarding stores the canonical city and active membership timestamps'
);
-- pgTAP wraps the whole file in one transaction, so now() predates the
-- statement_timestamp() assigned during onboarding. Move the activation into
-- the transaction's past before exercising the stable access predicate.
update public.beta_memberships
set activated_at = now() - interval '1 second'
where profile_id = '81111111-1111-4111-8111-111111111111';
select ok(private.is_active_beta_user('81111111-1111-4111-8111-111111111111'), 'a confirmed, consented, onboarded actor with canonical city is active');
select throws_ok(
  $sql$update public.profiles set city = '---' where id = '81111111-1111-4111-8111-111111111111'$sql$,
  '22023', 'active profiles require a canonical city',
  'direct invalid city mutation on an active membership is rejected'
);
select is((select city from public.profiles where id = '81111111-1111-4111-8111-111111111111'), 'Стара Загора', 'a rejected active city mutation leaves the stored city unchanged');
select ok(private.is_active_beta_user('81111111-1111-4111-8111-111111111111'), 'a rejected city mutation leaves effective access unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $sql$update public.profiles set role = 'admin' where id = '81111111-1111-4111-8111-111111111111'$sql$,
  '42501', 'privileged profile fields cannot be changed by this user',
  'city enforcement does not weaken privileged profile-field protection'
);
reset role;
set local role postgres;
select is((select role::text from public.profiles where id = '81111111-1111-4111-8111-111111111111'), 'user', 'the rejected privileged update leaves the role unchanged');
update public.profiles set role = 'admin' where id = '81111111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}', true);
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);
select ok(not public.is_staff(), 'AAL1 remains insufficient for staff database privileges');
select set_config('request.jwt.claims', '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
select ok(public.is_staff(), 'AAL2 staff access remains available with canonical city');
reset role;
set local role postgres;

select lives_ok($sql$update public.profiles set city = '---' where id = '82222222-2222-4222-8222-222222222222'$sql$, 'pending profiles may retain an invalid city');
select lives_ok($sql$update public.profiles set city = null where id = '82222222-2222-4222-8222-222222222222'$sql$, 'pending profiles may retain a null city');
select throws_ok(
  $sql$update public.beta_memberships set status = 'active' where profile_id = '82222222-2222-4222-8222-222222222222'$sql$,
  '22023', 'active memberships require a canonical profile city',
  'pending to active transition is rejected when stored city is invalid'
);
select ok(
  exists (
    select 1 from public.beta_memberships
    where profile_id = '82222222-2222-4222-8222-222222222222'
      and status = 'pending' and onboarding_completed_at is null
      and activated_at is null and updated_at = created_at
  ),
  'rejected pending activation leaves status and timestamps unchanged'
);

update public.profiles set city = 'София'
where id in ('83333333-3333-4333-8333-333333333333', '84444444-4444-4444-8444-444444444444');
update public.beta_memberships set status = 'active'
where profile_id in ('83333333-3333-4333-8333-333333333333', '84444444-4444-4444-8444-444444444444');
update public.beta_memberships set status = 'suspended'
where profile_id = '83333333-3333-4333-8333-333333333333';

select lives_ok($sql$update public.profiles set city = '---' where id = '83333333-3333-4333-8333-333333333333'$sql$, 'a suspended profile can remain invalid until reactivation');
select throws_ok(
  $sql$update public.beta_memberships set status = 'active' where profile_id = '83333333-3333-4333-8333-333333333333'$sql$,
  '22023', 'active memberships require a canonical profile city',
  'suspended to active transition is rejected when stored city is invalid'
);
select is((select status::text from public.beta_memberships where profile_id = '83333333-3333-4333-8333-333333333333'), 'suspended', 'rejected suspended reactivation leaves membership status unchanged');

set local session_replication_role = replica;
update public.profiles set city = '---' where id = '84444444-4444-4444-8444-444444444444';
set local session_replication_role = origin;
select ok(not private.is_active_beta_user('84444444-4444-4444-8444-444444444444'), 'a legacy invalid active row immediately loses effective access');

select * from finish();
rollback;
