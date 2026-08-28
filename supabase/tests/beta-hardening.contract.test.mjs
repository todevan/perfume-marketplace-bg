import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const readMigration = (filename) =>
	readFileSync(new URL(filename, migrationsUrl), 'utf8').replace(/\r\n/g, '\n');
const compact = (sql) => sql.toLowerCase().replace(/\s+/g, ' ').trim();
const migrationFiles = () =>
	readdirSync(fileURLToPath(migrationsUrl))
		.filter((filename) => filename.endsWith('.sql'))
		.sort();
const statements = (source) =>
	source
		.split(';')
		.map(compact)
		.filter(Boolean);
const regrantsAuthenticatedInsert = (statement) => {
	const grant = compact(statement).match(
		/^grant (.+?) on ((?:table )?(?:public\.)?deal_confirmations|all tables in schema public) to (.+)$/
	);
	if (!grant) return false;

	const [, privileges, , grantees] = grant;
	const grantsInsertOrAll =
		/(?:^|,\s*)(?:insert(?:\s*\([^)]*\))?|all(?: privileges)?)(?=\s*(?:,|$))/.test(
			privileges
		);
	const grantsToAuthenticated =
		/(?:^|,\s*)authenticated(?=\s*(?:,|with grant option$|$))/.test(grantees);
	return grantsInsertOrAll && grantsToAuthenticated;
};
const directInsertPolicyName = (statement) => {
	const policy = compact(statement).match(
		/^create policy ([a-z0-9_]+) on public\.deal_confirmations\b(.*)$/
	);
	if (!policy) return null;

	const policyOptions = policy[2].split(/\b(?:to|using|with check)\b/, 1)[0];
	const operation =
		policyOptions.match(/\bfor (all|select|insert|update|delete)\b/)?.[1] ?? 'all';
	return operation === 'insert' || operation === 'all' ? policy[1] : null;
};

const filenames = {
	access: '202607220003_beta_access_privacy.sql',
	workflow: '202607220004_workflow_invariants.sql',
	uploads: '202607220005_uploads_evidence.sql',
	moderation: '202607220006_moderation_lifecycle.sql',
	search: '202607220007_search_realtime_jobs.sql',
	bootstrap: '202607220008_first_admin_bootstrap.sql'
};

const sql = Object.fromEntries(
	Object.entries(filenames).map(([key, filename]) => [key, compact(readMigration(filename))])
);
const lintHardening = compact(
	readMigration('202607260009_database_lint_hardening.sql')
);
const hostedRuntimeCorrection = compact(
	readMigration('202607280010_hosted_runtime_correction.sql')
);

const includesAll = (source, fragments) => {
	for (const fragment of fragments) {
		assert.ok(source.includes(compact(fragment)), `Missing SQL contract: ${fragment}`);
	}
};

test('the beta hardening sequence is contiguous and has stable filenames', () => {
	const actual = readdirSync(fileURLToPath(migrationsUrl))
		.filter((filename) => filename.startsWith('20260722000'))
		.sort();
	assert.deepEqual(actual, Object.values(filenames));
});

test('database lint hardening is forward-only and fail-closed', () => {
	includesAll(lintHardening, [
		"'public.sync_editorial_catalog(jsonb)'::regprocedure",
		"'public.reject_listing_upload(uuid,text)'::regprocedure",
		'select pg_get_functiondef(',
		'if occurrence_count <> 1 then',
		'execute function_definition',
		'revoke execute on function public.reject_listing_upload(uuid, text) from public, anon, authenticated',
		'grant execute on function public.reject_listing_upload(uuid, text) to service_role'
	]);
});

test('hosted runtime correction removes the platform direct anon view grant', () => {
	includesAll(hostedRuntimeCorrection, [
		'revoke all on public.public_profiles from public, anon',
		'grant select on public.public_profiles to authenticated, service_role'
	]);
});

