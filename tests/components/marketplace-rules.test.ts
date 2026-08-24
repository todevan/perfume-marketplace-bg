// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MarketplaceRulesPage from '../../src/routes/legal/rules/+page.svelte';

afterEach(cleanup);

describe('Marketplace Rules deal lifecycle copy', () => {
	it('explains seller completion, participant cancellation, and review eligibility', () => {
		render(MarketplaceRulesPage);

		const lifecycle = screen.getByRole('heading', { name: 'Оферти, чат и сделка' }).nextElementSibling;
		expect(lifecycle?.textContent).toContain('Продавачът отбелязва сделката като приключена.');
		expect(lifecycle?.textContent).toContain(
			'Преди приключването всеки от участниците може да я откаже, като посочи причина, която се запазва в платформата.'
		);
		expect(lifecycle?.textContent).toContain(
			'Само приключените от продавача сделки отключват възможност за отзив; отменените сделки не отключват отзив.'
		);
	});
});
