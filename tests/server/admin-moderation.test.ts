import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { requireStaffRequest } from '../../src/routes/admin/access.server';
import {
	assignReportCase,
	createBetaInviteAndSendEmail,
	decideModerationReport,
	inspectModerationConversation,
	loadModerationDashboard,
	ModerationWorkflowError,
	reviewMerchantApplication
} from '../../src/routes/admin/moderation.server';
import { GET as authCallback } from '../../src/routes/auth/callback/+server';

const actorId = '11111111-1111-4111-8111-111111111111';
const reporterId = '22222222-2222-4222-8222-222222222222';
const targetId = '33333333-3333-4333-8333-333333333333';
const caseId = '44444444-4444-4444-8444-444444444444';
const applicationId = '55555555-5555-4555-8555-555555555555';
const applicantId = '66666666-6666-4666-8666-666666666666';

interface QueryResult {
	data: unknown;
	error: { code?: string; message?: string } | null;
}

interface QueryChain {
	select: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	in: ReturnType<typeof vi.fn>;
	is: ReturnType<typeof vi.fn>;
	order: ReturnType<typeof vi.fn>;
	limit: ReturnType<typeof vi.fn>;
	maybeSingle: ReturnType<typeof vi.fn>;
	then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => unknown;
}

function query(result: QueryResult): QueryChain {
	const chain = {} as QueryChain;
	chain.select = vi.fn(() => chain);
	chain.update = vi.fn(() => chain);
	chain.eq = vi.fn(() => chain);
	chain.in = vi.fn(() => chain);
	chain.is = vi.fn(() => chain);
	chain.order = vi.fn(() => chain);
	chain.limit = vi.fn(() => chain);
	chain.maybeSingle = vi.fn(async () => result);
	chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
	return chain;
}

function report(
	targetType: string = 'listing',
	overrides: Record<string, unknown> = {}
) {
	return {
		id: caseId,
		reporter_id: reporterId,
		target_type: targetType,
		target_id: targetId,
		reason_code: 'counterfeit',
		details: 'Конкретни факти по сигнала.',
		evidence_paths: [],
		status: 'investigating',
		assigned_to: actorId,
		resolution_code: null,
		resolution_notes: null,
		resolved_at: null,
		created_at: '2026-07-22T10:00:00.000Z',
		updated_at: '2026-07-22T10:00:00.000Z',
		...overrides
	};
}

function assignedCase(
	targetType: string = 'listing',
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	const { id, ...row } = report(targetType, overrides);
	return { report_id: id, ...row, audit_entries: [] };
}

function productionLocals(role: 'user' | 'moderator' | 'admin', aal: 'aal1' | 'aal2') {
	const client = {} as SupabaseClient;
	return {
		requestId: 'request-1',
		runtime: {
			mode: 'production',
			demoMode: false,
			appEnvironment: 'development',
			publicSupabaseUrl: 'https://project.supabase.co',
			publicSupabaseKey: 'publishable',
			publicSupabaseAnonKey: 'publishable',
			imageProcessorMode: 'disabled'
		},
		supabase: client,
		safeGetSession: vi.fn(),
		user: { id: actorId },
		profile: {
			id: actorId,
			username: 'staff_actor',
			city: null,
			bio: null,
			avatarPath: null,
			accountKind: 'private',
			role,
			emailVerifiedAt: '2026-07-20T00:00:00.000Z',
			phoneVerifiedAt: '2026-07-20T00:00:00.000Z',
			merchantVerifiedAt: null,
			isSuspended: false
		},
		betaAccess: {
			profileId: actorId,
			status: 'active',
			onboardingCompletedAt: '2026-07-20T00:00:00.000Z',
			activatedAt: '2026-07-20T00:00:00.000Z',
			expiresAt: null,
			hasCurrentConsents: true,
			isActive: true
		},
		currentAal: aal,
		nextAal: 'aal2'
	} as unknown as App.Locals;
}

function thrownStatus(call: () => unknown): { status?: number; location?: string } {
	try {
		call();
	} catch (cause) {
		return cause as { status?: number; location?: string };
	}
	throw new Error('Expected the call to throw.');
}

