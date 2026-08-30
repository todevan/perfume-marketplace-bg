begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(80);

select is(
  has_table_privilege('authenticated', 'public.deal_confirmations', 'insert'),
  false,
  'authenticated callers cannot insert deal confirmations directly'
);

select is(
  has_function_privilege(
    'anon',
    'public.is_conversation_member(uuid,uuid)',
    'execute'
  ),
  false,
  'anonymous callers cannot execute the privileged conversation membership predicate'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.is_conversation_member(uuid,uuid)',
    'execute'
  ),
  true,
  'authenticated callers retain the conversation membership predicate required by RLS'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '23111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'privacy-seller@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"privacy_seller"}'::jsonb, now(), now()
),
(
  '23222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'privacy-buyer@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"privacy_buyer"}'::jsonb, now(), now()
),
(
  '23333333-3333-4333-8333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'privacy-outsider@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"privacy_outsider"}'::jsonb, now(), now()
);

update public.profiles
set email_verified_at = now(), phone_verified_at = now()
where id in (
  '23111111-1111-4111-8111-111111111111',
  '23222222-2222-4222-8222-222222222222',
  '23333333-3333-4333-8333-333333333333'
);

insert into public.beta_invites (id, email, token_hash, status, expires_at)
values
  ('23411111-1111-4111-8111-111111111111', 'privacy-seller@example.test', repeat('1', 64), 'pending', now() + interval '7 days'),
  ('23422222-2222-4222-8222-222222222222', 'privacy-buyer@example.test', repeat('2', 64), 'pending', now() + interval '7 days'),
  ('23433333-3333-4333-8333-333333333333', 'privacy-outsider@example.test', repeat('3', 64), 'pending', now() + interval '7 days');

update public.beta_invites
set status = 'accepted',
    accepted_by = case id
      when '23411111-1111-4111-8111-111111111111' then '23111111-1111-4111-8111-111111111111'::uuid
      when '23422222-2222-4222-8222-222222222222' then '23222222-2222-4222-8222-222222222222'::uuid
      else '23333333-3333-4333-8333-333333333333'::uuid
    end
where id in (
  '23411111-1111-4111-8111-111111111111',
  '23422222-2222-4222-8222-222222222222',
  '23433333-3333-4333-8333-333333333333'
);

insert into public.beta_memberships (profile_id, invite_id, status)
values
  ('23111111-1111-4111-8111-111111111111', '23411111-1111-4111-8111-111111111111', 'pending'),
  ('23222222-2222-4222-8222-222222222222', '23422222-2222-4222-8222-222222222222', 'pending'),
  ('23333333-3333-4333-8333-333333333333', '23433333-3333-4333-8333-333333333333', 'pending');
update public.beta_memberships
set status = 'active'
where profile_id in (
  '23111111-1111-4111-8111-111111111111',
  '23222222-2222-4222-8222-222222222222',
  '23333333-3333-4333-8333-333333333333'
);
update public.beta_memberships
set activated_at = now() - interval '1 second'
where profile_id in (
  '23111111-1111-4111-8111-111111111111',
  '23222222-2222-4222-8222-222222222222',
  '23333333-3333-4333-8333-333333333333'
);

insert into public.beta_consent_events (
  profile_id, document_code, document_version, source
)
select fixture.profile_id, document.document_code, document.document_version, 'web'
from (
  values
    ('23111111-1111-4111-8111-111111111111'::uuid),
    ('23222222-2222-4222-8222-222222222222'::uuid),
    ('23333333-3333-4333-8333-333333333333'::uuid)
) as fixture(profile_id)
cross join public.beta_legal_documents document
where document.required_for_access and document.retired_at is null;

insert into public.brands (id, canonical_name, slug, status, normalized_key)
values (
  '23511111-1111-4111-8111-111111111111',
  'Cross User Privacy Brand', 'cross-user-privacy-brand', 'canonical',
  'cross user privacy brand'
);

