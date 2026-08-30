begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(35);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('24100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-reporter@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_reporter"}', now(), now()),
  ('24100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-target@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_target"}', now(), now()),
  ('24100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-mod-one@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_mod_one"}', now(), now()),
  ('24100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-mod-two@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_mod_two"}', now(), now()),
  ('24100000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_admin"}', now(), now());

update public.profiles
set email_verified_at = now(),
    phone_verified_at = now(),
    role = case id
      when '24100000-0000-4000-8000-000000000003'::uuid then 'moderator'::public.platform_role
      when '24100000-0000-4000-8000-000000000004'::uuid then 'moderator'::public.platform_role
      when '24100000-0000-4000-8000-000000000005'::uuid then 'admin'::public.platform_role
      else role
    end
where id in (
  '24100000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000002',
  '24100000-0000-4000-8000-000000000003',
  '24100000-0000-4000-8000-000000000004',
  '24100000-0000-4000-8000-000000000005'
);

insert into public.beta_invites (id, email, token_hash, status, expires_at)
values
  ('24200000-0000-4000-8000-000000000001', 'issue24-reporter@example.test', repeat('1', 64), 'pending', now() + interval '7 days'),
  ('24200000-0000-4000-8000-000000000002', 'issue24-target@example.test', repeat('2', 64), 'pending', now() + interval '7 days'),
  ('24200000-0000-4000-8000-000000000003', 'issue24-mod-one@example.test', repeat('3', 64), 'pending', now() + interval '7 days'),
  ('24200000-0000-4000-8000-000000000004', 'issue24-mod-two@example.test', repeat('4', 64), 'pending', now() + interval '7 days'),
  ('24200000-0000-4000-8000-000000000005', 'issue24-admin@example.test', repeat('5', 64), 'pending', now() + interval '7 days');

update public.beta_invites
set status = 'accepted',
    accepted_by = ('24100000-0000-4000-8000-' || right(id::text, 12))::uuid
where id in (
  '24200000-0000-4000-8000-000000000001',
  '24200000-0000-4000-8000-000000000002',
  '24200000-0000-4000-8000-000000000003',
  '24200000-0000-4000-8000-000000000004',
  '24200000-0000-4000-8000-000000000005'
);

insert into public.beta_memberships (profile_id, invite_id, status)
select accepted_by, id, 'pending'
from public.beta_invites
where id in (
  '24200000-0000-4000-8000-000000000001',
  '24200000-0000-4000-8000-000000000002',
  '24200000-0000-4000-8000-000000000003',
  '24200000-0000-4000-8000-000000000004',
  '24200000-0000-4000-8000-000000000005'
);

update public.beta_memberships
set status = 'active'
where profile_id in (
  '24100000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000002',
  '24100000-0000-4000-8000-000000000003',
  '24100000-0000-4000-8000-000000000004',
  '24100000-0000-4000-8000-000000000005'
);
update public.beta_memberships
set activated_at = now() - interval '1 second'
where profile_id in (
  '24100000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000002',
  '24100000-0000-4000-8000-000000000003',
  '24100000-0000-4000-8000-000000000004',
  '24100000-0000-4000-8000-000000000005'
);

insert into public.beta_consent_events (profile_id, document_code, document_version, source)
select m.profile_id, d.document_code, d.document_version, 'web'
from public.beta_memberships m
cross join public.beta_legal_documents d
where m.profile_id in (
  '24100000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000002',
  '24100000-0000-4000-8000-000000000003',
  '24100000-0000-4000-8000-000000000004',
  '24100000-0000-4000-8000-000000000005'
)
  and d.required_for_access
  and d.retired_at is null;

insert into public.brands (id, canonical_name, slug, status, normalized_key)
values ('24300000-0000-4000-8000-000000000001', 'Issue 24 Brand', 'issue-24-brand', 'canonical', 'issue 24 brand');

set local session_replication_role = replica;
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
) values (
  '24400000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000002',
  'offer', 'sale', 'retail_bottle', 'unisex',
  '24300000-0000-4000-8000-000000000001',
  'Issue 24 Fragrance', 'EDP', 'Issue 24 listing', 'Moderation fixture', 'Sofia',
  100, 90, false, 10000, 'active', 'issue-24-listing', now(), now() + interval '30 days'
);

insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, evidence_paths,
  status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at
) values
  ('24500000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'counterfeit', 'Private report details', '["reports/private-evidence.jpg"]', 'open', null, null, null, null, now() - interval '3 hours', now() - interval '3 hours'),
  ('24500000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'misleading', 'Resolved private details', '[]', 'resolved', '24100000-0000-4000-8000-000000000003', 'internal_future_code', 'Private staff rationale', now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 hour'),
  ('24500000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', 'profile', '24100000-0000-4000-8000-000000000003', 'harassment', 'Self-target must be ineligible', '[]', 'open', null, null, null, null, now() - interval '90 minutes', now() - interval '90 minutes'),
  ('24500000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', 'brand', '24300000-0000-4000-8000-000000000001', 'incorrect_brand', 'Unsupported target type', '[]', 'open', null, null, null, null, now() - interval '60 minutes', now() - interval '60 minutes'),
  ('24500000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'duplicate', 'Second claimable report', '[]', 'open', null, null, null, null, now() - interval '30 minutes', now() - interval '30 minutes');
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}', true);

select throws_ok(
  $$select * from public.list_moderation_report_queue(50, 0)$$,
  '42501', 'active AAL2 staff access required',
  'an AAL1 moderator cannot list the queue'
);
select throws_ok(
  $$select * from public.get_assigned_moderation_case('24500000-0000-4000-8000-000000000001')$$,
  '42501', 'assigned moderation case required',
  'an AAL1 moderator cannot inspect a private case'
);

select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select ok(public.is_staff(), 'the current AAL2 moderator fixture is target-queue eligible');
select throws_ok(
  $$select * from public.list_moderation_report_queue(50, -1)$$,
  '22023', 'page offset must be non-negative',
  'the staff queue rejects a negative offset'
);
select is((select count(*) from public.list_moderation_report_queue(0, 0)), 1::bigint, 'the staff queue clamps page size to at least one');
select is(
  (
    select array_agg(report_id order by report_id)
    from public.list_moderation_report_queue(1000, 0)
    where report_id in (
      '24500000-0000-4000-8000-000000000001',
      '24500000-0000-4000-8000-000000000002',
      '24500000-0000-4000-8000-000000000003',
      '24500000-0000-4000-8000-000000000004',
      '24500000-0000-4000-8000-000000000005'
    )
  ),
  array[
    '24500000-0000-4000-8000-000000000001'::uuid,
    '24500000-0000-4000-8000-000000000005'::uuid
  ],
  'the staff queue clamps page size and excludes resolved, unsupported, and self-target cases'
);
select is(
  (
    select array_agg(key order by key)
    from (select * from public.list_moderation_report_queue(1, 0) limit 1) q
    cross join lateral jsonb_object_keys(to_jsonb(q)) key
  ),
  array['assignment_state','created_at','reason_code','report_id','status','target_type']::text[],
  'the queue exposes only the approved safe-summary fields'
);
select is(
  (select assignment_state from public.list_moderation_report_queue(100, 0) where report_id = '24500000-0000-4000-8000-000000000001'),
  'unassigned',
  'an open eligible report is shown as unassigned'
);

select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000001'), 'claimed', 'an eligible AAL2 moderator atomically claims an open report');
reset role;
set local role postgres;
select is((select count(*) from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000001' and action = 'report_assigned'), 1::bigint, 'a successful claim writes exactly one assignment audit row');

set local role authenticated;
select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000001'), 'already_claimed_by_you', 'retrying the same claim is idempotent');
reset role;
set local role postgres;
select is((select count(*) from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000001' and action = 'report_assigned'), 1::bigint, 'an idempotent retry does not duplicate assignment audit');

set local role authenticated;
select is((select count(*) from public.get_assigned_moderation_case('24500000-0000-4000-8000-000000000001')), 1::bigint, 'the exact assignee can load private case detail');
select is(
  (
    select array_agg(key order by key)
    from (select * from public.get_assigned_moderation_case('24500000-0000-4000-8000-000000000001')) c
    cross join lateral jsonb_object_keys(to_jsonb(c)) key
  ),
  array['assigned_to','audit_entries','created_at','details','evidence_paths','reason_code','report_id','reporter_id','resolution_code','resolution_notes','resolved_at','status','target_id','target_type','updated_at']::text[],
  'private case detail has the complete approved assigned-case shape'
);

select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000001'), 'unavailable', 'a competing moderator receives the generic unavailable result');
select throws_ok(
  $$select * from public.get_assigned_moderation_case('24500000-0000-4000-8000-000000000001')$$,
  '42501', 'assigned moderation case required',
  'a non-assignee cannot load private case detail'
);
select throws_ok(
  $$update public.reports set status = 'resolved', resolved_at = now() where id = '24500000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table reports',
  'authenticated staff cannot bypass workflow RPCs with a direct report update'
);

select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000001'), 'unavailable', 'an administrator has no claim bypass over another assignee');
select throws_ok(
  $$select public.moderate_listing('24500000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', 'Wrong actor decision attempt.', null, null, 'removed')$$,
  '42501', 'assigned moderation case required',
  'an administrator cannot decide another moderator case'
);
reset role;
set local role postgres;
select is((select status::text from public.reports where id = '24500000-0000-4000-8000-000000000001'), 'investigating', 'wrong-actor denial leaves the report unchanged');
select is((select status::text from public.listings where id = '24400000-0000-4000-8000-000000000001'), 'active', 'wrong-actor denial leaves the target unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.moderate_listing('24500000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000099', 'Mismatched target attempt.', null, null, 'removed')$$,
  '42501', 'assigned moderation case required',
  'the exact assignee cannot decide a mismatched target'
);
select lives_ok(
  $$select public.moderate_listing('24500000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', 'Verified Issue 24 decision.', null, null, 'removed')$$,
  'the exact assignee can decide the target and report atomically'
);
reset role;
set local role postgres;
select is((select status::text from public.reports where id = '24500000-0000-4000-8000-000000000001'), 'resolved', 'the decision atomically resolves the report');
select is((select status::text from public.listings where id = '24400000-0000-4000-8000-000000000001'), 'removed', 'the decision atomically mutates the target');
select is((select count(*) from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000001' and action = 'content_removed'), 1::bigint, 'the decision atomically writes one target-action audit row');

set local role authenticated;
select throws_ok(
  $$select public.moderate_listing('24500000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', 'Terminal retry attempt.', null, null, 'removed')$$,
  '42501', 'assigned moderation case required',
  'a terminal report cannot be decided again'
);
select throws_ok(
  $$update public.moderation_audit set rationale = 'Rewritten rationale' where report_id = '24500000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table moderation_audit',
  'moderation audit rows remain append-only to authenticated staff'
);
select throws_ok(
  $$delete from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table moderation_audit',
  'moderation audit rows cannot be deleted by authenticated staff'
);

select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select * from public.list_my_reports(50, -1)$$,
  '22023', 'page offset must be non-negative',
  'report history rejects a negative offset'
);
select is((select count(*) from public.list_my_reports(0, 0)), 1::bigint, 'report history clamps page size to at least one');
select is(
  (
    select array_agg(key order by key)
    from (select * from public.list_my_reports(1, 0) limit 1) r
    cross join lateral jsonb_object_keys(to_jsonb(r)) key
  ),
  array['created_at','evidence_count','outcome','reason_code','report_id','resolved_at','status','target_type','updated_at']::text[],
  'report history exposes only approved reporter-safe fields'
);
select is((select outcome from public.list_my_reports(100, 0) where report_id = '24500000-0000-4000-8000-000000000002'), 'completed', 'an unknown internal resolution maps to a generic reporter outcome');
select is((select count(*) from public.list_my_reports(100, 0)), 5::bigint, 'a reporter can list only their own report receipts');
select throws_ok(
  $$select details from public.reports where reporter_id = '24100000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table reports',
  'a reporter cannot bypass the safe projection with a direct table read'
);

select * from finish();
rollback;