test('deal confirmations remain an RPC-only authenticated write contract', () => {
	assert.equal(
		regrantsAuthenticatedInsert(
			'grant select, insert, update on public.deal_confirmations to authenticated'
		),
		true
	);
	assert.equal(
		regrantsAuthenticatedInsert(
			'grant all privileges on all tables in schema public to service_role, authenticated'
		),
		true
	);
	assert.equal(
		regrantsAuthenticatedInsert(
			'grant select, insert (deal_id, profile_id) on table public.deal_confirmations to service_role, authenticated'
		),
		true
	);
	assert.equal(
		regrantsAuthenticatedInsert(
			'grant select, insert on deal_confirmations to authenticated'
		),
		true
	);
	assert.equal(
		regrantsAuthenticatedInsert(
			'grant select, update on public.deal_confirmations to authenticated'
		),
		false
	);
	assert.equal(
		directInsertPolicyName(
			'create policy confirmation_insert on public.deal_confirmations for insert to authenticated with check (profile_id = auth.uid())'
		),
		'confirmation_insert'
	);
	assert.equal(
		directInsertPolicyName(
			'create policy confirmation_all on public.deal_confirmations for all to authenticated using (true) with check (true)'
		),
		'confirmation_all'
	);
	assert.equal(
		directInsertPolicyName(
			'create policy confirmation_default on public.deal_confirmations to authenticated using (true) with check (true)'
		),
		'confirmation_default'
	);
	for (const operation of ['select', 'update', 'delete']) {
		assert.equal(
			directInsertPolicyName(
				`create policy confirmation_${operation} on public.deal_confirmations for ${operation} to authenticated using (true)`
			),
			null
		);
	}

	const migrations = migrationFiles().map((filename) => ({
		filename,
		sql: readMigration(filename),
		statements: statements(readMigration(filename))
	}));
	const revokePattern =
		/^revoke insert on (?:table )?public\.deal_confirmations from authenticated$/;
	const revokeIndexes = migrations.flatMap((migration, index) =>
		migration.statements.some((statement) => revokePattern.test(statement)) ? [index] : []
	);

	assert.equal(
		revokeIndexes.length,
		1,
		'expected exactly one forward-only migration revoking authenticated INSERT on public.deal_confirmations'
	);

	const revokeIndex = revokeIndexes[0];
	const directInsertPolicies = new Set();
	const dropPolicyPattern =
		/^drop policy(?: if exists)? ([a-z0-9_]+) on public\.deal_confirmations$/;

	for (const migration of migrations.slice(0, revokeIndex + 1)) {
		for (const statement of migration.statements) {
			const created = directInsertPolicyName(statement);
			if (created) directInsertPolicies.add(created);
			const dropped = statement.match(dropPolicyPattern);
			if (dropped) directInsertPolicies.delete(dropped[1]);
		}
	}

	for (const migration of migrations.slice(revokeIndex + 1)) {
		for (const statement of migration.statements) {
			assert.equal(
				regrantsAuthenticatedInsert(statement),
				false,
				`${migration.filename} must not regrant authenticated direct INSERT on public.deal_confirmations`
			);

			const created = directInsertPolicyName(statement);
			assert.equal(
				Boolean(created),
				false,
				`${migration.filename} must not recreate an authenticated direct INSERT policy on public.deal_confirmations`
			);

			const altered = statement.match(
				/^alter policy ([a-z0-9_]+) on public\.deal_confirmations\b/
			);
			assert.equal(
				Boolean(altered && directInsertPolicies.has(altered[1])),
				false,
				`${migration.filename} must not alter a direct INSERT policy on public.deal_confirmations`
			);
		}
	}
});