describe('admin request boundary', () => {
	it('requires production, an active staff role, and AAL2 again at the route boundary', () => {
		const locals = productionLocals('moderator', 'aal2');
		const secured = requireStaffRequest(locals, new URL('https://market.example/admin'));
		expect(secured.actor).toEqual({ id: actorId, username: 'staff_actor', role: 'moderator' });
		expect(secured.client).toBe(locals.supabase);

		const mfaRedirect = thrownStatus(() =>
			requireStaffRequest(
				productionLocals('moderator', 'aal1'),
				new URL('https://market.example/admin')
			)
		);
		expect(mfaRedirect.status).toBe(303);
		expect(mfaRedirect.location).toContain('/auth/mfa?next=');

		expect(
			thrownStatus(() =>
				requireStaffRequest(
					productionLocals('user', 'aal2'),
					new URL('https://market.example/admin')
				)
			).status
		).toBe(403);
	});

	it('fails closed in demo mode before exposing the admin runtime', () => {
		const locals = productionLocals('admin', 'aal2');
		locals.runtime = { mode: 'demo', demoMode: true, appEnvironment: 'development' };
		expect(
			thrownStatus(() => requireStaffRequest(locals, new URL('https://market.example/admin')))
				.status
		).toBe(503);
	});

	it('keeps invitation authorization admin-only', () => {
		expect(
			thrownStatus(() =>
				requireStaffRequest(
					productionLocals('moderator', 'aal2'),
					new URL('https://market.example/admin'),
					['admin']
				)
			).status
		).toBe(403);
	});
});

