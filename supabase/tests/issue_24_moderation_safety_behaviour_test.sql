begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(53);

create function pg_temp.filtered_report_page(
  page_size integer,
  page_offset integer,
  filter_status public.report_status
)
returns table (
  report_id uuid,
  status public.report_status,
  total_count bigint,
  created_at timestamptz
)
language plpgsql
as $$
begin
  if to_regprocedure('public.list_my_reports(integer,integer,public.report_status)') is null then
    return;
  end if;

  return query execute
    'select report_id, status, total_count, created_at from public.list_my_reports($1, $2, $3)'
    using page_size, page_offset, filter_status;
end;
$$;

select is(
  (
    select jsonb_object_agg(
      target_type::text,
      private.report_target_capability(target_type)
    )
    from unnest(enum_range(null::public.report_target_type)) target_type
  ),
  '{
    "profile":"target_action",
    "brand":"safe_disposition",
    "listing":"target_action",
    "offer":"safe_disposition",
    "conversation":"target_action",
    "message":"target_action",
    "deal":"target_action",
    "review":"target_action",
    "profile_comment":"target_action"
  }'::jsonb,
  'the database capability matrix covers every report target type'
);

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
set city = 'Sofia',
    email_verified_at = now(),
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

insert into public.brands (id, canonical_name, slug, status, normalized_key, submitted_display_name, created_by)
values
  ('24300000-0000-4000-8000-000000000001', 'Issue 24 Pending Brand', 'issue-24-pending-brand', 'pending_canonicalization', 'issue 24 pending brand', 'Issue 24 Pending Brand', '24100000-0000-4000-8000-000000000002'),
  ('24300000-0000-4000-8000-000000000002', 'Issue 24 Canonical Brand', 'issue-24-canonical-brand', 'canonical', 'issue 24 canonical brand', null, null);

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

insert into public.upload_quarantine (
  id, uploader_id, listing_id, requested_role, quarantine_path,
  declared_mime_type, declared_byte_size, status, processor_request_id,
  final_storage_path, claimed_at, finalized_at
) values
  ('24800000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000001', 'product_full', '24100000-0000-4000-8000-000000000002/24400000-0000-4000-8000-000000000001/24800000-0000-4000-8000-000000000001/source.jpg', 'image/jpeg', 100, 'finalized', 'issue-24-photo-1', 'issue-24/final-1.webp', now(), now()),
  ('24800000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000001', 'bottle_bottom', '24100000-0000-4000-8000-000000000002/24400000-0000-4000-8000-000000000001/24800000-0000-4000-8000-000000000002/source.jpg', 'image/jpeg', 100, 'finalized', 'issue-24-photo-2', 'issue-24/final-2.webp', now(), now()),
  ('24800000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000001', 'batch_code', '24100000-0000-4000-8000-000000000002/24400000-0000-4000-8000-000000000001/24800000-0000-4000-8000-000000000003/source.jpg', 'image/jpeg', 100, 'finalized', 'issue-24-photo-3', 'issue-24/final-3.webp', now(), now()),
  ('24800000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000001', 'fill_level', '24100000-0000-4000-8000-000000000002/24400000-0000-4000-8000-000000000001/24800000-0000-4000-8000-000000000004/source.jpg', 'image/jpeg', 100, 'finalized', 'issue-24-photo-4', 'issue-24/final-4.webp', now(), now());

