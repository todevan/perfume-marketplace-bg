// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { url: new URL('https://market.example/login') } }));

import Header from '../../src/lib/components/Header.svelte';

const anonymous = {
	user: null,
	profile: null,
	betaAccess: null
};

const pending = {
	user: { id: 'user-1', email: 'member@example.bg', phone: null },
	profile: { username: 'scent_archive', role: 'user' as const, phoneVerifiedAt: null },
	betaAccess: {
		status: 'pending' as const,
		onboardingCompletedAt: null,
		isActive: false
	}
};

function active(phoneVerifiedAt: string | null = '2026-07-22T12:00:00Z') {
	return {
		user: { id: 'user-1', email: 'member@example.bg', phone: '+359888000000' },
		profile: { username: 'scent_archive', role: 'user' as const, phoneVerifiedAt },
		betaAccess: {
			status: 'active' as const,
			onboardingCompletedAt: '2026-07-22T11:00:00Z',
			isActive: true
		}
	};
}

afterEach(() => cleanup());

describe('auth-aware marketplace header', () => {
	it('shows only public navigation and login to anonymous visitors', () => {
		render(Header, { auth: anonymous, demoMode: false });

		expect(screen.getByRole('link', { name: 'Вход' }).getAttribute('href')).toBe('/login');
		expect(screen.getByRole('link', { name: 'Безопасност' }).getAttribute('href')).toBe('/safety');
		expect(screen.getByRole('link', { name: 'Правила' }).getAttribute('href')).toBe('/legal');
		expect(screen.queryByRole('link', { name: 'Съобщения' })).toBeNull();
		expect(screen.queryByRole('link', { name: /Публикувай/ })).toBeNull();
	});

	it('gives active members marketplace routes and a same-origin POST logout', () => {
		render(Header, { auth: active(), demoMode: false });

		expect(screen.getByRole('link', { name: 'Съобщения' }).getAttribute('href')).toBe('/messages');
		expect(screen.getByRole('link', { name: 'Моят профил' }).getAttribute('href')).toBe('/dashboard');
		expect(screen.getByRole('link', { name: /Публикувай/ }).getAttribute('href')).toBe('/publish');

		const logout = screen.getByRole('button', { name: 'Изход' });
		const form = logout.closest('form');
		expect(form).not.toBeNull();
		expect(form?.getAttribute('method')?.toLowerCase()).toBe('post');
		expect(form?.getAttribute('action')).toBe('/auth/logout');
	});

	it('routes pending accounts to onboarding without exposing private marketplace actions', () => {
		render(Header, { auth: pending, demoMode: false });

		expect(screen.getAllByRole('link', { name: 'Завърши профила' }).length).toBeGreaterThan(0);
		expect(screen.queryByRole('link', { name: 'Съобщения' })).toBeNull();
		expect(screen.queryByRole('link', { name: /Публикувай/ })).toBeNull();
		expect(screen.getByRole('button', { name: 'Изход' })).toBeTruthy();
	});

	it('keeps publish available without a phone-verification prompt', () => {
		render(Header, { auth: active(null), demoMode: false });

		expect(screen.queryByRole('link', { name: 'Потвърди телефон' })).toBeNull();
		expect(screen.getByRole('link', { name: /Публикувай/ }).getAttribute('href')).toBe('/publish');
	});

	it('preserves the full local walkthrough without presenting a fake logout', () => {
		render(Header, { auth: anonymous, demoMode: true });

		expect(screen.getByRole('link', { name: 'Съобщения' }).getAttribute('href')).toBe('/messages');
		expect(screen.getByRole('link', { name: /Публикувай/ }).getAttribute('href')).toBe('/publish');
		expect(screen.queryByRole('button', { name: 'Изход' })).toBeNull();
	});

	it('opens from a labelled 44px menu control and closes with Escape', async () => {
		render(Header, { auth: anonymous, demoMode: false });
		const toggle = screen.getByRole('button', { name: 'Отвори менюто' });
		expect(toggle.getAttribute('aria-controls')).toBe('mobile-navigation');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);
		expect(screen.getByRole('navigation', { name: 'Мобилна навигация' })).toBeTruthy();
		expect(toggle.getAttribute('aria-expanded')).toBe('true');

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('navigation', { name: 'Мобилна навигация' })).toBeNull();
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
});