test('closed-beta access is invite-only, consented, and self-scoped', () => {
	includesAll(sql.access, [
		'create table public.beta_invites',
		'create table public.beta_memberships',
		'create table public.beta_legal_documents',
		'create table public.beta_consent_events',
		'create table public.beta_auth_events',
		'create or replace function private.is_active_beta_user(check_user_id uuid)',
		'create or replace function public.is_active_beta_user()',
		'create or replace function public.create_beta_invite(',
		'invited_by uuid',
		'if invited_by is null or not public.is_admin(invited_by)',
		'create or replace function public.revoke_beta_invite(target_invite_id uuid)',
		'create or replace function public.redeem_beta_invite(invite_token text)',
		'create or replace function public.accept_beta_consent(',
		'create or replace function public.complete_beta_onboarding(',
		'create or replace function public.get_my_beta_access()',
		"('age_18_confirmation', '2026-07-22', true",
		'grant execute on function public.create_beta_invite(text, uuid, interval) to service_role',
		'grant execute on function public.revoke_beta_invite(uuid) to service_role',
		'grant execute on function public.redeem_beta_invite(text) to authenticated'
	]);
	assert.ok(!sql.access.includes('function public.is_active_beta_user(uuid)'));
	assert.ok(!sql.access.includes('function public.has_verified_phone(uuid)'));
	assert.ok(!sql.access.includes('function public.create_beta_invite(text, interval)'));
	assert.match(
		sql.access,
		/revoke execute on function private\.is_active_beta_user\(uuid\) from public, anon/
	);
});

test('anonymous access is closed except for current legal documents', () => {
	includesAll(sql.access, [
		'revoke select on public.profiles, public.brands, public.brand_aliases, public.brand_collection_memberships, public.fragrances, public.listings, public.listing_photos, public.listing_authenticity_reviews, public.reviews, public.profile_comments from anon',
		'create policy beta_legal_documents_public_read on public.beta_legal_documents for select to anon, authenticated',
		'grant select on public.beta_legal_documents to anon, authenticated',
		'revoke all on public.public_profiles from public',
		'grant select on public.public_profiles to authenticated, service_role'
	]);
	assert.match(
		sql.access,
		/create view public\.public_profiles with \(security_barrier = true, security_invoker = true\)/
	);
	assert.match(
		sql.access,
		/public\.is_active_beta_user\(\) and private\.is_active_beta_user\(p\.id\)/
	);
	assert.ok(
		!sql.access.includes(
			'id, username, city, bio, avatar_path, account_kind, is_suspended, rating_average'
		)
	);
	for (const privateColumn of [
		'email_verified_at',
		'phone_verified_at',
		'merchant_verified_at',
		'role',
		'is_suspended'
	]) {
		const viewStart = sql.access.indexOf('create view public.public_profiles');
		const projectionEnd = sql.access.indexOf('from public.profiles p', viewStart);
		assert.ok(!sql.access.slice(viewStart, projectionEnd).includes(`p.${privateColumn}`));
	}
});

test('workflow RPCs and table triggers enforce server-owned lifecycle state', () => {
	includesAll(sql.workflow, [
		'create or replace function public.enforce_client_created_at()',
		"new.expires_at := statement_timestamp() + interval '60 days'",
		"statement_timestamp() + interval '7 days'",
		'private.has_verified_phone(new.seller_id)',
		'private.has_verified_phone(new.offerer_id)',
		'create or replace function public.publish_listing(target_listing_id uuid)',
		'create or replace function public.confirm_deal(target_deal_id uuid)',
		"listing_record.status not in ('draft', 'paused', 'expired')",
		"target_deal.status <> 'pending_confirmation'",
		'grant execute on function public.publish_listing(uuid) to authenticated',
		'grant execute on function public.confirm_deal(uuid) to authenticated'
	]);
	assert.ok(
		!sql.workflow.includes(
			"'offers', 'conversations', 'conversation_members', 'messages'"
		)
	);
	assert.match(sql.workflow, /add constraint listing_lifecycle_window_shape check \(.+?\) not valid/);
	assert.match(sql.workflow, /add constraint offer_response_timestamp_shape check \(.+?\) not valid/);
});