alter table public.listings disable trigger user;
insert into public.listings (
  id, seller_id, kind, deal_mode, product_format, audience, brand_id,
  fragrance_name, concentration, title, description, city,
  bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
  slug, activated_at, expires_at
) values (
  '23522222-2222-4222-8222-222222222222',
  '23111111-1111-4111-8111-111111111111',
  'offer', 'sale', 'retail_bottle', 'unisex',
  '23511111-1111-4111-8111-111111111111',
  'Privacy Fragrance', 'EDP', 'Private offer fixture',
  'Hostile three-user contract fixture', 'Sofia',
  100, 90, false, 10000, 'active',
  'cross-user-privacy-listing-2352222222', now(), now() + interval '30 days'
);
alter table public.listings enable trigger user;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$
    insert into public.offers (
      id, listing_id, offerer_id, kind, cash_amount_minor, message
    ) values (
      '23533333-3333-4333-8333-333333333333',
      '23522222-2222-4222-8222-222222222222',
      '23222222-2222-4222-8222-222222222222',
      'cash', 9000, 'private pending offer message'
    )
  $$,
  'the active buyer can create the pending offer through RLS'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*) from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  0::bigint,
  'an outsider cannot read a foreign pending offer by exact UUID'
);
select lives_ok(
  $$
    update public.offers set status = 'withdrawn'
    where id = '23533333-3333-4333-8333-333333333333'
  $$,
  'an outsider exact-UUID mutation is filtered without exposing the offer'
);
select throws_ok(
  $$ select public.accept_offer('23533333-3333-4333-8333-333333333333') $$,
  'P0002', 'pending offer not found',
  'accepting an existing foreign offer is indistinguishable from a missing offer'
);
select throws_ok(
  $$ select public.accept_offer('23544444-4444-4444-8444-444444444444') $$,
  'P0002', 'pending offer not found',
  'accepting a missing offer returns the canonical not-found result'
);
select throws_ok(
  $$ select public.decline_offer('23533333-3333-4333-8333-333333333333') $$,
  'P0002', 'pending offer not found',
  'declining an existing foreign offer is indistinguishable from a missing offer'
);
select throws_ok(
  $$ select public.decline_offer('23544444-4444-4444-8444-444444444444') $$,
  'P0002', 'pending offer not found',
  'declining a missing offer returns the canonical not-found result'
);