describe('report workflow', () => {
	it('claims an unassigned case through the protected report transition', async () => {
		const rpc = vi.fn(async () => ({ data: 'claimed', error: null }));
		const from = vi.fn();
		const client = { from, rpc } as unknown as SupabaseClient;

		await expect(assignReportCase(client, actorId, { caseId })).resolves.toEqual({
			caseId,
			status: 'investigating'
		});
		expect(rpc).toHaveBeenCalledWith('claim_moderation_report', { p_report_id: caseId });
		expect(from).not.toHaveBeenCalled();
	});

	it('maps a generic unavailable claim result without a direct report lookup', async () => {
		const rpc = vi.fn(async () => ({ data: 'unavailable', error: null }));
		const from = vi.fn();

		await expect(
			assignReportCase({ rpc, from } as unknown as SupabaseClient, actorId, { caseId })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(from).not.toHaveBeenCalled();
	});

	it('runs listing decisions through the report-bound atomic moderation RPC', async () => {
		const from = vi.fn();
		const rpc = vi.fn(async (name: string) =>
			name === 'get_assigned_moderation_case'
				? { data: [assignedCase('listing')], error: null }
				: { data: null, error: null }
		);
		const client = { from, rpc } as unknown as SupabaseClient;

		await decideModerationReport(client, { id: actorId, role: 'moderator' }, {
			caseId,
			decision: 'remove',
			rationale: 'Доказано подвеждащо съдържание в приложените снимки.'
		});

		expect(rpc).toHaveBeenCalledWith('moderate_listing', {
			report_case_id: caseId,
			target_listing_id: targetId,
			moderation_rationale: 'Доказано подвеждащо съдържание в приложените снимки.',
			corrected_audience: null,
			corrected_segments: null,
			moderated_status: 'removed'
		});
		expect(rpc).toHaveBeenNthCalledWith(1, 'get_assigned_moderation_case', {
			p_report_id: caseId
		});
		expect(from).not.toHaveBeenCalled();
	});

	it.each([
		{
			targetType: 'profile',
			decision: 'suspend',
			rpcName: 'moderate_profile',
			expected: { target_profile_id: targetId, suspend_profile: true }
		},
		{
			targetType: 'review',
			decision: 'hide',
			rpcName: 'moderate_review',
			expected: { target_review_id: targetId, moderated_status: 'hidden' }
		},
		{
			targetType: 'profile_comment',
			decision: 'publish',
			rpcName: 'moderate_profile_comment',
			expected: { target_comment_id: targetId, moderated_status: 'published' }
		}
	])('uses the report-bound $rpcName RPC', async ({ targetType, decision, rpcName, expected }) => {
		const rpc = vi.fn(async (name: string) =>
			name === 'get_assigned_moderation_case'
				? { data: [assignedCase(targetType)], error: null }
				: { data: null, error: null }
		);
		const client = {
			from: vi.fn(),
			rpc
		} as unknown as SupabaseClient;

		await decideModerationReport(client, { id: actorId, role: 'moderator' }, {
			caseId,
			decision,
			rationale: 'Конкретни проверени факти и приложено правило.'
		});
		expect(rpc).toHaveBeenCalledWith(
			rpcName,
			expect.objectContaining({
				report_case_id: caseId,
				moderation_rationale: 'Конкретни проверени факти и приложено правило.',
				...expected
			})
		);
	});

	it('resolves a deal atomically through resolve_deal_dispute without a second report update', async () => {
		const from = vi.fn();
		const rpc = vi.fn(async (name: string) =>
			name === 'get_assigned_moderation_case'
				? { data: [assignedCase('deal')], error: null }
				: { data: { id: targetId, status: 'cancelled' }, error: null }
		);
		const client = { from, rpc } as unknown as SupabaseClient;

		await decideModerationReport(client, { id: actorId, role: 'moderator' }, {
			caseId,
			decision: 'cancel',
			rationale: 'Спорът е проверен и сделката следва да бъде отменена.'
		});
		expect(rpc).toHaveBeenCalledWith('resolve_deal_dispute', {
			report_case_id: caseId,
			target_deal_id: targetId,
			resolution_status: 'cancelled',
			rationale: 'Спорът е проверен и сделката следва да бъде отменена.'
		});
		expect(from).not.toHaveBeenCalled();
	});

	it('loads only report-bound conversation messages and redacts deleted bodies', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				{
					id: '77777777-7777-4777-8777-777777777777',
					conversation_id: targetId,
					sender_id: reporterId,
					body: 'Reported content',
					reply_to_id: null,
					created_at: '2026-07-22T10:00:00.000Z',
					edited_at: null,
					deleted_at: '2026-07-22T10:05:00.000Z'
				}
			],
			error: null
		}));

		await expect(
			inspectModerationConversation({ rpc } as unknown as SupabaseClient, { caseId })
		).resolves.toEqual({
			caseId,
			messages: [
				{
					id: '77777777-7777-4777-8777-777777777777',
					conversationId: targetId,
					senderId: reporterId,
					body: null,
					createdAt: '2026-07-22T10:00:00.000Z'
				}
			]
		});
		expect(rpc).toHaveBeenCalledWith('moderator_read_messages', {
			report_case_id: caseId,
			page_size: 50
		});
	});

	it.each([
		{ targetType: 'message', decision: 'hide', expectedDecision: 'remove' },
		{ targetType: 'conversation', decision: 'remove', expectedDecision: 'block' },
		{ targetType: 'conversation', decision: 'keep', expectedDecision: 'keep' }
	])(
		'resolves inspected $targetType reports through the atomic conversation RPC',
		async ({ targetType, decision, expectedDecision }) => {
			const rpc = vi.fn(async (name: string) =>
				name === 'get_assigned_moderation_case'
					? { data: [assignedCase(targetType)], error: null }
					: { data: {}, error: null }
			);
			const client = {
				from: vi.fn(),
				rpc
			} as unknown as SupabaseClient;

			await decideModerationReport(client, { id: actorId, role: 'moderator' }, {
				caseId,
				decision,
				rationale: 'Разговорът е прегледан в рамките на присвоения сигнал.'
			});
			expect(rpc).toHaveBeenCalledWith('resolve_conversation_report', {
				report_case_id: caseId,
				decision: expectedDecision,
				moderation_rationale: 'Разговорът е прегледан в рамките на присвоения сигнал.'
			});
		}
	);

	it.each(['brand', 'offer'] as const)(
		'provides a report-bound safe disposition for legacy %s reports',
		async (targetType) => {
		const rpc = vi.fn(async (name: string) =>
			name === 'get_assigned_moderation_case'
				? { data: [assignedCase(targetType)], error: null }
				: { data: null, error: null }
		);
		const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;

		await expect(decideModerationReport(client, { id: actorId, role: 'moderator' }, {
				caseId,
				decision: 'dismiss',
				rationale: 'Конкретни проверени факти и приложено правило.'
			})).resolves.toEqual({ caseId, status: 'resolved', decision: 'dismiss' });
		expect(rpc).toHaveBeenCalledWith('resolve_unsupported_report', {
			report_case_id: caseId,
			moderation_rationale: 'Конкретни проверени факти и приложено правило.'
		});
		}
	);
});

