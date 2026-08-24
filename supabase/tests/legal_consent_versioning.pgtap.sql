begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(18);

select is(
  (
    select count(*)::integer
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-07-22'
  ),
  2,
  'both historical provisional document rows survive version activation'
);
select ok(
  not exists (
    select 1
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-07-22'
      and d.retired_at is distinct from timestamptz '2026-08-24 00:00:00+03'
  ),
  'superseded document rows are retired at the new version boundary'
);
select is(
  (
    select count(*)::integer
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-08-24-provisional.1'
      and d.retired_at is null
  ),
  2,
  'both provisional document versions are current'
);
select ok(
  not exists (
    select 1
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-08-24-provisional.1'
      and d.effective_at is distinct from timestamptz '2026-08-24 00:00:00+03'
  ),
  'both provisional documents use the owner-approved effective timestamp'
);
select ok(
  not exists (
    select 1
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-08-24-provisional.1'
      and not d.required_for_access
  ),
  'both provisional documents remain required for access'
);
select is(
  (
    select count(*)::integer
    from public.beta_legal_documents d
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.retired_at is null
  ),
  2,
  'each versioned document code has exactly one current row'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a6111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'consent-versioning@example.test', '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"consent_versioning"}'::jsonb,
  statement_timestamp(), statement_timestamp()
);

update public.profiles
set email_verified_at = statement_timestamp(), city = 'Sofia'
where id = 'a6111111-1111-4111-8111-111111111111';

insert into public.beta_memberships (profile_id, invite_id, status)
values ('a6111111-1111-4111-8111-111111111111', null, 'pending');
update public.beta_memberships
set status = 'active'
where profile_id = 'a6111111-1111-4111-8111-111111111111';
update public.beta_memberships
set activated_at = now() - interval '1 second'
where profile_id = 'a6111111-1111-4111-8111-111111111111';

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select
  'a6111111-1111-4111-8111-111111111111',
  d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.document_version = '2026-07-22';

select is(
  (
    select count(*)::integer
    from public.beta_consent_events c
    where c.profile_id = 'a6111111-1111-4111-8111-111111111111'
      and c.document_version = '2026-07-22'
  ),
  4,
  'historical acceptances exist for every original required document'
);
select ok(
  not private.is_active_beta_user('a6111111-1111-4111-8111-111111111111'),
  'accepting only superseded versions leaves consent stale'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a6111111-1111-4111-8111-111111111111';

select throws_ok(
  $sql$select public.accept_beta_consent('beta_terms', '2026-07-22')$sql$,
  '23514',
  'document version is not current',
  'the consent RPC rejects a superseded document version'
);
select lives_ok(
  $sql$select public.accept_beta_consent('beta_terms', '2026-08-24-provisional.1')$sql$,
  'the user can affirmatively accept the current Terms version'
);

reset role;
set local role postgres;
select ok(
  exists (
    select 1
    from public.beta_consent_events c
    where c.profile_id = 'a6111111-1111-4111-8111-111111111111'
      and c.document_code = 'beta_terms'
      and c.document_version = '2026-08-24-provisional.1'
  ),
  'the current Terms acceptance is recorded separately'
);
select ok(
  not private.is_active_beta_user('a6111111-1111-4111-8111-111111111111'),
  'accepting only one newly required version keeps access closed'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a6111111-1111-4111-8111-111111111111';
select lives_ok(
  $sql$select public.accept_beta_consent('marketplace_rules', '2026-08-24-provisional.1')$sql$,
  'the user can affirmatively accept the current Marketplace Rules version'
);

reset role;
set local role postgres;
select ok(
  exists (
    select 1
    from public.beta_consent_events c
    where c.profile_id = 'a6111111-1111-4111-8111-111111111111'
      and c.document_code = 'marketplace_rules'
      and c.document_version = '2026-08-24-provisional.1'
  ),
  'the current Marketplace Rules acceptance is recorded separately'
);
select is(
  (
    select count(*)::integer
    from public.beta_consent_events c
    where c.profile_id = 'a6111111-1111-4111-8111-111111111111'
      and c.document_version = '2026-07-22'
  ),
  4,
  'accepting current versions preserves every historical consent event'
);
select ok(
  private.is_active_beta_user('a6111111-1111-4111-8111-111111111111'),
  'access returns only after every current required version is accepted'
);
select ok(
  has_table_privilege('anon', 'public.beta_legal_documents', 'select')
    and has_table_privilege('authenticated', 'public.beta_legal_documents', 'select'),
  'public legal-document read privileges remain available for re-consent'
);
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.beta_legal_documents'::regclass)
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.beta_consent_events'::regclass),
  'legal documents and consent evidence retain row-level security'
);

select * from finish();
rollback;