reset role;
set local role postgres;
select is(
  (select status::text from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  'pending',
  'outsider probes leave the pending offer unchanged'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.accept_offer('23533333-3333-4333-8333-333333333333') $$,
  'the seller can accept the buyer offer through the public workflow'
);
reset role;
set local role postgres;
create temp table privacy_conversation on commit drop as
select id from public.conversations
where accepted_offer_id = '23533333-3333-4333-8333-333333333333';
grant select on privacy_conversation to authenticated;
create temp table privacy_deal on commit drop as
select id from public.deals
where accepted_offer_id = '23533333-3333-4333-8333-333333333333';
grant select on privacy_deal to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  1::bigint,
  'the active seller can read the accepted offer'
);
select is((select count(*) from public.conversations), 1::bigint, 'the seller can read the accepted conversation');
select is((select count(*) from public.conversation_members), 1::bigint, 'the seller sees only their own membership row');
select is((select count(*) from public.deals), 1::bigint, 'the seller can read the resulting deal');
select lives_ok(
  $$
    insert into public.messages (id, conversation_id, sender_id, body)
    select '23611111-1111-4111-8111-111111111111', id,
      '23111111-1111-4111-8111-111111111111', 'seller private message'
    from public.conversations
  $$,
  'an active seller can send a private message'
);
select is((select count(*) from public.messages), 1::bigint, 'the seller can read the private message');
select is(
  (select count(*) from public.latest_messages_for_conversations(array(select id from public.conversations))),
  1::bigint,
  'the seller latest-message RPC remains RLS-filtered'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*) from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  1::bigint,
  'the active buyer can read the accepted offer'
);
select is((select count(*) from public.conversations), 1::bigint, 'the buyer can read the accepted conversation');
select is((select count(*) from public.conversation_members), 1::bigint, 'the buyer sees only their own membership row');
select is((select count(*) from public.messages), 1::bigint, 'the buyer can read the seller message');
select is(
  (select count(*) from public.latest_messages_for_conversations(array(select id from public.conversations))),
  1::bigint,
  'the buyer latest-message RPC returns the participant message'
);
select is((select count(*) from public.deals), 1::bigint, 'the buyer can read the resulting deal');
select lives_ok(
  $$
    insert into public.messages (id, conversation_id, sender_id, body)
    select '23622222-2222-4222-8222-222222222222', id,
      '23222222-2222-4222-8222-222222222222', 'buyer private reply'
    from public.conversations
  $$,
  'an active buyer can send a private reply'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23333333-3333-4333-8333-333333333333', true);
select is((select count(*) from public.conversations), 0::bigint, 'the outsider cannot enumerate conversations');
select is((select count(*) from public.conversation_members), 0::bigint, 'the outsider cannot enumerate membership metadata');
select is((select count(*) from public.messages), 0::bigint, 'the outsider cannot enumerate message bodies');
select is(
  (select count(*) from public.latest_messages_for_conversations(array(select id from privacy_conversation))),
  0::bigint,
  'the outsider latest-message RPC discloses no rows or private values'
);
select is((select count(*) from public.deals), 0::bigint, 'the outsider cannot enumerate deals');

reset role;
set local role postgres;
insert into public.upload_quarantine (
  id, uploader_id, listing_id, requested_role, quarantine_path,
  declared_mime_type, declared_byte_size
) values (
  '23633333-3333-4333-8333-333333333333',
  '23111111-1111-4111-8111-111111111111',
  '23522222-2222-4222-8222-222222222222', 'product_full',
  '23111111-1111-4111-8111-111111111111/23522222-2222-4222-8222-222222222222/23633333-3333-4333-8333-333333333333/source.png',
  'image/png', 512
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'listing-image-quarantine',
  '23111111-1111-4111-8111-111111111111/23522222-2222-4222-8222-222222222222/23633333-3333-4333-8333-333333333333/source.png',
  '23111111-1111-4111-8111-111111111111',
  '{"mimetype":"image/png","size":512,"privateMarker":"quarantine-secret"}'::jsonb
);

alter table public.reports disable trigger user;
insert into public.reports (
  id, reporter_id, target_type, target_id, reason_code, details, evidence_paths
) values (
  '23644444-4444-4444-8444-444444444444',
  '23111111-1111-4111-8111-111111111111',
  'profile', '23333333-3333-4333-8333-333333333333', 'other',
  'private report details',
  '["23111111-1111-4111-8111-111111111111/23655555-5555-4555-8555-555555555555.webp"]'::jsonb
);
alter table public.reports enable trigger user;
insert into public.report_evidence_uploads (
  id, uploader_id, storage_path, source_mime_type, source_byte_size, status,
  actual_content_hash, actual_byte_size, actual_mime_type, width_px, height_px,
  report_id, finalized_at, attached_at
) values (
  '23655555-5555-4555-8555-555555555555',
  '23111111-1111-4111-8111-111111111111',
  '23111111-1111-4111-8111-111111111111/23655555-5555-4555-8555-555555555555.webp',
  'image/png', 512, 'attached', repeat('a', 64), 400, 'image/webp', 20, 20,
  '23644444-4444-4444-8444-444444444444', now(), now()
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'report-evidence',
  '23111111-1111-4111-8111-111111111111/23655555-5555-4555-8555-555555555555.webp',
  '23111111-1111-4111-8111-111111111111',
  '{"mimetype":"image/webp","size":400,"privateMarker":"report-secret"}'::jsonb
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select results_eq(
  $$ select name, metadata ->> 'privateMarker' from storage.objects where bucket_id = 'listing-image-quarantine' $$,
  $$ values (
    '23111111-1111-4111-8111-111111111111/23522222-2222-4222-8222-222222222222/23633333-3333-4333-8333-333333333333/source.png'::text,
    'quarantine-secret'::text
  ) $$,
  'the quarantine owner can read their private object name and metadata'
);
select results_eq(
  $$ select name, metadata ->> 'privateMarker' from storage.objects where bucket_id = 'report-evidence' $$,
  $$ values (
    '23111111-1111-4111-8111-111111111111/23655555-5555-4555-8555-555555555555.webp'::text,
    'report-secret'::text
  ) $$,
  'the report-evidence uploader can read the attached private object and metadata'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*) from storage.objects where bucket_id = 'listing-image-quarantine'),
  0::bigint,
  'the outsider cannot enumerate quarantine object names or metadata'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'report-evidence'),
  0::bigint,
  'the outsider cannot enumerate report-evidence object names or metadata'
);

