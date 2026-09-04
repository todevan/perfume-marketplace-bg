import { describe, expect, it, vi } from 'vitest';
import { actions } from '../../src/routes/settings/+page.server';

const currentProfile = {
	id: 'user-1',
	username: 'scent_archive',
	city: 'София',
	bio: 'Collector',
	avatarPath: null,
	accountKind: 'private',
	role: 'user',
	emailVerifiedAt: '2026-09-01T08:00:00Z',
	phoneVerifiedAt: null,
	merchantVerifiedAt: null,
	isSuspended: false
} as const;

function settingsEvent(city: string, client: unknown) {
	const url = new URL('https://market.example/settings');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ username: 'scent_archive', city, bio: 'Collector' })
		}),
		locals: {
			runtime: { mode: 'production' },
			profile: currentProfile,
			supabase: client
		}
	} as never;
}

describe('settings city updates', () => {
	it.each(['', '\u00a0\u00a0', '\u200b', '---'])(
		'preserves the stored city when the submitted city %j is invalid',
		async (city) => {
			const client = {
				auth: { getUser: vi.fn() },
				from: vi.fn()
			};
			const result = await actions.default(settingsEvent(city, client));

			expect(result).toMatchObject({
				status: 400,
				data: { ok: false, error: { code: 'VALIDATION' }, profile: currentProfile }
			});
			expect(client.auth.getUser).not.toHaveBeenCalled();
			expect(client.from).not.toHaveBeenCalled();
		}
	);

	it('stores a city after Unicode-space normalization', async () => {
		const updatedRow = {
			id: 'user-1',
			username: 'scent_archive',
			city: 'Стара Загора',
			bio: 'Collector',
			avatar_path: null,
			account_kind: 'private',
			is_merchant_verified: false,
			rating_average: 0,
			rating_count: 0,
			completed_deals_count: 0,
			member_since: '2026-09-01T08:00:00Z'
		};
		const updateEq = vi.fn(async () => ({ error: null }));
		const update = vi.fn(() => ({ eq: updateEq }));
		const client = {
			auth: {
				getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
			},
			from: vi.fn((table: string) => {
				if (table === 'profiles') return { update };
				if (table === 'public_profiles') {
					return {
						select: () => ({
							eq: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) })
						})
					};
				}
				throw new Error(`Unexpected table ${table}`);
			})
		};

		const result = await actions.default(settingsEvent('  Стара\u00a0\u2007Загора  ', client));

		expect(result).toMatchObject({ ok: true, profile: { city: 'Стара Загора' } });
		expect(update).toHaveBeenCalledWith({
			username: 'scent_archive',
			city: 'Стара Загора',
			bio: 'Collector'
		});
		expect(updateEq).toHaveBeenCalledWith('id', 'user-1');
	});
});

