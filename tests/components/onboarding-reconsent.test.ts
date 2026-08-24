// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import OnboardingPage from '../../src/routes/onboarding/+page.svelte';

afterEach(cleanup);

const documents = [
	{ documentCode: 'beta_terms', currentVersion: '2026-08-24-provisional.1' },
	{ documentCode: 'marketplace_rules', currentVersion: '2026-08-24-provisional.1' }
];

describe('onboarding re-consent presentation', () => {
	it('asks an existing member to re-consent without showing profile editing fields', () => {
		render(OnboardingPage, {
			data: {
				mode: 'reconsent',
				next: '/messages',
				documents,
				profile: { username: 'existing_member', city: 'Sofia' }
			},
			form: null
		} as any);

		expect(screen.getByRole('heading', { name: 'Потвърди актуалните условия.' })).toBeTruthy();
		expect(screen.getByText(/За да продължиш да използваш marketplace/)).toBeTruthy();
		expect(screen.queryByLabelText('Потребителско име')).toBeNull();
		expect(screen.queryByLabelText(/Град/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Приеми и продължи' })).toBeTruthy();
		expect(screen.getAllByRole('checkbox')).toHaveLength(2);
	});

	it('preserves the normal first-onboarding profile form', () => {
		render(OnboardingPage, {
			data: {
				mode: 'onboarding',
				next: '/dashboard',
				documents,
				profile: { username: 'new_member', city: null }
			},
			form: null
		} as any);

		expect(screen.getByRole('heading', { name: 'Завърши профила си.' })).toBeTruthy();
		expect(screen.getByLabelText('Потребителско име')).toBeTruthy();
		expect(screen.getByLabelText(/Град/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Активирай достъпа' })).toBeTruthy();
	});
});