reset role;
set local role postgres;
create temp view blocked_deal_rpc_state as
select jsonb_build_object(
  'confirmations', coalesce((
    select jsonb_agg(to_jsonb(dc) order by dc.profile_id)
    from public.deal_confirmations dc
    join public.deals d on d.id = dc.deal_id
    where d.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb),
  'deals', coalesce((
    select jsonb_agg(to_jsonb(d) order by d.id)
    from public.deals d
    where d.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb),
  'listings', coalesce((
    select jsonb_agg(to_jsonb(l) order by l.id)
    from public.listings l
    where l.id in (
      select d.listing_id from public.deals d
      where d.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
      union
      select d.offered_listing_id from public.deals d
      where d.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
    )
  ), '[]'::jsonb),
  'profile_transaction_counters', coalesce((
    select jsonb_agg(
      jsonb_build_object('id', p.id, 'completed_deals_count', p.completed_deals_count)
      order by p.id
    )
    from public.profiles p
    where p.id in (
      '23111111-1111-4111-8111-111111111111',
      '23222222-2222-4222-8222-222222222222'
    )
  ), '[]'::jsonb),
  'conversations', coalesce((
    select jsonb_agg(to_jsonb(c) order by c.id)
    from public.conversations c
    where c.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb),
  'memberships', coalesce((
    select jsonb_agg(to_jsonb(cm) order by cm.profile_id)
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where c.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb),
  'messages', coalesce((
    select jsonb_agg(to_jsonb(m) order by m.id)
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb),
  'notifications', coalesce((
    select jsonb_agg(to_jsonb(n) order by n.id)
    from public.notifications n
    where n.profile_id in (
      '23111111-1111-4111-8111-111111111111',
      '23222222-2222-4222-8222-222222222222'
    )
  ), '[]'::jsonb),
  'reports', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.id)
    from public.reports r
    join public.deals d on d.id = r.target_id
    where r.target_type = 'deal'
      and d.accepted_offer_id = '23533333-3333-4333-8333-333333333333'
  ), '[]'::jsonb)
) as state;
create temp table blocked_deal_rpc_baseline (state jsonb not null) on commit drop;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
update public.conversation_members set blocked_at = statement_timestamp()
where profile_id = auth.uid();
reset role;
set local role postgres;
insert into blocked_deal_rpc_baseline select state from blocked_deal_rpc_state;

savepoint buyer_blocked_direct_deal_confirmation;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select public.confirm_deal((select id from privacy_deal));
reset role;
set local role postgres;
truncate blocked_deal_rpc_baseline;
insert into blocked_deal_rpc_baseline select state from blocked_deal_rpc_state;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$
    insert into public.deal_confirmations (deal_id, profile_id)
    select id, auth.uid() from privacy_deal
  $$,
  '42501', 'permission denied for table deal_confirmations',
  'buyer-blocked direct confirmation of an existing deal is denied canonically'
);
select throws_ok(
  $$
    insert into public.deal_confirmations (deal_id, profile_id)
    values ('23711111-1111-4111-8111-111111111111', auth.uid())
  $$,
  '42501', 'permission denied for table deal_confirmations',
  'buyer-blocked direct confirmation of a missing deal has the same non-enumerating denial'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'buyer-blocked direct confirmation causes zero transaction mutation'
);
rollback to savepoint buyer_blocked_direct_deal_confirmation;

savepoint buyer_blocked_confirm_deal;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select public.confirm_deal((select id from privacy_deal)) $$,
  '42501', 'deal is not available to this participant',
  'buyer-blocked confirm_deal returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select public.confirm_deal('23711111-1111-4111-8111-111111111111') $$,
  '42501', 'deal is not available to this participant',
  'buyer confirm_deal uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'buyer-blocked confirm_deal causes zero transaction mutation'
);
rollback to savepoint buyer_blocked_confirm_deal;

