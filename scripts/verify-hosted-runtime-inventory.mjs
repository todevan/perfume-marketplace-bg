import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const workspace = resolve(import.meta.dirname, '..');
const projectUrl = process.env.PUBLIC_SUPABASE_URL?.trim();
const serviceKey =
	process.env.SUPABASE_SECRET_KEY?.trim() ||
	process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
const expectedReceipt = process.env.HOSTED_CRON_INVENTORY_SHA256?.trim();
const configuredReceiptPath = process.env.HOSTED_RUNTIME_INVENTORY_RECEIPT_PATH?.trim();
const releaseCommitSha = process.env.RELEASE_COMMIT_SHA?.trim()?.toLowerCase();
const receiptArgument = process.argv.find((argument) => argument.startsWith('--receipt-file='));

if (!projectUrl || !serviceKey || !expectedProjectRef) {
	throw new Error(
		'PUBLIC_SUPABASE_URL, service key, and EXPECTED_SUPABASE_PROJECT_REF are required'
	);
}
const url = new URL(projectUrl);
if (
	url.origin !== projectUrl ||
	url.hostname !== `${expectedProjectRef}.supabase.co`
) {
	throw new Error('Hosted runtime inventory target identity mismatch');
}

const client = createClient(projectUrl, serviceKey, {
	auth: { autoRefreshToken: false, persistSession: false }
});
const { data, error } = await client.rpc('get_hosted_runtime_inventory');
if (error) throw new Error(`Hosted runtime inventory failed: ${error.code ?? 'unknown'}`);

const expected = {
	realtimeTables: [
		'beta_memberships',
		'deal_confirmations',
		'listing_photos',
		'listings',
		'offers',
		'reports',
		'upload_quarantine'
	],
	scheduledJobs: [
		{
			active: true,
			command: 'select private.queue_listing_expiry_notifications(500)',
			name: 'perfume-beta-expiry-notifications',
			schedule: '15 8 * * *'
		},
		{
			active: true,
			command: 'select private.run_beta_maintenance(500)',
			name: 'perfume-beta-maintenance',
			schedule: '*/5 * * * *'
		}
	]
};
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalize(child)])
		);
	}
	return value;
}
const canonicalInventory = canonicalize(data);
if (JSON.stringify(canonicalInventory) !== JSON.stringify(canonicalize(expected))) {
	throw new Error('Hosted runtime inventory does not match the exact required jobs and Realtime tables');
}

if (!releaseCommitSha || !/^[a-f0-9]{40}$/u.test(releaseCommitSha)) {
	throw new Error('RELEASE_COMMIT_SHA must identify the exact 40-character release commit');
}

function receiptSha(contents) {
	return createHash('sha256').update(contents).digest('hex');
}

if (process.argv.includes('--check')) {
	if (!configuredReceiptPath || !expectedReceipt) {
		throw new Error(
			'HOSTED_RUNTIME_INVENTORY_RECEIPT_PATH and HOSTED_CRON_INVENTORY_SHA256 are required'
		);
	}
	const receiptPath = resolve(workspace, configuredReceiptPath);
	if (!existsSync(receiptPath)) throw new Error('Hosted runtime inventory receipt was not found');
	const receiptContents = readFileSync(receiptPath);
	if (receiptSha(receiptContents) !== expectedReceipt.toLowerCase()) {
		throw new Error('HOSTED_CRON_INVENTORY_SHA256 does not match the exact receipt bytes');
	}
	const receipt = JSON.parse(receiptContents.toString('utf8'));
	if (
		receipt.schemaVersion !== 1 ||
		receipt.kind !== 'hosted-runtime-inventory' ||
		receipt.projectRef !== expectedProjectRef ||
		receipt.commitSha !== releaseCommitSha ||
		JSON.stringify(canonicalize(receipt.inventory)) !==
			JSON.stringify(canonicalize(expected))
	) {
		throw new Error('Hosted runtime inventory receipt identity or contents do not match');
	}
	const checkedAt = Date.parse(receipt.checkedAt);
	if (
		!Number.isFinite(checkedAt) ||
		checkedAt < Date.now() - 24 * 60 * 60 * 1000 ||
		checkedAt > Date.now() + 5 * 60 * 1000
	) {
		throw new Error('Hosted runtime inventory receipt must be fresh');
	}
	console.log(`Hosted runtime inventory receipt verified: ${expectedReceipt.toLowerCase()}`);
} else {
	const receipt = {
		schemaVersion: 1,
		kind: 'hosted-runtime-inventory',
		checkedAt: new Date().toISOString(),
		commitSha: releaseCommitSha,
		projectRef: expectedProjectRef,
		inventory: data
	};
	const contents = `${JSON.stringify(receipt, null, 2)}\n`;
	if (receiptArgument) {
		const receiptPath = resolve(workspace, receiptArgument.slice('--receipt-file='.length));
		writeFileSync(receiptPath, contents, { encoding: 'utf8', flag: 'wx' });
		console.log(`Hosted runtime inventory receipt written: ${receiptPath}`);
	}
	console.log(`HOSTED_CRON_INVENTORY_SHA256=${receiptSha(Buffer.from(contents, 'utf8'))}`);
	if (!receiptArgument) console.log(contents.trimEnd());
}