insert into public.listing_photos (
  id, listing_id, storage_path, role, content_hash, mime_type,
  byte_size, width_px, height_px, sanitized_at, source_upload_id
) values
  ('24900000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', 'issue-24/final-1.webp', 'product_full', repeat('1', 64), 'image/webp', 100, 10, 10, now(), '24800000-0000-4000-8000-000000000001'),
  ('24900000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000001', 'issue-24/final-2.webp', 'bottle_bottom', repeat('2', 64), 'image/webp', 100, 10, 10, now(), '24800000-0000-4000-8000-000000000002'),
  ('24900000-0000-4000-8000-000000000003', '24400000-0000-4000-8000-000000000001', 'issue-24/final-3.webp', 'batch_code', repeat('3', 64), 'image/webp', 100, 10, 10, now(), '24800000-0000-4000-8000-000000000003'),
  ('24900000-0000-4000-8000-000000000004', '24400000-0000-4000-8000-000000000001', 'issue-24/final-4.webp', 'fill_level', repeat('4', 64), 'image/webp', 100, 10, 10, now(), '24800000-0000-4000-8000-000000000004');

insert into public.offers (
  id, listing_id, offerer_id, kind, cash_amount_minor, status, expires_at
) values (
  '24400000-0000-4000-8000-000000000002',
  '24400000-0000-4000-8000-000000000001',
  '24100000-0000-4000-8000-000000000001',
  'cash', 5000, 'pending', now() + interval '7 days'
);

insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, evidence_paths,
  status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at
) values
  ('24500000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'counterfeit', 'Private report details', '["reports/private-evidence.jpg"]', 'open', null, null, null, null, now() - interval '3 hours', now() - interval '3 hours'),
  ('24500000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'misleading', 'Resolved private details', '[]', 'resolved', '24100000-0000-4000-8000-000000000003', 'internal_future_code', 'Private staff rationale', now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 hour'),
  ('24500000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', 'profile', '24100000-0000-4000-8000-000000000003', 'harassment', 'Self-target must be ineligible', '[]', 'open', null, null, null, null, now() - interval '90 minutes', now() - interval '90 minutes'),
  ('24500000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', 'brand', '24300000-0000-4000-8000-000000000001', 'incorrect_brand', 'Legacy brand report requiring safe disposition', '[]', 'open', null, null, null, null, now() - interval '60 minutes', now() - interval '60 minutes'),
  ('24500000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000001', 'listing', '24400000-0000-4000-8000-000000000001', 'duplicate', 'Second claimable report', '[]', 'open', null, null, null, null, now() - interval '30 minutes', now() - interval '30 minutes'),
  ('24500000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-000000000001', 'offer', '24400000-0000-4000-8000-000000000002', 'spam_fraud', 'Legacy offer report requiring safe disposition', '[]', 'open', null, null, null, null, now() - interval '45 minutes', now() - interval '45 minutes');

insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, evidence_paths,
  status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at
)
select
  ('24600000-0000-4000-8000-' || lpad(fixture_number::text, 12, '0'))::uuid,
  '24100000-0000-4000-8000-000000000002',
  'listing',
  '24400000-0000-4000-8000-000000000001',
  'counterfeit',
  'Queue aging regression fixture',
  '[]',
  'open',
  null,
  null,
  null,
  null,
  case
    when fixture_number in (1, 2) then timestamptz '2000-01-01 00:00:00+00'
    else timestamptz '2000-01-02 00:00:00+00' + fixture_number * interval '1 minute'
  end,
  case
    when fixture_number in (1, 2) then timestamptz '2000-01-01 00:00:00+00'
    else timestamptz '2000-01-02 00:00:00+00' + fixture_number * interval '1 minute'
  end
from generate_series(1, 52) fixture_number;

insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, evidence_paths,
  status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at
)
select
  ('24700000-0000-4000-8000-' || lpad(fixture_number::text, 12, '0'))::uuid,
  '24100000-0000-4000-8000-000000000002',
  'listing',
  '24400000-0000-4000-8000-000000000001',
  'counterfeit',
  'Reporter pagination regression fixture',
  '[]',
  case
    when fixture_number in (1, 2, 4, 6, 8) then 'resolved'::public.report_status
    else 'open'::public.report_status
  end,
  case when fixture_number in (1, 2, 4, 6, 8) then '24100000-0000-4000-8000-000000000003'::uuid else null end,
  case when fixture_number in (1, 2, 4, 6, 8) then 'no_violation' else null end,
  case when fixture_number in (1, 2, 4, 6, 8) then 'Reporter-safe resolved fixture' else null end,
  case when fixture_number in (1, 2, 4, 6, 8) then timestamptz '2002-01-01 00:00:00+00' + fixture_number * interval '1 day' else null end,
  timestamptz '2002-01-01 00:00:00+00' + fixture_number * interval '1 day',
  timestamptz '2002-01-01 00:00:00+00' + fixture_number * interval '1 day'
