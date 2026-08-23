import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = readdirSync(fileURLToPath(migrationsUrl)).sort();
const readSource = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
const readBySuffix = (suffix) => {
	const matches = migrationFiles.filter((filename) => filename.endsWith(suffix));
	assert.equal(matches.length, 1, `Expected one migration ending ${suffix}, received ${matches.length}`);
	return readFileSync(new URL(matches[0], migrationsUrl), 'utf8').toLowerCase().replace(/\s+/g, ' ');
};

test('deal cancellation notification enum is committed before lifecycle functions use it', () => {
	const enumFile = migrationFiles.find((filename) => filename.endsWith('_add_deal_cancelled_notification.sql'));
	const lifecycleFile = migrationFiles.find((filename) => filename.endsWith('_implement_seller_deal_lifecycle.sql'));
	assert.ok(enumFile);
	assert.ok(lifecycleFile);
	assert.ok(enumFile < lifecycleFile);
	const sql = readBySuffix('_add_deal_cancelled_notification.sql');
	assert.match(sql, /alter type public\.notification_kind add value if not exists 'deal_cancelled'/);
});

test('seller completion and participant cancellation are locked, fail-closed workflows', () => {
	const sql = readBySuffix('_implement_seller_deal_lifecycle.sql');
	for (const fragment of [
		'create or replace function public.complete_deal(target_deal_id uuid)',
		'perform public.assert_active_beta_user()',
		'from public.deals d where d.id = target_deal_id for update',
		'order by l.id for update',
		'listing_seller_id <> deal_record.party_a_id',
		"deal_record.status <> 'pending_confirmation'",
		"'deal_completed:' || target_deal_id::text || ':'",
		'create or replace function public.cancel_deal(target_deal_id uuid, reason text)',
		"deal_record.status not in ('pending_confirmation', 'disputed')",
		'delete from public.deal_confirmations where deal_id = target_deal_id',
		"set status = 'paused'",
		"set status = 'archived'",
		"'deal_cancelled:' || target_deal_id::text || ':'"
	]) {
		assert.ok(sql.includes(fragment), `Missing lifecycle contract: ${fragment}`);
	}
	assert.match(sql, /security definer set search_path = ''/);
});

test('legacy confirmation writes and execution paths are decommissioned', () => {
	const sql = readBySuffix('_implement_seller_deal_lifecycle.sql');
	for (const fragment of [
		'drop policy if exists deal_confirmations_self_create on public.deal_confirmations',
		'revoke insert on public.deal_confirmations from authenticated',
		'drop trigger if exists validate_deal_confirmation on public.deal_confirmations',
		'drop trigger if exists complete_mutually_confirmed_deal on public.deal_confirmations',
		'drop trigger if exists notify_deal_confirmation_needed on public.deal_confirmations',
		'drop function if exists public.confirm_deal(uuid)',
		'revoke execute on function public.complete_deal(uuid) from public, anon, authenticated, service_role',
		'grant execute on function public.complete_deal(uuid) to authenticated'
	]) {
		assert.ok(sql.includes(fragment), `Missing legacy shutdown contract: ${fragment}`);
	}
});

test('participant cancellation can close, but never resume, an investigating dispute', () => {
	const sql = readBySuffix('_implement_seller_deal_lifecycle.sql');
	for (const fragment of [
		'create or replace function public.resolve_deal_dispute(',
		"deal_record.status = 'cancelled'",
		"resolution_status <> 'cancelled'",
		"report_resolution_code := 'deal_cancelled_by_participant'",
		'updated_deal := deal_record'
	]) {
		assert.ok(sql.includes(fragment), `Missing dispute compatibility contract: ${fragment}`);
	}
});

test('forward lifecycle hardening closes identity, RLS, oracle and legacy delivery gaps', () => {
	const sql = readBySuffix('_harden_seller_deal_lifecycle.sql');
	for (const fragment of [
		'create or replace function private.is_deal_identity_consistent(',
		'o.listing_id = target_listing_id',
		'o.offered_listing_id is not distinct from target_offered_listing_id',
		'o.offerer_id = target_party_b_id',
		"o.status = 'accepted'",
		'l.seller_id = target_party_a_id',
		'drop policy if exists deals_participant_read on public.deals',
		'create policy deals_participant_read on public.deals',
		'private.is_deal_identity_consistent(',
		"set status = 'archived'",
		"where n.kind = 'deal_confirmation_needed'",
		"and d.status <> 'sent'",
		'create or replace function public.queue_notification_email_delivery()',
		'create or replace function public.claim_notification_email_delivery_v2('
	]) {
		assert.ok(sql.includes(fragment), `Missing lifecycle hardening contract: ${fragment}`);
	}
});

test('generated database types omit the dropped cancellation foundation', () => {
	const types = readSource('../../src/lib/server/database.types.ts');
	assert.doesNotMatch(types, /\bcancel_deal_foundation\b/);
});

test('hosted lifecycle proof requires unique uploaded listings', () => {
	const source = readSource('../../tests/e2e/real-beta.spec.ts');
	assert.match(source, /E2E_REAL_UPLOADS=true is required for the full hosted deal lifecycle proof/);
	assert.doesNotMatch(source, /mode:\s*'seeded'/);
});

test('both delivery claim versions reject legacy confirmation email work', () => {
	const sql = readBySuffix('_suppress_legacy_deal_email_claims.sql');
	assert.ok(
		sql.includes('create or replace function public.claim_notification_email_delivery(')
	);
	assert.ok(sql.includes("n.kind = 'deal_confirmation_needed'"));
	assert.ok(sql.includes('legacy deal confirmation email delivery is suppressed'));
});

