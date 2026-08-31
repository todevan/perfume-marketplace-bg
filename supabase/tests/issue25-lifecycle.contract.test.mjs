import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(migrationsUrl)
	.filter((filename) => filename.endsWith('.sql'))
	.sort()
	.map((filename) => ({
		filename,
		sql: readFileSync(new URL(filename, migrationsUrl), 'utf8')
			.toLowerCase()
			.replace(/\r\n/gu, '\n')
	}));

const compact = (sql) => sql.replace(/\s+/gu, ' ').trim();

function lifecycleMigration() {
	const matches = migrations.filter(({ sql }) =>
		/create\s+(?:or\s+replace\s+)?function\s+public\.complete_deal\s*\(\s*target_deal_id\s+uuid\s*\)/u.test(
			sql
		)
	);
	assert.equal(matches.length, 1, 'expected one consolidated Issue #25 lifecycle migration');
	return matches[0];
}

test('lifecycle migration follows the dedicated notification enum migration', () => {
	const enumIndex = migrations.findIndex(({ sql }) =>
		/alter\s+type\s+public\.notification_kind\s+add\s+value(?:\s+if\s+not\s+exists)?\s+'deal_cancelled'/u.test(
			sql
		)
	);
	const lifecycle = lifecycleMigration();
	const lifecycleIndex = migrations.findIndex(({ filename }) => filename === lifecycle.filename);

	assert.notEqual(enumIndex, -1, 'missing dedicated deal_cancelled enum migration');
	assert.ok(lifecycleIndex > enumIndex, 'lifecycle migration must follow the enum migration');
});

test('seller completion replaces every active mutual-confirmation mutation path', () => {
	const { sql } = lifecycleMigration();
	const normalized = compact(sql);

	for (const required of [
		'drop trigger if exists validate_deal_confirmation on public.deal_confirmations',
		'drop trigger if exists complete_mutually_confirmed_deal on public.deal_confirmations',
		'drop trigger if exists notify_deal_confirmation_needed on public.deal_confirmations',
		'drop function if exists public.confirm_deal(uuid)',
		'revoke insert on table public.deal_confirmations from authenticated',
		'grant execute on function public.complete_deal(uuid) to authenticated'
	]) {
		assert.ok(normalized.includes(required), `missing lifecycle retirement clause: ${required}`);
	}
	assert.doesNotMatch(sql, /delete\s+from\s+public\.deal_confirmations/gu);
	assert.doesNotMatch(sql, /['"]deal_confirmation_needed['"]/gu);
});

test('completion and cancellation preserve the Issue #23 lock order and moderation state', () => {
	const { sql } = lifecycleMigration();
	const completionStart = sql.indexOf('create or replace function public.complete_deal');
	const cancellationStart = sql.indexOf('create or replace function public.cancel_deal');
	const reviewStart = sql.indexOf('create or replace function public.validate_review_write');
	assert.ok(completionStart >= 0 && cancellationStart > completionStart && reviewStart > cancellationStart);

	const completion = sql.slice(completionStart, cancellationStart);
	const cancellation = sql.slice(cancellationStart, reviewStart);
	for (const [name, body] of [
		['complete_deal', completion],
		['cancel_deal', cancellation]
	]) {
		const dealLock = body.indexOf('from public.deals d');
		const membershipLock = body.indexOf('from public.conversations c');
		const listingLock = body.indexOf('from public.listings l');
		assert.ok(dealLock >= 0, `${name} must lock the deal`);
		assert.ok(membershipLock > dealLock, `${name} must lock membership after the deal`);
		assert.ok(listingLock > membershipLock, `${name} must lock listings after membership`);
		assert.match(body.slice(listingLock), /order\s+by\s+l\.id[\s\S]*?for\s+update/u);
	}

	assert.match(completion, /listing_record\.seller_id\s*<>\s*requesting_user/u);
	assert.match(completion, /deal_record\.status\s*<>\s*'pending_confirmation'/u);
	assert.match(completion, /and\s+status\s*=\s*'reserved'/u);
	assert.match(completion, /'deal_completed'/u);
	assert.match(cancellation, /deal_record\.status\s+not\s+in\s*\(\s*'pending_confirmation'\s*,\s*'disputed'\s*\)/u);
	assert.match(cancellation, /and\s+status\s*=\s*'reserved'/u);
	assert.match(cancellation, /'deal_cancelled'/u);
});

test('cancellation reason remains deal history and is not copied into notification payloads', () => {
	const { sql } = lifecycleMigration();
	const cancellationStart = sql.indexOf('create or replace function public.cancel_deal');
	const reviewStart = sql.indexOf('create or replace function public.validate_review_write');
	const cancellation = sql.slice(cancellationStart, reviewStart);
	const notificationStart = cancellation.indexOf('insert into public.notifications');

	assert.match(cancellation, /cancellation_reason\s*=\s*normalized_reason/u);
	assert.ok(notificationStart >= 0, 'cancel_deal must emit a notification');
	assert.doesNotMatch(cancellation.slice(notificationStart), /normalized_reason/u);
	assert.doesNotMatch(cancellation.slice(notificationStart), /['"]reason['"]/u);
});

test('review writes remain database-gated on completed deals only', () => {
	const { sql } = lifecycleMigration();
	const reviewStart = sql.indexOf('create or replace function public.validate_review_write');
	const review = sql.slice(reviewStart);

	assert.match(review, /target_deal\.status\s*<>\s*'completed'/u);
	assert.match(review, /reviews require a completed deal/u);
	assert.match(review, /revoke execute on function public\.validate_review_write\(\)/u);
});

test('review repairs preserve canonical moderation lock order and one post-lock timestamp', () => {
	const { sql } = lifecycleMigration();
	const normalized = compact(sql);

	for (const functionName of ['complete_deal', 'cancel_deal']) {
		const start = sql.indexOf(`create or replace function public.${functionName}`);
		const next = sql.indexOf('create or replace function public.', start + 1);
		const body = sql.slice(start, next);
		const listingLock = body.indexOf('from public.listings l');
		const transitionClock = body.indexOf('transition_time := clock_timestamp()');
		assert.ok(transitionClock > listingLock, `${functionName} must capture time after canonical locks`);
		assert.match(body, /created_at[\s\S]*transition_time/u);
	}

	const disputeStart = sql.indexOf('create or replace function public.resolve_deal_dispute');
	const profileStart = sql.indexOf('create or replace function public.moderate_profile');
	const reviewStart = sql.indexOf('create or replace function public.validate_review_write');
	const dispute = sql.slice(disputeStart, profileStart);
	const profile = sql.slice(profileStart, reviewStart);
	assert.ok(dispute.indexOf('from public.deals d') < dispute.indexOf('from public.reports r'));
	assert.match(dispute, /deal_record\.status\s*=\s*'cancelled'[\s\S]*resolution_status\s*<>\s*'cancelled'/u);
	assert.match(dispute, /updated_deal\s*:=\s*deal_record/u);
	assert.ok(profile.indexOf('from public.deals d') < profile.indexOf('from public.profiles p'));
	assert.ok(normalized.includes('order by d.id for update'));
});
