begin;

select plan(36);

select ok(
  to_regclass('public.report_evidence_uploads') is not null,
  'report evidence uses an explicit allocation/finalization ledger'
);
select ok(
  not has_table_privilege('authenticated', 'public.report_evidence_uploads', 'select')
  and not has_table_privilege('authenticated', 'public.report_evidence_uploads', 'insert')
  and not has_table_privilege('authenticated', 'public.report_evidence_uploads', 'update'),
  'authenticated clients cannot read or mutate the evidence ledger directly'
);
select ok(
  has_function_privilege(
    'service_role', 'public.expire_report_evidence_uploads(integer)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.expire_report_evidence_uploads(integer)', 'execute'
  ),
  'only the service role can run the bounded evidence expiry sweep'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reject_unattached_report_evidence_uploads(uuid[],text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reject_unattached_report_evidence_uploads(uuid[],text)',
    'execute'
  ),
  'only the service role can reconcile unattached evidence after ambiguous failures'
);

set local role postgres;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
(
  '00000000-0000-0000-0000-000000000000',
  '12111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'evidence-owner@example.test',
  crypt('EvidenceOwner123!', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Evidence Owner"}'::jsonb
),
(
  '00000000-0000-0000-0000-000000000000',
  '12222222-2222-4222-8222-222222222222',
  'authenticated', 'authenticated', 'evidence-target@example.test',
  crypt('EvidenceTarget123!', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Evidence Target"}'::jsonb
);
update public.profiles
set email_verified_at = statement_timestamp(),
    phone_verified_at = statement_timestamp()
where id = '12111111-1111-4111-8111-111111111111';

insert into public.beta_invites (
  id, email, token_hash, status, expires_at
) values (
  '12333333-3333-4333-8333-333333333333',
  'evidence-owner@example.test', repeat('b', 64), 'pending',
  statement_timestamp() + interval '7 days'
);
update public.beta_invites
set status = 'accepted',
    accepted_by = '12111111-1111-4111-8111-111111111111'
where id = '12333333-3333-4333-8333-333333333333';
insert into public.beta_memberships (
  profile_id, invite_id, status
) values (
  '12111111-1111-4111-8111-111111111111',
  '12333333-3333-4333-8333-333333333333',
  'pending'
);
update public.beta_memberships
set status = 'active'
where profile_id = '12111111-1111-4111-8111-111111111111';
update public.beta_memberships
set activated_at = statement_timestamp() - interval '1 second'
where profile_id = '12111111-1111-4111-8111-111111111111';
insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select
  '12111111-1111-4111-8111-111111111111',
  d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null;

update public.profiles
set email_verified_at = statement_timestamp(),
    phone_verified_at = statement_timestamp()
where id = '12222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = case
  when id = '12111111-1111-4111-8111-111111111111' then 'admin'::public.platform_role
  else 'moderator'::public.platform_role
end
where id in (
  '12111111-1111-4111-8111-111111111111',
  '12222222-2222-4222-8222-222222222222'
);
insert into public.beta_invites (
  id, email, token_hash, status, expires_at
) values (
  '12444444-4444-4444-8444-444444444444',
  'evidence-target@example.test', repeat('c', 64), 'pending',
  statement_timestamp() + interval '7 days'
);
update public.beta_invites
set status = 'accepted',
    accepted_by = '12222222-2222-4222-8222-222222222222'
where id = '12444444-4444-4444-8444-444444444444';
insert into public.beta_memberships (profile_id, invite_id, status)
values (
  '12222222-2222-4222-8222-222222222222',
  '12444444-4444-4444-8444-444444444444',
  'pending'
);
update public.beta_memberships
set status = 'active'
where profile_id = '12222222-2222-4222-8222-222222222222';
update public.beta_memberships
set activated_at = statement_timestamp() - interval '1 second'
where profile_id = '12222222-2222-4222-8222-222222222222';
insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select
  '12222222-2222-4222-8222-222222222222',
  d.document_code, d.document_version, 'web'
from public.beta_legal_documents d
where d.required_for_access and d.retired_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12111111-1111-4111-8111-111111111111',
  true
);

create temp table evidence_allocation on commit drop as
select * from public.create_report_evidence_upload('image/png', 1024);
grant select on evidence_allocation to service_role;

select matches(
  (select storage_path from evidence_allocation),
  '^12111111-1111-4111-8111-111111111111/[0-9a-f-]+[.]webp$',
  'the authenticated owner receives a server-generated WebP path in their namespace'
);
select throws_ok(
  format(
    'select public.finalize_report_evidence_upload(%L, %L, 512, 320, 240)',
    (select upload_id from evidence_allocation),
    repeat('a', 64)
  ),
  '42501',
  'permission denied for function finalize_report_evidence_upload',
  'authenticated clients cannot finalize evidence metadata'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  format(
    'select public.finalize_report_evidence_upload(%L, %L, 512, 320, 240)',
    (select upload_id from evidence_allocation),
    repeat('a', 64)
  ),
  'P0002',
  'final report evidence object is missing',
  'finalization fails closed until the exact storage object exists'
);

reset role;
set local role postgres;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select bucket_id, storage_path, '12111111-1111-4111-8111-111111111111',
  '{"mimetype":"image/webp","size":512}'::jsonb
from evidence_allocation;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  format(
    'select public.finalize_report_evidence_upload(%L, %L, 512, 320, 240)',
    (select upload_id from evidence_allocation),
    repeat('a', 64)
  ),
  'service role finalizes a sanitized object only after storage upload'
);
select is(
  (
    select status::text
    from public.report_evidence_uploads
    where id = (select upload_id from evidence_allocation)
  ),
  'finalized',
  'finalized metadata is committed before report attachment'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12111111-1111-4111-8111-111111111111',
  true
);
select lives_ok(
  format(
    $sql$
      insert into public.reports (
        id, reporter_id, target_type, target_id, reason_code, details, evidence_paths
      ) values (
        'a2111111-1111-4111-8111-111111111111',
        '12111111-1111-4111-8111-111111111111',
        'profile',
        '12222222-2222-4222-8222-222222222222',
        'harassment',
        'Ledger-backed evidence report.',
        jsonb_build_array(%L)
      )
    $sql$,
    (select storage_path from evidence_allocation)
  ),
  'the owner can attach their finalized evidence exactly once'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'report-evidence'
      and name = (select storage_path from evidence_allocation)
  ),
  1::bigint,
  'the reporter can read attached evidence'
);
select throws_ok(
  format(
    'delete from storage.objects where bucket_id = %L and name = %L',
    'report-evidence',
    (select storage_path from evidence_allocation)
  ),
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'an authenticated direct-delete attempt is denied at the Storage boundary'
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'report-evidence'
      and name = (select storage_path from evidence_allocation)
  ),
  1::bigint,
  'authenticated reporters cannot delete report evidence objects directly'
);
reset role;
set local role postgres;
select results_eq(
  $$
    select status::text, report_id
    from public.report_evidence_uploads
    where id = (select upload_id from evidence_allocation)
  $$,
  $$ values ('attached'::text, 'a2111111-1111-4111-8111-111111111111'::uuid) $$,
  'report insertion atomically binds the ledger row to the report'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12222222-2222-4222-8222-222222222222',
  true
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'report-evidence'
      and name = (select storage_path from evidence_allocation)
  ),
  0::bigint,
  'an unassigned AAL2 moderator cannot read report evidence'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12111111-1111-4111-8111-111111111111',
  true
);
select lives_ok(
  $$
    update public.reports
    set status = 'investigating',
        assigned_to = '12222222-2222-4222-8222-222222222222'
    where id = 'a2111111-1111-4111-8111-111111111111'
  $$,
  'an AAL2 admin can assign an investigating report to a different active moderator'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12222222-2222-4222-8222-222222222222',
  true
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'report-evidence'
      and name = (select storage_path from evidence_allocation)
  ),
  0::bigint,
  'the assigned moderator cannot read evidence at AAL1'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"12222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}',
  true
);
select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'report-evidence'
      and name = (select storage_path from evidence_allocation)
  ),
  1::bigint,
  'the assigned AAL2 moderator can read evidence for the investigating case'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"12111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '12111111-1111-4111-8111-111111111111',
  true
);
select throws_ok(
  format(
    $sql$
      insert into public.reports (
        id, reporter_id, target_type, target_id, reason_code, details, evidence_paths
      ) values (
        'a2222222-2222-4222-8222-222222222222',
        '12111111-1111-4111-8111-111111111111',
        'profile',
        '12222222-2222-4222-8222-222222222222',
        'other',
        'Attempt to reuse attached evidence.',
        jsonb_build_array(%L)
      )
    $sql$,
    (select storage_path from evidence_allocation)
  ),
  '42501',
  'report evidence is not a finalized owned object',
  'an attached evidence object cannot be reused by a second report'
);
select throws_ok(
  $sql$
    insert into public.reports (
      id, reporter_id, target_type, target_id, reason_code, details, evidence_paths
    ) values (
      'a2333333-3333-4333-8333-333333333333',
      '12111111-1111-4111-8111-111111111111',
      'profile',
      '12222222-2222-4222-8222-222222222222',
      'other',
      'Raw unallocated path attempt.',
      '["12111111-1111-4111-8111-111111111111/a2444444-4444-4444-8444-444444444444.webp"]'::jsonb
    )
  $sql$,
  '42501',
  'report evidence is not a finalized owned object',
  'a storage-shaped path without a finalized ledger allocation is rejected'
);