from generate_series(1, 9) fixture_number;
set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$insert into public.reports (reporter_id, target_type, target_id, reason_code)
    values ('24100000-0000-4000-8000-000000000001', 'brand', '24300000-0000-4000-8000-000000000001', 'other_violation')$$,
  '22023', 'report target is not supported for submission',
  'brand reports are rejected before insertion'
);
select throws_ok(
  $$insert into public.reports (reporter_id, target_type, target_id, reason_code)
    values ('24100000-0000-4000-8000-000000000001', 'offer', '24400000-0000-4000-8000-000000000002', 'other_violation')$$,
  '22023', 'report target is not supported for submission',
  'offer reports are rejected before insertion'
);

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
select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000004'), 'claimed', 'an AAL2 moderator can claim a legacy brand report for safe disposition');
select throws_ok(
  $$select public.canonicalize_brand(
    '24500000-0000-4000-8000-000000000004',
    '24300000-0000-4000-8000-000000000001',
    '24300000-0000-4000-8000-000000000002',
    'Direct legacy brand mutation must remain unavailable.'
  )$$,
  '42501', 'permission denied for function canonicalize_brand',
  'authenticated moderators cannot bypass safe disposition with direct legacy brand canonicalization'
);
reset role;
set local role postgres;
select is((select status::text from public.reports where id = '24500000-0000-4000-8000-000000000004'), 'investigating', 'denied legacy brand canonicalization leaves the report investigating');
select is((select brand_id from public.listings where id = '24400000-0000-4000-8000-000000000001'), '24300000-0000-4000-8000-000000000001'::uuid, 'denied legacy brand canonicalization leaves the listing on the pending brand');
select is((select status::text from public.brands where id = '24300000-0000-4000-8000-000000000001'), 'pending_canonicalization', 'denied legacy brand canonicalization leaves the pending brand unchanged');
select is((select count(*) from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000004' and action = 'brand_merged'), 0::bigint, 'denied legacy brand canonicalization writes no brand-merged audit');

set local role authenticated;
select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select * from public.list_moderation_report_queue(50, -1)$$,
  '22023', 'page offset must be non-negative',
  'the staff queue rejects a negative offset'
);
select is((select count(*) from public.list_moderation_report_queue(0, 0)), 1::bigint, 'the staff queue clamps page size to at least one');
select is(
  (select report_id from public.list_moderation_report_queue(50, 0) limit 1),
  '24600000-0000-4000-8000-000000000001'::uuid,
  'the oldest eligible unassigned report remains visible on the 50-case queue page'
);
select results_eq(
  $$
    select report_id
    from public.list_moderation_report_queue(100, 0)
    where created_at = timestamptz '2000-01-01 00:00:00+00'
  $$,
  $$
    values
      ('24600000-0000-4000-8000-000000000001'::uuid),
      ('24600000-0000-4000-8000-000000000002'::uuid)
  $$,
  'equal queue timestamps use report id as a stable ascending tie-breaker'
);
select is(
  (
    select array_agg(report_id order by report_id)
    from public.list_moderation_report_queue(1000, 0)
    where report_id in (
      '24500000-0000-4000-8000-000000000001',
      '24500000-0000-4000-8000-000000000002',
      '24500000-0000-4000-8000-000000000003',
      '24500000-0000-4000-8000-000000000004',
      '24500000-0000-4000-8000-000000000005',
      '24500000-0000-4000-8000-000000000006'
    )
  ),
  array[
    '24500000-0000-4000-8000-000000000001'::uuid,
    '24500000-0000-4000-8000-000000000004'::uuid,
    '24500000-0000-4000-8000-000000000005'::uuid,
    '24500000-0000-4000-8000-000000000006'::uuid
  ],
  'the staff queue clamps page size, excludes resolved and self-target cases, and retains legacy reports with a safe disposition path'
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
select is(public.claim_moderation_report('24500000-0000-4000-8000-000000000006'), 'claimed', 'a legacy offer report remains claimable for safe disposition');
select lives_ok(
  $$select public.resolve_unsupported_report('24500000-0000-4000-8000-000000000006', 'The legacy target has no safe target mutation and is closed without action.')$$,
  'the exact assignee can safely dispose a legacy unsupported report'
);
reset role;
set local role postgres;
select is((select status::text from public.reports where id = '24500000-0000-4000-8000-000000000006'), 'dismissed', 'safe legacy disposition closes the report without mutating its target');
select is((select count(*) from public.moderation_audit where report_id = '24500000-0000-4000-8000-000000000006' and action = 'report_resolved'), 1::bigint, 'safe legacy disposition appends exactly one resolution audit');

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
  array['created_at','evidence_count','outcome','reason_code','report_id','resolved_at','status','target_type','total_count','updated_at']::text[],
  'report history exposes only approved reporter-safe fields'
);
select is((select outcome from public.list_my_reports(100, 0) where report_id = '24500000-0000-4000-8000-000000000002'), 'completed', 'an unknown internal resolution maps to a generic reporter outcome');
select is((select count(*) from public.list_my_reports(100, 0)), 6::bigint, 'a reporter can list only their own report receipts');
select throws_ok(
  $$select details from public.reports where reporter_id = '24100000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table reports',
  'a reporter cannot bypass the safe projection with a direct table read'
);

select set_config('request.jwt.claim.sub', '24100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"24100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$
    select report_id, status, total_count
    from pg_temp.filtered_report_page(3, 0, 'resolved'::public.report_status)
  $$,
  $$
    values
      ('24700000-0000-4000-8000-000000000008'::uuid, 'resolved'::public.report_status, 5::bigint),
      ('24700000-0000-4000-8000-000000000006'::uuid, 'resolved'::public.report_status, 5::bigint),
      ('24700000-0000-4000-8000-000000000004'::uuid, 'resolved'::public.report_status, 5::bigint)
  $$,
  'report status filtering happens before the first page and reports the full filtered total'
);
select results_eq(
  $$
    select report_id, status, total_count
    from pg_temp.filtered_report_page(3, 3, 'resolved'::public.report_status)
  $$,
  $$
    values
      ('24700000-0000-4000-8000-000000000002'::uuid, 'resolved'::public.report_status, 5::bigint),
      ('24700000-0000-4000-8000-000000000001'::uuid, 'resolved'::public.report_status, 5::bigint)
  $$,
  'the continuation page contains only the remaining filtered reports'
);
select results_eq(
  $$
    select report_id
    from (
      select 1 as page_number, report_id, created_at
      from pg_temp.filtered_report_page(3, 0, 'resolved'::public.report_status)
      union all
      select 2 as page_number, report_id, created_at
      from pg_temp.filtered_report_page(3, 3, 'resolved'::public.report_status)
    ) filtered_pages
    order by page_number, created_at desc, report_id desc
  $$,
  $$
    values
      ('24700000-0000-4000-8000-000000000008'::uuid),
      ('24700000-0000-4000-8000-000000000006'::uuid),
      ('24700000-0000-4000-8000-000000000004'::uuid),
      ('24700000-0000-4000-8000-000000000002'::uuid),
      ('24700000-0000-4000-8000-000000000001'::uuid)
  $$,
  'filtered continuation pages contain every matching report exactly once without gaps'
);

select * from finish();
rollback;
