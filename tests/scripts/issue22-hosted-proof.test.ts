import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	assertProviderAttestation,
	assertPublishableKey,
	initializeManifest,
	parseHostedTarget,
	runIssue22HostedProof
} from '../../scripts/issue22-hosted-proof.mjs';

const candidateSha = 'a'.repeat(40);
const versionId = '11111111-1111-4111-8111-111111111111';
const target = {
	branchName: 'issue-22-proof',
	projectRef: 'abcdefghijklmnopqrst',
	parentProjectRef: 'nuhkpqjjyuygiemrxbdp',
	candidateSha,
	versionId
};

function providerEvidence(overrides: Record<string, unknown> = {}) {
	return {
		headSha: candidateSha,
		branch: {
			name: target.branchName,
			project_ref: target.projectRef,
			parent_project_ref: target.parentProjectRef,
			is_default: false,
			status: 'MIGRATIONS_PASSED',
			with_data: false
		},
		versions: [
			{
				id: versionId,
				annotations: { 'workers/tag': candidateSha }
			}
		],
		deployments: [
			{
				created_on: '2026-08-23T10:00:00.000Z',
				versions: [{ version_id: versionId, percentage: 100 }]
			}
		],
		...overrides
	};
}

function jwt(role: string): string {
	return [
		Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
		Buffer.from(JSON.stringify({ role })).toString('base64url'),
		'signature'
	].join('.');
}

describe('Issue 22 hosted provider attestation', () => {
	it('accepts only the exact healthy child branch and active candidate Worker version', () => {
		expect(assertProviderAttestation(target, providerEvidence())).toEqual({
			branchStatus: 'MIGRATIONS_PASSED',
			dataClone: false
		});
	});

	it('rejects a default or data-cloned branch', () => {
		for (const branch of [
			{ ...providerEvidence().branch, is_default: true },
			{ ...providerEvidence().branch, with_data: true }
		]) {
			expect(() => assertProviderAttestation(target, providerEvidence({ branch }))).toThrow();
		}
	});

	it('rejects a stale Cloudflare deployment', () => {
		expect(() =>
			assertProviderAttestation(
				target,
				providerEvidence({
					deployments: [
						{
							created_on: '2026-08-23T10:00:00.000Z',
							versions: [{ version_id: versionId, percentage: 50 }]
						}
					]
				})
			)
		).toThrow(/active 100%/u);
	});

	it('rejects an old candidate when a newer foreign deployment is active', () => {
		expect(() =>
			assertProviderAttestation(
				target,
				providerEvidence({
					deployments: [
						{
							created_on: '2026-08-23T09:00:00.000Z',
							versions: [{ version_id: versionId, percentage: 100 }]
						},
						{
							created_on: '2026-08-23T11:00:00.000Z',
							versions: [{ version_id: '22222222-2222-4222-8222-222222222222', percentage: 100 }]
						}
					]
				})
			)
		).toThrow(/active 100%/u);
	});

	it('accepts the candidate only when it is the newest deployment', () => {
		expect(() =>
			assertProviderAttestation(
				target,
				providerEvidence({
					deployments: [
						{
							created_on: '2026-08-23T09:00:00.000Z',
							versions: [{ version_id: '22222222-2222-4222-8222-222222222222', percentage: 100 }]
						},
						{
							created_on: '2026-08-23T11:00:00.000Z',
							versions: [{ version_id: versionId, percentage: 100 }]
						}
					]
				})
			)
		).not.toThrow();
	});

	it('fails closed on missing or ambiguous deployment timestamps', () => {
		for (const deployments of [
			[{ versions: [{ version_id: versionId, percentage: 100 }] }],
			[
				{
					created_on: '2026-08-23T10:00:00.000Z',
					versions: [{ version_id: versionId, percentage: 100 }]
				},
				{
					created_on: '2026-08-23T10:00:00.000Z',
					versions: [{ version_id: versionId, percentage: 100 }]
				}
			]
		]) {
			expect(() => assertProviderAttestation(target, providerEvidence({ deployments }))).toThrow(
				/deployment timestamp/u
			);
		}
	});
});

describe('Issue 22 hosted public key boundary', () => {
	it('rejects secret-key shapes and service-role JWTs', () => {
		expect(() => assertPublishableKey('sb_secret_private')).toThrow(/privileged/u);
		expect(() => assertPublishableKey(jwt('service_role'))).toThrow(/service_role/u);
	});

	it('accepts publishable and anon-role keys', () => {
		expect(assertPublishableKey('sb_publishable_public')).toBe('sb_publishable_public');
		expect(assertPublishableKey(jwt('anon'))).toBe(jwt('anon'));
	});
});