savepoint buyer_blocked_cancel_deal;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select public.cancel_deal((select id from privacy_deal), 'blocked cancellation probe') $$,
  '42501', 'pending deal is not available to this participant',
  'buyer-blocked cancel_deal returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select public.cancel_deal('23711111-1111-4111-8111-111111111111', 'missing cancellation probe') $$,
  '42501', 'pending deal is not available to this participant',
  'buyer cancel_deal uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'buyer-blocked cancel_deal causes zero transaction mutation'
);
rollback to savepoint buyer_blocked_cancel_deal;

savepoint buyer_blocked_open_deal_dispute;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select * from public.open_deal_dispute((select id from privacy_deal), 'blocked dispute details probe') $$,
  '42501', 'deal is not available to this participant',
  'buyer-blocked open_deal_dispute returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select * from public.open_deal_dispute('23711111-1111-4111-8111-111111111111', 'missing dispute details probe') $$,
  '42501', 'deal is not available to this participant',
  'buyer open_deal_dispute uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'buyer-blocked open_deal_dispute causes zero transaction mutation'
);
rollback to savepoint buyer_blocked_open_deal_dispute;

truncate blocked_deal_rpc_baseline;
update public.conversation_members
set blocked_at = null
where profile_id = '23222222-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
update public.conversation_members set blocked_at = statement_timestamp()
where profile_id = auth.uid();
reset role;
set local role postgres;
insert into blocked_deal_rpc_baseline select state from blocked_deal_rpc_state;

savepoint seller_blocked_direct_deal_confirmation;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select public.confirm_deal((select id from privacy_deal));
reset role;
set local role postgres;
truncate blocked_deal_rpc_baseline;
insert into blocked_deal_rpc_baseline select state from blocked_deal_rpc_state;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$
    insert into public.deal_confirmations (deal_id, profile_id)
    select id, auth.uid() from privacy_deal
  $$,
  '42501', 'permission denied for table deal_confirmations',
  'seller-blocked direct confirmation of an existing deal is denied canonically'
);
select throws_ok(
  $$
    insert into public.deal_confirmations (deal_id, profile_id)
    values ('23711111-1111-4111-8111-111111111111', auth.uid())
  $$,
  '42501', 'permission denied for table deal_confirmations',
  'seller-blocked direct confirmation of a missing deal has the same non-enumerating denial'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'seller-blocked direct confirmation causes zero transaction mutation'
);
rollback to savepoint seller_blocked_direct_deal_confirmation;

savepoint seller_blocked_confirm_deal;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$ select public.confirm_deal((select id from privacy_deal)) $$,
  '42501', 'deal is not available to this participant',
  'seller-blocked confirm_deal returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select public.confirm_deal('23711111-1111-4111-8111-111111111111') $$,
  '42501', 'deal is not available to this participant',
  'seller confirm_deal uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'seller-blocked confirm_deal causes zero transaction mutation'
);
rollback to savepoint seller_blocked_confirm_deal;

savepoint seller_blocked_cancel_deal;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$ select public.cancel_deal((select id from privacy_deal), 'blocked cancellation probe') $$,
  '42501', 'pending deal is not available to this participant',
  'seller-blocked cancel_deal returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select public.cancel_deal('23711111-1111-4111-8111-111111111111', 'missing cancellation probe') $$,
  '42501', 'pending deal is not available to this participant',
  'seller cancel_deal uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'seller-blocked cancel_deal causes zero transaction mutation'
);
rollback to savepoint seller_blocked_cancel_deal;

savepoint seller_blocked_open_deal_dispute;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$ select * from public.open_deal_dispute((select id from privacy_deal), 'blocked dispute details probe') $$,
  '42501', 'deal is not available to this participant',
  'seller-blocked open_deal_dispute returns the canonical denial without private values, identifiers, metadata, row-existence, or enumeration signals'
);
select throws_ok(
  $$ select * from public.open_deal_dispute('23711111-1111-4111-8111-111111111111', 'missing dispute details probe') $$,
  '42501', 'deal is not available to this participant',
  'seller open_deal_dispute uses the same canonical denial for a missing deal'
);
reset role;
set local role postgres;
select is(
  (select state from blocked_deal_rpc_state),
  (select state from blocked_deal_rpc_baseline),
  'seller-blocked open_deal_dispute causes zero transaction mutation'
);
rollback to savepoint seller_blocked_open_deal_dispute;