create temp table rejected_allocation on commit drop as
select * from public.create_report_evidence_upload('image/jpeg', 2048);
grant select on rejected_allocation to service_role;
create temp table expired_allocation on commit drop as
select * from public.create_report_evidence_upload('image/avif', 3072);
grant select on expired_allocation to service_role;
reset role;
set local role postgres;
update public.report_evidence_uploads
set expires_at = statement_timestamp() - interval '1 second'
where id = (select upload_id from expired_allocation);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table reconciliation_results on commit drop as
select * from public.reject_unattached_report_evidence_uploads(
  array[
    (select upload_id from rejected_allocation),
    (select upload_id from evidence_allocation)
  ],
  'test_reconciliation'
);
select results_eq(
  'select upload_id from reconciliation_results order by upload_id',
  format(
    'select %L::uuid as upload_id',
    (select upload_id from rejected_allocation)
  ),
  'ambiguous failure reconciliation returns only the unattached allocation'
);
select is(
  (
    select status::text
    from public.report_evidence_uploads
    where id = (select upload_id from evidence_allocation)
  ),
  'attached',
  'ambiguous failure reconciliation preserves evidence attached by a committed report'
);
select ok(
  exists (
    select 1
    from public.upload_cleanup_queue q
    where q.report_evidence_upload_id = (select upload_id from rejected_allocation)
      and q.bucket_id = 'report-evidence'
      and q.reason = 'report_evidence_rejected'
  ),
  'rejected evidence is placed on the durable private-storage cleanup queue'
);
select is(
  public.expire_report_evidence_uploads(100),
  1,
  'the bounded service sweep expires one abandoned allocation'
);
select is(
  (
    select status::text
    from public.report_evidence_uploads
    where id = (select upload_id from expired_allocation)
  ),
  'expired',
  'the abandoned allocation reaches a terminal expired state'
);
select ok(
  exists (
    select 1
    from public.upload_cleanup_queue q
    where q.report_evidence_upload_id = (select upload_id from expired_allocation)
      and q.bucket_id = 'report-evidence'
      and q.reason = 'report_evidence_expired'
  ),
  'expired evidence is placed on the durable private-storage cleanup queue'
);
reset role;
set local role postgres;
select lives_ok(
  format(
    'delete from public.report_evidence_uploads where id in (%L, %L)',
    (select upload_id from rejected_allocation),
    (select upload_id from expired_allocation)
  ),
  'terminal ledger deletion is idempotent when cleanup is already pending'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_exact_upload_cleanup(bigint,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_exact_upload_cleanup(bigint,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_exact_upload_cleanup(bigint,text,text,text)',
    'execute'
  ),
  'only the service role can execute an exact upload-cleanup claim'
);

reset role;
set local role postgres;
create temp table exact_cleanup_coordinates (
  row_kind text primary key,
  queue_id bigint not null,
  storage_path text not null
) on commit drop;

with inserted as (
  insert into public.upload_cleanup_queue (bucket_id, storage_path, reason)
  values (
    'report-evidence',
    '12111111-1111-4111-8111-111111111111/31111111-1111-4111-8111-111111111111.webp',
    'task8_exact_eligible'
  )
  returning id, storage_path
)
insert into exact_cleanup_coordinates select 'eligible', id, storage_path from inserted;
with inserted as (
  insert into public.upload_cleanup_queue (bucket_id, storage_path, reason)
  values (
    'report-evidence',
    '12111111-1111-4111-8111-111111111111/32222222-2222-4222-8222-222222222222.webp',
    'task8_foreign_eligible'
  )
  returning id, storage_path
)
insert into exact_cleanup_coordinates select 'foreign', id, storage_path from inserted;
with inserted as (
  insert into public.upload_cleanup_queue (
    bucket_id, storage_path, reason, next_attempt_at
  ) values (
    'report-evidence',
    '12111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.webp',
    'task8_future_retry',
    statement_timestamp() + interval '1 hour'
  )
  returning id, storage_path
)
insert into exact_cleanup_coordinates select 'future', id, storage_path from inserted;
with inserted as (
  insert into public.upload_cleanup_queue (
    bucket_id, storage_path, reason, worker_request_id, claimed_at, attempts
  ) values (
    'report-evidence',
    '12111111-1111-4111-8111-111111111111/34444444-4444-4444-8444-444444444444.webp',
    'task8_claimed',
    'task8-existing-claim',
    statement_timestamp(),
    1
  )
  returning id, storage_path
)
insert into exact_cleanup_coordinates select 'claimed', id, storage_path from inserted;
with inserted as (
  insert into public.upload_cleanup_queue (
    bucket_id, storage_path, reason, processed_at
  ) values (
    'report-evidence',
    '12111111-1111-4111-8111-111111111111/35555555-5555-4555-8555-555555555555.webp',
    'task8_processed',
    statement_timestamp()
  )
  returning id, storage_path
)
insert into exact_cleanup_coordinates select 'processed', id, storage_path from inserted;
grant select on exact_cleanup_coordinates to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      -1,
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'eligible'),
      'task8-wrong-queue-request'
    )
  ),
  0,
  'an exact claim with the wrong queue ID returns no work'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'eligible'),
      'listing-images',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'eligible'),
      'task8-wrong-bucket-request'
    )
  ),
  0,
  'an exact claim with the wrong bucket returns no work'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'eligible'),
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'foreign'),
      'task8-wrong-path-request'
    )
  ),
  0,
  'an exact claim with the wrong storage path returns no work'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'processed'),
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'processed'),
      'task8-processed-request'
    )
  ),
  0,
  'an exact claim cannot reclaim a processed row'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'future'),
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'future'),
      'task8-future-request'
    )
  ),
  0,
  'an exact claim cannot bypass a future retry time'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'claimed'),
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'claimed'),
      'task8-claimed-request'
    )
  ),
  0,
  'an exact claim cannot take an already-claimed row'
);
select is(
  (
    select count(*)::integer
    from public.claim_exact_upload_cleanup(
      (select queue_id from exact_cleanup_coordinates where row_kind = 'eligible'),
      'report-evidence',
      (select storage_path from exact_cleanup_coordinates where row_kind = 'eligible'),
      'task8-exact-request'
    )
  ),
  1,
  'exact eligible coordinates return one cleanup lease'
);
select ok(
  exists (
    select 1
    from public.upload_cleanup_queue q
    join exact_cleanup_coordinates c on c.queue_id = q.id
    where c.row_kind = 'eligible'
      and q.worker_request_id = 'task8-exact-request'
      and q.claimed_at is not null
      and q.attempts = 1
  )
  and exists (
    select 1
    from public.upload_cleanup_queue q
    join exact_cleanup_coordinates c on c.queue_id = q.id
    where c.row_kind = 'foreign'
      and q.worker_request_id is null
      and q.claimed_at is null
      and q.attempts = 0
  ),
  'the exact lease claims only the requested row and never foreign work'
);

select * from finish();
rollback;