describe('Issue 22 private provenance recovery', () => {
	it('recovers a partially recorded user and proves no residual rows', async () => {
		const privateDirectory = mkdtempSync(join(tmpdir(), 'issue22-proof-'));
		const provenancePath = join(privateDirectory, 'provenance.json');
		const workerName = 'perfume-marketplace-bg-issue22-proof';
		const environment = {
			ISSUE22_HOSTED_ORIGIN: `https://${workerName}.perfume-marketplace-bg.workers.dev`,
			ISSUE22_SUPABASE_URL: `https://${target.projectRef}.supabase.co`,
			ISSUE22_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public',
			ISSUE22_SUPABASE_PROJECT_REF: target.projectRef,
			ISSUE22_SUPABASE_PARENT_PROJECT_REF: target.parentProjectRef,
			ISSUE22_SUPABASE_BRANCH_NAME: target.branchName,
			ISSUE22_CANDIDATE_SHA: candidateSha,
			ISSUE22_RUN_ID: 'proof',
			ISSUE22_CLOUDFLARE_WORKER_NAME: workerName,
			ISSUE22_CLOUDFLARE_VERSION_ID: versionId,
			ISSUE22_PROVENANCE_PATH: provenancePath,
			ISSUE22_SUPABASE_SERVICE_KEY: 'sb_secret_test-only'
		};
		const actorEmail = `issue22-proof-${candidateSha.slice(0, 8)}-a-fixture@example.invalid`;
		const partialEmail = `issue22-proof-${candidateSha.slice(0, 8)}-b-fixture@example.invalid`;
		const userId = '22222222-2222-4222-8222-222222222222';
		const partialUserId = '33333333-3333-4333-8333-333333333333';
		try {
			const hostedTarget = parseHostedTarget(environment);
			initializeManifest(hostedTarget, { branchStatus: 'MIGRATIONS_PASSED', dataClone: false });
			await runIssue22HostedProof('record-intent', {
				...environment,
				ISSUE22_ACTOR_LABEL: 'a',
				ISSUE22_ACTOR_EMAIL: actorEmail
			});
			await runIssue22HostedProof('record-actor', {
				...environment,
				ISSUE22_ACTOR_LABEL: 'a',
				ISSUE22_ACTOR_USER_ID: userId
			});
			await runIssue22HostedProof('record-intent', {
				...environment,
				ISSUE22_ACTOR_LABEL: 'b',
				ISSUE22_ACTOR_EMAIL: partialEmail
			});
			expect(JSON.parse(readFileSync(provenancePath, 'utf8')).actors).toEqual([
				{ label: 'a', email: actorEmail, userId },
				{ label: 'b', email: partialEmail, userId: null }
			]);

			let inventoryCalls = 0;
			const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(input instanceof Request ? input.url : input);
				if (url.pathname === '/auth/v1/admin/users' && init?.method !== 'DELETE') {
					inventoryCalls += 1;
					return Response.json({
						users:
							inventoryCalls === 1
								? [
										{ id: userId, email: actorEmail },
										{ id: partialUserId, email: partialEmail }
									]
								: []
					});
				}
				if (
					[
						`/auth/v1/admin/users/${userId}`,
						`/auth/v1/admin/users/${partialUserId}`
					].includes(url.pathname) &&
					init?.method === 'DELETE'
				) {
					return new Response(null, { status: 204 });
				}
				if (url.pathname.startsWith('/rest/v1/')) return Response.json([]);
				return new Response(null, { status: 500 });
			});
			vi.stubGlobal('fetch', fetchMock);
			const result = await runIssue22HostedProof('cleanup', environment);
			expect(result).toMatchObject({
				ok: true,
				deletedUserCount: 2,
				residualCounts: { authUsers: 0, profiles: 0, memberships: 0, consents: 0 }
			});
			expect(JSON.parse(readFileSync(provenancePath, 'utf8')).state).toBe('cleaned');
			expect(fetchMock).toHaveBeenCalledTimes(7);
		} finally {
			vi.unstubAllGlobals();
			if (existsSync(provenancePath)) unlinkSync(provenancePath);
			rmdirSync(privateDirectory);
		}
	});
});
