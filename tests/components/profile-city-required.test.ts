// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthProfile } from '../../src/lib/server/auth/types';
import OnboardingPage from '../../src/routes/onboarding/+page.svelte';
import SettingsPage from '../../src/routes/settings/+page.svelte';

afterEach(() => cleanup());

describe('required profile city fields', () => {
	it('requires city during onboarding without describing it as optional', () => {
		render(OnboardingPage, {
			data: {
				next: '/dashboard',
				documents: [],
				profile: { username: 'scent_archive', city: 'София' }
			} as never,
			form: null
		});

		const city = screen.getByRole('textbox', { name: 'Град' }) as HTMLInputElement;
		expect(city.required).toBe(true);
		expect(screen.queryByText('(незадължително)')).toBeNull();
	});

	it('requires city in settings and preserves the stored value after validation failure', () => {
		render(SettingsPage, {
			data: { profile: currentProfileForUi } as never,
			form: {
				ok: false,
				error: { code: 'VALIDATION', message: 'Please review the submitted fields.' },
				profile: currentProfileForUi
			}
		});

		const city = screen.getByRole('textbox', { name: 'Град' }) as HTMLInputElement;
		expect(city.required).toBe(true);
		expect(city.value).toBe('София');
	});
});

const currentProfileForUi: AuthProfile = {
	id: 'profile-1',
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
};

