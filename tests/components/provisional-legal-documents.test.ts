// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LegalIndexPage from '../../src/routes/legal/+page.svelte';
import MarketplaceRulesPage from '../../src/routes/legal/rules/+page.svelte';
import TermsPage from '../../src/routes/legal/terms/+page.svelte';

afterEach(cleanup);

const provisionalVersion = '2026-08-24-provisional.1';
const provisionalDate = '24.08.2026';

describe('provisional legal documents', () => {
	it.each([
		[
			'Legal index',
			LegalIndexPage,
			'Одобрени от собственика временни продуктови чернови.',
			'Не са прегледани или одобрени от адвокат.'
		],
		[
			'Terms',
			TermsPage,
			'Одобрена от собственика временна продуктова чернова.',
			'Не е прегледана или одобрена от адвокат.'
		],
		[
			'Marketplace Rules',
			MarketplaceRulesPage,
			'Одобрена от собственика временна продуктова чернова.',
			'Не е прегледана или одобрена от адвокат.'
		]
	])('identifies %s as the owner-approved provisional draft', (_name, Page, approvalCopy, counselCopy) => {
		const { container } = render(Page);
		const copy = container.textContent ?? '';

		expect(copy).toContain(provisionalVersion);
		expect(copy).toContain(provisionalDate);
		expect(copy).toContain(approvalCopy);
		expect(copy).toContain(counselCopy);
		expect(copy).toContain(
			'Преди публичното или търговското стартиране е задължителен преглед от квалифициран български адвокат.'
		);
	});

	it.each([
		['Terms', TermsPage],
		['Marketplace Rules', MarketplaceRulesPage]
	])('states the implemented deal lifecycle in %s', (_name, Page) => {
		const { container } = render(Page);
		const copy = container.textContent ?? '';

		expect(copy).toContain('Продавачът отбелязва сделката като приключена.');
		expect(copy).toContain(
			'Преди приключването всеки от участниците може да я откаже, като посочи причина, която се запазва в платформата.'
		);
		expect(copy).toContain(
			'Само приключените от продавача сделки отключват възможност за отзив; отменените сделки не отключват отзив.'
		);
	});

	it('states normal-user admission without phone or invitation requirements', () => {
		const { container } = render(TermsPage);
		const copy = container.textContent ?? '';

		expect(copy).toContain(
			'Нормалният потребител се регистрира с имейл и парола, потвърждава имейла си и завършва въвеждането в платформата.'
		);
		expect(copy).toContain(
			'Не се изискват покана, списък на чакащи, потвърждение на телефон или SMS код.'
		);
		expect(copy).not.toContain('изисква профил, потвърден имейл, потвърден телефон');
	});
});
