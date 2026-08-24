import { describe, expect, it, vi } from 'vitest';
import { actions, load } from '../../src/routes/onboarding/+page.server';

const documents = [
	{ document_code: 'beta_terms', document_version: '2026-08-24-provisional.1' },
	{ document_code: 'marketplace_rules', document_version: '2026-08-24-provisional.1' }
];

function supabaseClient(options: { documentError?: boolean; consentErrorAt?: number } = {}) {
	let consentCalls = 0;
	return {
		from: vi.fn(() => ({
			select: () => ({
				eq: () => ({
					order: async () => ({
						data: options.documentError ? null : documents,
						error: options.documentError ? { message: 'unavailable' } : null
					})
				})
			})
		})),
		rpc: vi.fn(async (name: string) => {
			if (name === 'accept_beta_consent') {
				consentCalls += 1;
				return {
					data: options.consentErrorAt === consentCalls ? null : true,
					error: options.consentErrorAt === consentCalls ? { message: 'write failed' } : null
				};
			}
			if (name === 'complete_beta_onboarding') return { data: true, error: null };
			throw new Error(`Unexpected RPC ${name}`);
		})
	};
}

function locals(overrides: Record<string, unknown> = {}) {
	return {
		runtime: { mode: 'production' },
		user: { id: 'user-1' },
		profile: {
			id: 'user-1',
			username: 'existing_member',
			city: 'Sofia',
			emailVerifiedAt: '2026-07-22T09:00:00Z',
			isSuspended: false
		},
		betaAccess: {
			status: 'active',
			onboardingCompletedAt: '2026-07-22T10:00:00Z',
			hasCurrentConsents: false,
			isActive: false
		},
		supabase: supabaseClient(),
		...overrides
	} as any;
}

function postEvent(appLocals: ReturnType<typeof locals>, form: URLSearchParams) {
	const url = new URL('https://market.example/onboarding');
	return {
		url,
		locals: appLocals,
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: form
		})
	} as any;
}

describe('mandatory re-consent onboarding', () => {
	it('loads an explicit re-consent mode for an already-onboarded active member', async () => {
		await expect(
			load({
				url: new URL('https://market.example/onboarding?next=%2Fmessages'),
				locals: locals()
			} as any)
		).resolves.toMatchObject({
			mode: 'reconsent',
			next: '/messages',
			documents: [
				{ documentCode: 'beta_terms', currentVersion: '2026-08-24-provisional.1' },
				{ documentCode: 'marketplace_rules', currentVersion: '2026-08-24-provisional.1' }
			]
		});
	});

	it('prioritizes stale consent over an inconsistent active-access flag', async () => {
		const appLocals = locals({
			betaAccess: {
				status: 'active',
				onboardingCompletedAt: '2026-07-22T10:00:00Z',
				hasCurrentConsents: false,
				isActive: true
			}
		});

		await expect(
			load({ url: new URL('https://market.example/onboarding'), locals: appLocals } as any)
		).resolves.toMatchObject({ mode: 'reconsent' });
	});

	it('fails closed when current required documents cannot be loaded', async () => {
		const appLocals = locals({ supabase: supabaseClient({ documentError: true }) });

		await expect(
			load({ url: new URL('https://market.example/onboarding'), locals: appLocals } as any)
		).rejects.toMatchObject({ status: 503 });
	});

	it('denies re-consent when the existing profile is not email verified', async () => {
		const appLocals = locals({
			profile: {
				id: 'user-1',
				username: 'existing_member',
				city: 'Sofia',
				emailVerifiedAt: null,
				isSuspended: false
			}
		});

		await expect(
			load({ url: new URL('https://market.example/onboarding'), locals: appLocals } as any)
		).rejects.toMatchObject({ status: 403 });

		const result = await actions.default(
			postEvent(
				appLocals,
				new URLSearchParams({
					consent_beta_terms: 'on',
					consent_marketplace_rules: 'on'
				})
			)
		);
		expect(result).toMatchObject({ status: 403 });
		expect(appLocals.supabase.rpc).not.toHaveBeenCalled();
	});

	it('requires affirmative acceptance of every current document during re-consent', async () => {
		const appLocals = locals();
		const result = await actions.default(
			postEvent(
				appLocals,
				new URLSearchParams({ next: '/messages', consent_beta_terms: 'on' })
			)
		);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(appLocals.supabase.rpc).not.toHaveBeenCalled();
	});

	it('records each current version without rerunning profile onboarding and redirects safely', async () => {
		const appLocals = locals();
		const form = new URLSearchParams({
			next: '//attacker.example',
			username: 'attempted_profile_mutation',
			city: 'Plovdiv',
			consent_beta_terms: 'on',
			consent_marketplace_rules: 'on'
		});

		await expect(actions.default(postEvent(appLocals, form))).rejects.toMatchObject({
			status: 303,
			location: '/dashboard'
		});
		expect(appLocals.supabase.rpc).toHaveBeenNthCalledWith(1, 'accept_beta_consent', {
			requested_document_code: 'beta_terms',
			requested_document_version: '2026-08-24-provisional.1'
		});
		expect(appLocals.supabase.rpc).toHaveBeenNthCalledWith(2, 'accept_beta_consent', {
			requested_document_code: 'marketplace_rules',
			requested_document_version: '2026-08-24-provisional.1'
		});
		expect(appLocals.supabase.rpc).not.toHaveBeenCalledWith(
			'complete_beta_onboarding',
			expect.anything()
		);
	});

	it('fails closed and does not complete onboarding if a consent record cannot be appended', async () => {
		const appLocals = locals({ supabase: supabaseClient({ consentErrorAt: 2 }) });
		const form = new URLSearchParams({
			consent_beta_terms: 'on',
			consent_marketplace_rules: 'on'
		});

		const result = await actions.default(postEvent(appLocals, form));

		expect(result).toMatchObject({ status: 503, data: { success: false } });
		expect(appLocals.supabase.rpc).not.toHaveBeenCalledWith(
			'complete_beta_onboarding',
			expect.anything()
		);
	});

	it('keeps first onboarding profile completion unchanged', async () => {
		const appLocals = locals({
			betaAccess: {
				status: 'pending',
				onboardingCompletedAt: null,
				hasCurrentConsents: false,
				isActive: false
			}
		});
		const form = new URLSearchParams({
			next: '/listings',
			username: 'new_member',
			city: 'Varna',
			consent_beta_terms: 'on',
			consent_marketplace_rules: 'on'
		});

		await expect(actions.default(postEvent(appLocals, form))).rejects.toMatchObject({
			status: 303,
			location: '/listings'
		});
		expect(appLocals.supabase.rpc).toHaveBeenCalledWith('complete_beta_onboarding', {
			desired_username: 'new_member',
			home_city: 'Varna'
		});
	});
});
