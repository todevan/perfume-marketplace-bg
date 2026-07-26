import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL('../../supabase/migrations/202607200001_marketplace_foundation.sql', import.meta.url),
	'utf8'
);

function policyBlock(policyName: string, nextPolicyName: string): string {
	const start = migration.indexOf(`create policy ${policyName}`);
	const end = migration.indexOf(`create policy ${nextPolicyName}`, start + 1);
	if (start < 0 || end < 0) throw new Error(`Missing policy boundary: ${policyName}`);
	return migration.slice(start, end);
}

describe('static migration security contract (not a runtime Supabase integration test)', () => {
	it('enables RLS on every sensitive marketplace table', () => {
		const sensitiveTables = [
			'profiles',
			'merchant_applications',
			'listings',
			'listing_photos',
			'listing_authenticity_reviews',
			'favorites',
			'saved_searches',
			'offers',
			'conversations',
			'conversation_members',
			'messages',
			'deals',
			'deal_listing_locks',
			'deal_confirmations',
			'reviews',
			'profile_comments',
			'reports',
			'moderation_audit',
			'payments',
			'payment_events',
			'payment_refunds',
			'entitlements',
			'notifications'
		];

		for (const table of sensitiveTables) {
			expect(migration).toContain(`alter table public.${table} enable row level security;`);
		}
	});

	it('keeps listing drafts out of the public read policy', () => {
		const policy = policyBlock('listings_public_read', 'listings_owner_create');
		expect(policy).toContain("status in ('active', 'reserved', 'completed')");
		expect(policy).toContain('seller_id = auth.uid()');
		expect(policy).toContain('public.is_staff()');
		expect(policy).not.toContain("'draft'");
	});

	it('limits message reads and writes to conversation members', () => {
		for (const policy of [
			'messages_members_read',
			'messages_members_create',
			'messages_sender_edit'
		]) {
			expect(migration).toMatch(
				new RegExp(`create policy ${policy}[\\s\\S]*?public\\.is_conversation_member\\(conversation_id\\)`)
			);
		}
		expect(migration).toContain('messages require an open conversation');
		expect(migration).toContain("c.status = 'open'");
	});

	it('allows moderator message access only through an assigned active report and audits it', () => {
		const start = migration.indexOf('create or replace function public.moderator_read_messages');
		const end = migration.indexOf('create or replace function public.canonicalize_brand', start);
		const rpc = migration.slice(start, end);

		expect(rpc).toContain("target_report.status <> 'investigating'");
		expect(rpc).toContain('target_report.assigned_to is distinct from auth.uid()');
		expect(rpc).toContain('not public.is_admin()');
		expect(rpc).toContain("'conversation_accessed'");
		expect(rpc).toContain('insert into public.moderation_audit');
	});

	it('requires draft-only owner inserts and server-finalized evidence before activation', () => {
		const listingInsert = policyBlock('listings_owner_create', 'listings_owner_update');
		expect(listingInsert).toContain("status = 'draft'");
		expect(listingInsert).toContain('activated_at is null');
		expect(listingInsert).toContain('expires_at is null');

		const activationStart = migration.indexOf(
			'create or replace function public.validate_listing_activation'
		);
		const activationEnd = migration.indexOf(
			'create or replace function public.validate_offer_write',
			activationStart
		);
		const activation = migration.slice(activationStart, activationEnd);
		expect(activation).toContain('lp.sanitized_at is not null');
		expect(activation).toContain('pg_catalog.pg_advisory_xact_lock');
		expect(migration).not.toContain('create policy listing_photos_owner_create');
		expect(migration).not.toContain('create policy marketplace_listing_images_change');
	});

	it('locks both physical swap listings and releases cancelled deals to paused state', () => {
		expect(migration).toContain('create table public.deal_listing_locks');
		expect(migration).toContain('create trigger sync_deal_listing_locks');
		expect(migration).toContain('selected_offer.offered_listing_id');
		expect(migration).toContain("set status = 'paused'");
		expect(migration).toContain('where accepted_offer_id = target_deal.accepted_offer_id');
		expect(migration).toContain('grant execute on function public.cancel_deal(uuid, text) to authenticated');
	});

	it('freezes report identity and removes broad staff delete access', () => {
		expect(migration).toContain('create trigger protect_report_case');
		expect(migration).toContain('report identity and submitted evidence are immutable');
		expect(migration).not.toContain('create policy reports_staff_manage');
		expect(migration).toContain('create policy reports_staff_update');
		expect(migration).toContain("status <> 'investigating' or assigned_to is not null");
	});

	it('turns account suspension into an effective marketplace stop', () => {
		const moderationStart = migration.indexOf('create or replace function public.moderate_profile');
		const moderationEnd = migration.indexOf(
			'alter table public.profiles enable row level security',
			moderationStart
		);
		const moderation = migration.slice(moderationStart, moderationEnd);
		expect(moderation).toContain("set status = 'paused'");
		expect(moderation).toContain("set status = 'expired', responded_at = now()");
		expect(moderation).toContain("set status = 'disputed'");
		expect(moderation).toContain("set status = 'blocked'");
		expect(migration).toContain('both offer participants must be active');
		expect(migration).toContain('suspended participants cannot confirm a deal');
	});

	it('server-bounds offer expiry and rejects expired acceptance', () => {
		expect(migration).toContain("new.expires_at := coalesce(new.expires_at, now() + interval '7 days')");
		expect(migration).toContain("new.expires_at > now() + interval '30 days'");
		expect(migration).toContain('selected_offer.expires_at <= now()');
	});

	it('keeps merchant documents and report evidence in private owner-or-staff buckets', () => {
		expect(migration).toContain("'merchant-documents', 'merchant-documents', false");
		expect(migration).toContain("'report-evidence', 'report-evidence', false");
		expect(migration).toMatch(
			/create policy marketplace_merchant_documents_read[\s\S]*?bucket_id = 'merchant-documents'[\s\S]*?split_part\(name, '\/', 1\) = auth\.uid\(\)::text or public\.is_staff\(\)/
		);
		expect(migration).toMatch(
			/create policy marketplace_report_evidence_read[\s\S]*?bucket_id = 'report-evidence'[\s\S]*?split_part\(name, '\/', 1\) = auth\.uid\(\)::text or public\.is_staff\(\)/
		);
	});

	it('anchors payment callbacks and entitlements to idempotent payment records', () => {
		expect(migration).toContain('unique (provider, external_event_id)');
		expect(migration).toContain('create table public.payment_events');
		expect(migration).toContain('create table public.payment_refunds');
		expect(migration).toContain('payment events are append-only');
		expect(migration).toContain('refund total exceeds the original payment');
		expect(migration).toContain(
			'source_payment_id uuid references public.payments(id) on delete restrict'
		);
		expect(migration).toContain('create trigger replace_current_merchant_plan');
		expect(migration).toContain(
			'create policy payment_events_staff_read on public.payment_events'
		);
	});

	it('revokes direct access to sensitive workflow helpers and configures realtime', () => {
		expect(migration).toContain(
			'revoke execute on function public.effective_listing_limit(uuid) from public, anon, authenticated, service_role'
		);
		expect(migration).toContain(
			'revoke execute on function public.protect_report_case() from public, anon, authenticated'
		);
		expect(migration).toContain("pubname = 'supabase_realtime'");
		expect(migration).toContain("'conversations', 'conversation_members', 'messages', 'deals', 'notifications'");
	});
});