test('forward adjacent-path hardening closes dispute, read and moderation identity gaps', () => {
	const sql = readBySuffix('_close_deal_identity_adjacent_paths.sql');
	for (const fragment of [
		'drop policy if exists deals_participant_read on public.deals',
		'drop policy if exists deal_confirmations_participant_read on public.deal_confirmations',
		'public.is_active_beta_user()',
		'private.is_deal_identity_consistent(',
		'create or replace function public.open_deal_dispute(',
		'create or replace function public.resolve_deal_dispute(',
		'create or replace function public.validate_report_insert()',
		'create or replace function public.validate_deal_dispute_report()',
		'create or replace function public.moderate_profile(',
		'create or replace function private.reconcile_legacy_deal_notifications()'
	]) {
		assert.ok(sql.includes(fragment), `Missing adjacent-path hardening contract: ${fragment}`);
	}
});

test('listing deal access and profile lifecycle transitions are hardened together', () => {
	const sql = readBySuffix('_serialize_profile_deal_transitions.sql');
	for (const fragment of [
		'drop policy if exists listings_public_read on public.listings',
		'create policy listings_public_read on public.listings',
		'public.is_active_beta_user()',
		'private.is_deal_identity_consistent(',
		'create or replace function private.lock_profile_lifecycle(',
		"'aromatika:profile-lifecycle:' || locked_profile_id::text",
		'revoke execute on function private.lock_profile_lifecycle(uuid, uuid) from public, anon, authenticated, service_role',
		'perform private.lock_profile_lifecycle( deal_snapshot.party_a_id, deal_snapshot.party_b_id )',
		'perform private.lock_profile_lifecycle(target_profile_id, null)',
		'create or replace function public.complete_deal(target_deal_id uuid)',
		'create or replace function public.moderate_profile('
	]) {
		assert.ok(sql.includes(fragment), `Missing profile lifecycle serialization contract: ${fragment}`);
	}

	const firstDealRead = sql.indexOf('select * into deal_snapshot from public.deals');
	const advisoryLock = sql.indexOf(
		'perform private.lock_profile_lifecycle( deal_snapshot.party_a_id, deal_snapshot.party_b_id )'
	);
	const lockedDealRead = sql.indexOf('select * into deal_record from public.deals');
	assert.ok(firstDealRead >= 0, 'Missing unlocked completion authorization read');
	assert.ok(advisoryLock > firstDealRead, 'Advisory locks must follow the unlocked authorization read');
	assert.ok(lockedDealRead > advisoryLock, 'Deal row locks must follow profile advisory locks');
});

test('all deal lifecycle entry paths serialize profile state before mutable rows', () => {
	const sql = readBySuffix('_harden_deal_profile_lifecycle_interleaving.sql');
	for (const fragment of [
		'create or replace function public.accept_offer(target_offer_id uuid)',
		'perform private.lock_profile_lifecycle( target_listing.seller_id, target_offer.offerer_id )',
		'return public.accept_offer_foundation(target_offer_id)',
		'create or replace function public.complete_deal(target_deal_id uuid)',
		'create or replace function public.cancel_deal(target_deal_id uuid, reason text)',
		'perform private.lock_profile_lifecycle( deal_snapshot.party_a_id, deal_snapshot.party_b_id )',
		'create or replace function public.resolve_deal_dispute(',
		'a deal with an inactive participant cannot be resumed',
		'create trigger reject_completed_deal_with_inactive_participant',
		"old.status is distinct from 'completed'"
	]) assert.ok(sql.includes(fragment), `Missing lifecycle interleaving contract: ${fragment}`);

	const acceptStart = sql.indexOf('create or replace function public.accept_offer');
	const completeStart = sql.indexOf('create or replace function public.complete_deal');
	const cancelStart = sql.indexOf('create or replace function public.cancel_deal');
	const grantsStart = sql.indexOf('revoke execute on function public.accept_offer');
	const resolveStart = sql.indexOf('create or replace function public.resolve_deal_dispute');
	const acceptSql = sql.slice(acceptStart, completeStart);
	const completeSql = sql.slice(completeStart, cancelStart);
	const cancelSql = sql.slice(cancelStart, grantsStart);
	const resolveSql = sql.slice(resolveStart, acceptStart);

	assert.ok(
		acceptSql.indexOf('perform private.lock_profile_lifecycle') <
			acceptSql.indexOf('return public.accept_offer_foundation'),
		'Offer acceptance must lock both profiles before the foundation takes mutable row locks'
	);
	assert.ok(
		completeSql.indexOf('perform private.lock_profile_lifecycle') <
			completeSql.indexOf('select * into deal_record'),
		'Completion must lock both profiles before the deal row'
	);
	assert.ok(
		completeSql.indexOf('select * into deal_record') <
			completeSql.indexOf('deal participants are not active'),
		'Completion must revalidate both participants after waiting for lifecycle locks'
	);
	assert.ok(
		cancelSql.indexOf('perform private.lock_profile_lifecycle') <
			cancelSql.indexOf('select * into deal_record'),
		'Cancellation must lock both profiles before the deal row'
	);
	assert.ok(
		cancelSql.indexOf('select * into deal_record') <
			cancelSql.indexOf('active beta membership is required'),
		'Cancellation must revalidate only the requesting participant after waiting'
	);
	assert.ok(
		resolveSql.indexOf('perform private.lock_profile_lifecycle') <
			resolveSql.indexOf('select * into deal_record'),
		'Dispute resolution must lock both profiles before the deal row'
	);
});

test('the concurrency harness uses the project-independent database service alias', () => {
	const source = readSource('./seller_deal_lifecycle_concurrency.pgtap.sql');
	assert.equal(source.match(/host=db port=5432/g)?.length, 3);
	assert.doesNotMatch(source, /host=supabase_db_/);
	assert.doesNotMatch(source, /host=127\.0\.0\.1/);
});