truncate blocked_deal_rpc_baseline;
update public.conversation_members
set blocked_at = null
where profile_id = '23111111-1111-4111-8111-111111111111';

savepoint eligible_confirm_deal;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$ select public.confirm_deal((select id from privacy_deal)) $$,
  'the eligible unblocked buyer can confirm through confirm_deal'
);
select set_config('request.jwt.claims', '{"sub":"23111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.confirm_deal((select id from privacy_deal)) $$,
  'the eligible unblocked seller can confirm through confirm_deal'
);
reset role;
set local role postgres;
select is(
  (select count(*) from public.deal_confirmations dc where dc.deal_id = (select id from privacy_deal)),
  2::bigint,
  'confirm_deal records exactly one confirmation for each eligible participant'
);
select is(
  (select status::text from public.deals where id = (select id from privacy_deal)),
  'completed',
  'confirm_deal completes the deal after both eligible participants confirm'
);
rollback to savepoint eligible_confirm_deal;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$ update public.conversation_members set blocked_at = now() where profile_id = auth.uid() $$,
  'a participant can self-block their conversation membership'
);
select is(
  (select count(*) from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  0::bigint,
  'a self-blocked participant loses accepted-offer reads'
);
select is(
  (select count(*) from public.deals),
  0::bigint,
  'a self-blocked participant loses deal reads'
);
select is((select count(*) from public.conversations), 0::bigint, 'a self-blocked member loses conversation reads');
select is((select count(*) from public.conversation_members), 0::bigint, 'a self-blocked member loses membership reads');
select is((select count(*) from public.messages), 0::bigint, 'a self-blocked member loses message reads');
select is(
  (select count(*) from public.latest_messages_for_conversations(array(select id from privacy_conversation))),
  0::bigint,
  'a self-blocked member latest-message call discloses no rows'
);
select throws_ok(
  $$
    insert into public.messages (conversation_id, sender_id, body)
    values ((select id from privacy_conversation), auth.uid(), 'blocked leak')
  $$,
  '42501',
  'sender is not an active conversation member',
  'a self-blocked member cannot send messages'
);

reset role;
set local role postgres;
update public.conversation_members
set blocked_at = null
where profile_id = '23222222-2222-4222-8222-222222222222';
update public.profiles
set is_suspended = true
where id = '23222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '23222222-2222-4222-8222-222222222222', true);
select ok(not public.is_active_beta_user(), 'the direct suspension makes the buyer inactive');
select is(
  (select count(*) from public.offers where id = '23533333-3333-4333-8333-333333333333'),
  0::bigint,
  'a directly suspended participant loses accepted-offer reads'
);
select is((select count(*) from public.deals), 0::bigint, 'a directly suspended participant loses deal reads');
select is((select count(*) from public.conversations), 0::bigint, 'a directly suspended member loses conversation reads');
select is((select count(*) from public.conversation_members), 0::bigint, 'a directly suspended member loses membership reads');
select is((select count(*) from public.messages), 0::bigint, 'a directly suspended member loses message reads');
select is(
  (select count(*) from public.latest_messages_for_conversations(array(select id from privacy_conversation))),
  0::bigint,
  'a directly suspended member latest-message call discloses no rows'
);
select throws_ok(
  $$
    insert into public.messages (conversation_id, sender_id, body)
    values ((select id from privacy_conversation), auth.uid(), 'suspended leak')
  $$,
  '42501',
  'active beta membership is required to send messages',
  'a directly suspended member cannot send messages'
);

reset role;
set local role postgres;
select results_eq(
  $$
    select tablename
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('conversations', 'conversation_members', 'messages')
    order by tablename
  $$,
  $$ values ('conversation_members'::name), ('conversations'::name), ('messages'::name) $$,
  'conversation tables remain in Realtime while RLS remains the read authority'
);

select * from finish();
rollback;
