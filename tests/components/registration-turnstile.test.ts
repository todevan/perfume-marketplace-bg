// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '../../src/routes/login/+page.svelte';

afterEach(() => {
	cleanup();
	delete (window as Window & { turnstile?: unknown }).turnstile;
});

describe('registration Turnstile challenge', () => {
	it('uses one action-specific challenge for the active login or registration mode', async () => {
		const renderWidget = vi.fn(() => 'login-widget');
		const removeWidget = vi.fn();
		(window as Window & { turnstile?: { render: typeof renderWidget; remove: typeof removeWidget } }).turnstile = {
			render: renderWidget,
			remove: removeWidget
		};

		const { container } = render(LoginPage, {
			data: {
				auth: { betaAccess: null, currentAal: null, profile: null, user: null },
				authConfigured: true,
				demoEmail: '',
				demoMode: false,
				next: '/',
				requestId: 'test-registration-turnstile',
				turnstileSiteKey: 'turnstile-site-key'
			},
			form: null
		});
		await tick();

		expect(container.querySelectorAll('.cf-turnstile')).toHaveLength(1);
		expect(container.querySelector('.cf-turnstile')?.getAttribute('data-action')).toBe('login');
		expect(renderWidget).toHaveBeenCalledTimes(1);
		expect(renderWidget).toHaveBeenLastCalledWith(
			expect.any(HTMLElement),
			expect.objectContaining({ action: 'login', sitekey: 'turnstile-site-key' })
		);

		const registrationTab = container.querySelectorAll<HTMLButtonElement>('.mode-tabs button')[1];
		await fireEvent.click(registrationTab);
		await tick();

		expect(container.querySelectorAll('.cf-turnstile')).toHaveLength(1);
		expect(container.querySelector('.cf-turnstile')?.getAttribute('data-action')).toBe('register');
		expect(container.querySelector('.cf-turnstile[data-action="login"]')).toBeNull();
		expect(removeWidget).toHaveBeenCalledWith('login-widget');
		expect(renderWidget).toHaveBeenCalledTimes(2);
		expect(renderWidget).toHaveBeenLastCalledWith(
			expect.any(HTMLElement),
			expect.objectContaining({ action: 'register', sitekey: 'turnstile-site-key' })
		);

		const ageAcceptance = container.querySelector<HTMLInputElement>('input[name="ageAccepted"]');
		expect(ageAcceptance).not.toBeNull();
		expect(ageAcceptance?.required).toBe(true);
	});
});