describe('moderation dashboard projection', () => {
	it('loads a safe queue and exposes private detail only through the exact-assignee RPC', async () => {
		const queueRows = [
			{
				report_id: caseId,
				target_type: 'listing',
				reason_code: 'counterfeit',
				status: 'investigating',
				assignment_state: 'assigned_to_you',
				created_at: '2026-07-22T10:00:00.000Z'
			},
			{
				report_id: '77777777-7777-4777-8777-777777777777',
				target_type: 'deal',
				reason_code: 'deal_dispute',
				status: 'open',
				assignment_state: 'unassigned',
				created_at: '2026-07-22T10:01:00.000Z'
			}
		];
		const privateCase = assignedCase('listing', {
			evidence_paths: [`${reporterId}/evidence.jpg`]
		});
		privateCase.audit_entries = [
			{
				id: 1,
				actor_id: actorId,
				action: 'report_assigned',
				rationale: 'Случаят е присвоен.',
				created_at: '2026-07-22T10:05:00.000Z'
			}
		];
		const profiles = [
			{ id: reporterId, username: 'reporter' },
			{ id: actorId, username: 'staff_actor' },
			{ id: applicantId, username: 'merchant_candidate' }
		];
		const tableData: Record<string, unknown> = {
			profiles,
			listings: [{ id: targetId, title: 'Защитена обява', status: 'active' }],
			merchant_applications: [
				{
					id: applicationId,
					applicant_id: applicantId,
					status: 'submitted',
					legal_name: 'Example EOOD',
					registration_number: 'BG123456789',
					registered_address: 'София',
					website_url: 'https://merchant.example',
					document_paths: [`${applicantId}/registration.pdf`],
					reviewer_id: null,
					reviewer_notes: null,
					submitted_at: '2026-07-22T09:00:00.000Z',
					reviewed_at: null,
					created_at: '2026-07-22T09:00:00.000Z',
					updated_at: '2026-07-22T09:00:00.000Z'
				}
			]
		};
		const from = vi.fn((table: string) => query({ data: tableData[table] ?? [], error: null }));
		const rpc = vi.fn(async (name: string) => {
			if (name === 'list_moderation_report_queue') return { data: queueRows, error: null };
			if (name === 'get_assigned_moderation_case') return { data: [privateCase], error: null };
			throw new Error(`unexpected RPC: ${name}`);
		});
		const storageFrom = vi.fn((bucket: string) => ({
			createSignedUrls: vi.fn(async (paths: string[]) => ({
				data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${bucket}/${path}` })),
				error: null
			}))
		}));
		const client = { from, rpc, storage: { from: storageFrom } } as unknown as SupabaseClient;

		const dashboard = await loadModerationDashboard(
			client,
			{ id: actorId, role: 'moderator' },
			caseId
		);
		expect(dashboard.cases.map((item) => item.targetType)).toEqual(['listing', 'deal']);
		expect(dashboard.selected?.evidence[0].url).toContain('https://signed.example/report-evidence/');
		expect(dashboard.selected).not.toHaveProperty('evidencePaths');
		expect(dashboard.audit[0]).toMatchObject({ actor: 'staff_actor' });
		expect(dashboard.merchantApplications[0]).toMatchObject({
			id: applicationId,
			applicant: 'merchant_candidate',
			canClaim: true
		});
		expect(dashboard.merchantApplications[0]).not.toHaveProperty('documentPaths');
		expect(rpc).toHaveBeenCalledWith('list_moderation_report_queue', {
			p_page_size: 50,
			p_page_offset: 0
		});
		expect(rpc).toHaveBeenCalledWith('get_assigned_moderation_case', { p_report_id: caseId });
		expect(from).not.toHaveBeenCalledWith('reports');
		expect(from).not.toHaveBeenCalledWith('moderation_audit');
	});

	it('does not fetch or sign private data for an unassigned queue case', async () => {
		const rpc = vi.fn(async (name: string) => {
			if (name === 'list_moderation_report_queue') {
				return {
					data: [{
						report_id: caseId,
						target_type: 'listing',
						reason_code: 'counterfeit',
						status: 'open',
						assignment_state: 'unassigned',
						created_at: '2026-07-22T10:00:00.000Z'
					}],
					error: null
				};
			}
			throw new Error(`private RPC must not run before claim: ${name}`);
		});
		const from = vi.fn((table: string) =>
			query({ data: table === 'merchant_applications' ? [] : [], error: null })
		);
		const storageFrom = vi.fn();
		const dashboard = await loadModerationDashboard(
			{ from, rpc, storage: { from: storageFrom } } as unknown as SupabaseClient,
			{ id: actorId, role: 'admin' },
			caseId
		);

		expect(dashboard.selected).toBeNull();
		expect(dashboard.cases[0]).toMatchObject({ canClaim: true, canDecide: false });
		expect(storageFrom).not.toHaveBeenCalled();
		expect(from).not.toHaveBeenCalledWith('reports');
		expect(from).not.toHaveBeenCalledWith('moderation_audit');
	});

	it('directly loads an assigned case outside the 50-case unassigned queue page', async () => {
		const queueRows = Array.from({ length: 50 }, (_, index) => ({
			report_id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
			target_type: 'listing',
			reason_code: 'counterfeit',
			status: 'open',
			assignment_state: 'unassigned',
			created_at: new Date(Date.UTC(2026, 6, 22, 10, index)).toISOString()
		}));
		const privateCase = assignedCase('listing', {
			created_at: '2026-07-23T10:00:00.000Z'
		});
		const rpc = vi.fn(async (name: string) => {
			if (name === 'list_moderation_report_queue') return { data: queueRows, error: null };
			if (name === 'get_assigned_moderation_case') return { data: [privateCase], error: null };
			throw new Error(`unexpected RPC: ${name}`);
		});
		const from = vi.fn(() => query({ data: [], error: null }));

		const dashboard = await loadModerationDashboard(
			{ from, rpc, storage: { from: vi.fn() } } as unknown as SupabaseClient,
			{ id: actorId, role: 'moderator' },
			caseId
		);

		expect(dashboard.cases).toHaveLength(50);
		expect(dashboard.selected).toMatchObject({
			id: caseId,
			assignedTo: actorId,
			isAssignedToViewer: true,
			canDecide: true
		});
		expect(rpc).toHaveBeenCalledWith('get_assigned_moderation_case', { p_report_id: caseId });
	});
});

describe('merchant application workflow', () => {
	it('uses the dedicated merchant review RPC and never performs a direct table update', async () => {
		const rpc = vi.fn(async () => ({ data: { id: applicationId, status: 'approved' }, error: null }));
		const from = vi.fn();
		const client = { rpc, from } as unknown as SupabaseClient;

		await expect(
			reviewMerchantApplication(client, {
				applicationId,
				decision: 'approve',
				notes: 'Документите и регистрацията са проверени.'
			})
		).resolves.toEqual({ applicationId, status: 'approved' });
		expect(rpc).toHaveBeenCalledWith('review_merchant_application', {
			target_application_id: applicationId,
			target_status: 'approved',
			review_notes: 'Документите и регистрацията са проверени.'
		});
		expect(from).not.toHaveBeenCalled();
	});
});

describe('beta invitation delivery', () => {
	it('binds the SQL invite to the admin, sends only a redirect token, and never returns it', async () => {
		const rawToken = 'a'.repeat(64);
		const rpc = vi.fn(async (name: string) => {
			if (name === 'create_beta_invite') {
				return {
					data: [
						{
							invite_id: caseId,
							invite_token: rawToken,
							invite_expires_at: '2026-07-29T10:00:00.000Z'
						}
					],
					error: null
				};
			}
			return { data: null, error: null };
		});
		const inviteUserByEmail = vi.fn(
			async (_email: string, _options: { redirectTo: string }) => ({
				data: { user: { id: targetId } },
				error: null
			})
		);
		const client = {
			rpc,
			auth: { admin: { inviteUserByEmail } }
		} as unknown as SupabaseClient;

		const result = await createBetaInviteAndSendEmail(client, {
			email: ' New.Member@Example.BG ',
			adminId: actorId,
			appOrigin: 'https://market.example'
		});
		expect(rpc).toHaveBeenCalledWith('create_beta_invite', {
			invited_email: 'new.member@example.bg',
			invited_by: actorId,
			valid_for: '7 days'
		});
		const deliveryOptions = inviteUserByEmail.mock.calls[0][1];
		expect(deliveryOptions).toEqual({
			redirectTo: `https://market.example/auth/callback?invite_token=${rawToken}`
		});
		expect(deliveryOptions).not.toHaveProperty('data');
		expect(JSON.stringify(result)).not.toContain(rawToken);
		expect(result).toEqual({
			email: 'new.member@example.bg',
			expiresAt: '2026-07-29T10:00:00.000Z'
		});
	});

	it('revokes the pending SQL invite when auth email delivery fails', async () => {
		const rawToken = 'b'.repeat(64);
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({
				data: [
					{
						invite_id: caseId,
						invite_token: rawToken,
						invite_expires_at: '2026-07-29T10:00:00.000Z'
					}
				],
				error: null
			})
			.mockResolvedValueOnce({ data: null, error: null });
		const client = {
			rpc,
			auth: {
				admin: {
					inviteUserByEmail: vi.fn(async () => ({
						data: { user: null },
						error: { message: 'delivery failed' }
					}))
				}
			}
		} as unknown as SupabaseClient;

		let deliveryFailure: ModerationWorkflowError | null = null;
		try {
			await createBetaInviteAndSendEmail(client, {
				email: 'member@example.bg',
				adminId: actorId,
				appOrigin: 'https://market.example'
			});
		} catch (cause) {
			deliveryFailure = cause as ModerationWorkflowError;
		}
		expect(deliveryFailure).toMatchObject({ code: 'DELIVERY_FAILED' });
		expect(deliveryFailure?.message).not.toContain(rawToken);
		expect(rpc).toHaveBeenLastCalledWith('revoke_beta_invite', {
			target_invite_id: caseId
		});
	});

	it('uses ConfirmationURL and redeems the one-time beta token after PKCE exchange', async () => {
		const template = await readFile('supabase/templates/invite.html', 'utf8');
		expect(template).toContain('{{ .ConfirmationURL }}');
		expect(template).not.toContain('TokenHash');

		const exchangeCodeForSession = vi.fn(async () => ({ data: {}, error: null }));
		const rpc = vi.fn(async () => ({ data: {}, error: null }));
		const signOut = vi.fn(async () => ({ error: null }));
		const locals = {
			runtime: { mode: 'production' },
			supabase: { auth: { exchangeCodeForSession, signOut }, rpc }
		};
		let redirect: { status?: number; location?: string } | null = null;
		try {
			await authCallback({
				url: new URL('https://market.example/auth/callback?code=pkce-code&invite_token=beta-token'),
				locals
			} as never);
		} catch (cause) {
			redirect = cause as { status?: number; location?: string };
		}
		expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
		expect(rpc).toHaveBeenCalledWith('redeem_beta_invite', { invite_token: 'beta-token' });
		expect(redirect).toMatchObject({ status: 303, location: '/onboarding?next=%2Fdashboard' });
	});
});

describe('source safety contract', () => {
	it('contains no demo admin import or raw-token logging', async () => {
		const [pageServer, workflow] = await Promise.all([
			readFile('src/routes/admin/+page.server.ts', 'utf8'),
			readFile('src/routes/admin/moderation.server.ts', 'utf8')
		]);
		expect(pageServer).not.toMatch(/demo\.server|demoCases|admin\.demo/);
		expect(workflow).not.toMatch(/console\.|user_metadata|raw_token/);
		expect(workflow).toContain("client.rpc('review_merchant_application'");
	});
});