test('image evidence crosses a private quarantine and service-only finalization boundary', () => {
	includesAll(sql.uploads, [
		'create table public.upload_quarantine',
		'create table public.upload_cleanup_queue',
		"'listing-image-quarantine', 'listing-image-quarantine', false",
		'create or replace function public.create_listing_upload(',
		'create or replace function public.claim_listing_upload(',
		'create or replace function public.finalize_listing_upload(',
		"o.bucket_id = 'listing-images' and o.name = expected_path",
		'create policy marketplace_listing_quarantine_create on storage.objects for insert to authenticated',
		'drop policy if exists marketplace_listing_images_create on storage.objects',
		'drop policy if exists marketplace_listing_images_delete on storage.objects',
		'grant execute on function public.claim_listing_upload(uuid, text) to service_role',
		'grant execute on function public.finalize_listing_upload(uuid, text, text, text, integer, integer, integer) to service_role'
	]);
	assert.ok(!sql.uploads.includes('create policy marketplace_listing_images_create on storage.objects'));
	assert.ok(!sql.uploads.includes('create policy marketplace_listing_images_delete on storage.objects'));
	assert.match(
		sql.uploads,
		/revoke execute on function public\.finalize_listing_upload\(.+?\) from public, anon, authenticated/
	);
});

test('moderation is report-bound, append-only, and disputes are atomic', () => {
	includesAll(sql.moderation, [
		'create trigger moderation_audit_append_only',
		'create trigger catalog_sync_runs_append_only',
		'create or replace function public.canonicalize_brand( report_case_id uuid',
		'create or replace function public.review_listing_authenticity( report_case_id uuid',
		'create or replace function public.moderate_review( report_case_id uuid',
		'create or replace function public.moderate_profile_comment( report_case_id uuid',
		'create unique index reports_one_live_deal_dispute_idx',
		'create trigger aa_validate_deal_dispute_report',
		'create or replace function public.open_deal_dispute(',
		'create or replace function public.resolve_deal_dispute(',
		'drop policy if exists merchant_staff_review on public.merchant_applications',
		'create or replace function public.review_merchant_application(',
		'from public.deals d where d.id = target_deal_id for update',
		"set status = 'disputed', disputed_at = statement_timestamp()",
		"'deal', target_deal_id, 'deal_dispute'",
		"resolution_status not in ('pending_confirmation', 'cancelled')",
		"target_report.status <> 'investigating'",
		'target_report.assigned_to is distinct from requesting_staff',
		'delete from public.deal_confirmations where deal_id = target_deal_id',
		"set status = 'paused'",
		"set status = 'archived'",
		"target_status not in ('under_review', 'approved', 'rejected')",
		'grant execute on function public.open_deal_dispute(uuid, text) to authenticated'
	]);
	assert.match(
		sql.moderation,
		/foreign key \(report_id\) references public\.reports\(id\) on delete restrict/
	);
	assert.match(
		sql.moderation,
		/revoke execute on function public\.open_deal_dispute\(uuid, text\) from public, anon/
	);
	assert.match(
		sql.moderation,
		/grant execute on function public\.resolve_deal_dispute\(.+?\) to authenticated/
	);
	assert.match(
		sql.moderation,
		/grant execute on function public\.review_merchant_application\(.+?\) to authenticated/
	);
});

test('search, stable slugs, realtime, and bounded maintenance are installed', () => {
	includesAll(sql.search, [
		'create or replace function public.slugify_marketplace(value text)',
		'alter table public.fragrances alter column slug set not null',
		'alter table public.listings alter column slug set not null',
		'create unique index fragrances_slug_idx on public.fragrances (slug)',
		'create unique index listings_slug_idx on public.listings (slug)',
		'create trigger assign_fragrance_slug',
		'create trigger assign_listing_slug',
		'create or replace function public.search_catalog(',
		'create or replace function public.search_listings(',
		'where public.is_active_beta_user() and private.is_active_beta_user(l.seller_id)',
		'create or replace function private.run_beta_maintenance(max_rows integer default 500)',
		'create or replace function public.run_beta_maintenance(max_rows integer default 500)',
		"'listings', 'listing_photos', 'offers', 'deal_confirmations', 'reports', 'beta_memberships', 'upload_quarantine'",
		"'perfume-beta-maintenance', '*/5 * * * *'",
		'grant execute on function public.search_catalog(text, integer) to authenticated',
		'grant execute on function public.run_beta_maintenance(integer) to service_role'
	]);
	assert.match(
		sql.search,
		/revoke execute on function public\.search_catalog\(text, integer\) from public, anon/
	);
	assert.match(
		sql.search,
		/revoke execute on function public\.run_beta_maintenance\(integer\) from public, anon, authenticated/
	);
});

test('domain notifications and content-free email delivery are durable and idempotent', () => {
	includesAll(sql.search, [
		'alter table public.notifications add column dedupe_key text',
		'create unique index notifications_dedupe_key_idx',
		'drop policy if exists notifications_owner_delete on public.notifications',
		'create table public.notification_email_deliveries',
		'references public.notifications(id) on delete restrict',
		'create trigger normalize_notification_action_url',
		"new.action_url := '/messages?conversation=' || substr(new.action_url, 11)",
		'create trigger queue_notification_email_delivery',
		'create trigger notify_offer_received',
		'create trigger notify_message_received',
		'create trigger notify_deal_confirmation_needed',
		'create trigger notify_review_received',
		'create trigger notify_report_created',
		'create trigger notify_report_updated',
		'create trigger notify_merchant_application_staff',
		'create trigger notify_merchant_application_owner',
		'create or replace function public.claim_notification_email_delivery(',
		'create or replace function public.mark_notification_email_sent(',
		'create or replace function public.mark_notification_email_failed(',
		'grant execute on function public.claim_notification_email_delivery(uuid, text) to service_role',
		'grant execute on function public.mark_notification_email_sent(uuid, text, text) to service_role',
		'grant execute on function public.mark_notification_email_failed(uuid, text, text) to service_role'
	]);
	const ledgerStart = sql.search.indexOf(
		'create table public.notification_email_deliveries'
	);
	const ledgerEnd = sql.search.indexOf(
		'create unique index notification_email_provider_message_idx',
		ledgerStart
	);
	const ledger = sql.search.slice(ledgerStart, ledgerEnd);
	for (const forbiddenContent of ['recipient_email', 'email_address', 'title text', 'body text']) {
		assert.ok(!ledger.includes(forbiddenContent));
	}
	assert.match(
		sql.search,
		/revoke all on public\.notification_email_deliveries from public, anon, authenticated, service_role/
	);
});

test('storage cleanup work is leased, bounded, and service-only', () => {
	includesAll(sql.search, [
		'alter table public.upload_cleanup_queue',
		'add column worker_request_id text',
		'add column claimed_at timestamptz',
		'add column attempts integer not null default 0',
		'add column next_attempt_at timestamptz not null default now()',
		'add column dead_lettered_at timestamptz',
		'create table private.upload_cleanup_claim_requests',
		'create or replace function public.claim_upload_cleanup(',
		'create or replace function public.complete_upload_cleanup(',
		'create or replace function public.fail_upload_cleanup(',
		'for update skip locked',
		"q.claimed_at <= lease_time - interval '5 minutes'",
		'q.attempts < 8',
		'drop function public.mark_upload_cleanup_complete(bigint, text)',
		'revoke all on public.upload_cleanup_queue from public, anon, authenticated, service_role',
		'grant select on public.upload_cleanup_queue to service_role',
		'grant execute on function public.claim_upload_cleanup(integer, text) to service_role',
		'grant execute on function public.complete_upload_cleanup(bigint, text) to service_role',
		'grant execute on function public.fail_upload_cleanup(bigint, text, text) to service_role'
	]);
	assert.match(
		sql.search,
		/revoke execute on function public\.claim_upload_cleanup\(integer, text\) from public, anon, authenticated/
	);
});
