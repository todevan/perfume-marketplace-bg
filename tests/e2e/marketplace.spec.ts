import { expect, test, type Page } from '@playwright/test';

async function gotoHydrated(page: Page, path: string): Promise<void> {
	await page.goto(path);
	// The preview server can finish `load` just before Svelte binds client event handlers.
	await page.waitForLoadState('networkidle');
}

test.describe('public marketplace', () => {
	test('home search leads into the local catalog and exposes keyboard navigation', async (
		{ page },
		testInfo
	) => {
		await gotoHydrated(page, '/');

		await expect(
			page.getByRole('heading', { name: /Всеки аромат има следваща история/i })
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Към основното съдържание' })).toHaveAttribute(
			'href',
			'#main-content'
		);
		if (testInfo.project.name === 'mobile') {
			await page.getByRole('button', { name: 'Отвори менюто' }).click();
			await expect(page.getByRole('navigation', { name: 'Мобилна навигация' })).toBeVisible();
		} else {
			await expect(page.getByRole('navigation', { name: 'Основна навигация' })).toBeVisible();
		}

		await page.getByRole('textbox', { name: 'Търси аромат или марка' }).fill('Khamrah');
		await page.getByRole('button', { name: 'Търси' }).click();
		await expect(page).toHaveURL(/\/listings\?q=Khamrah$/);
		await expect(page.getByText('Khamrah', { exact: true })).toBeVisible();
	});

	test('catalog filters by category and search without a backend', async ({ page }) => {
		await gotoHydrated(page, '/listings');
		await expect(page.getByRole('heading', { name: 'Обяви', exact: true })).toBeVisible();

		await page.getByRole('link', { name: 'Арабски', exact: true }).click();
		await expect(page).toHaveURL(/category=arabic/);
		await expect(page.locator('.results-grid article')).toHaveCount(1);
		await expect(page.getByText('Khamrah', { exact: true })).toBeVisible();

		await page.getByRole('link', { name: 'Всички', exact: true }).click();
		await expect(page).toHaveURL(/\/listings$/);
		await page.locator('#catalog-search').fill('Sauvage');
		await page.locator('.catalog-hero form.search-shell button[type="submit"]').click();
		await expect(page).toHaveURL(/q=Sauvage/);
		await expect(page.locator('.results-grid article')).toHaveCount(1);
		await expect(page.getByText('Sauvage', { exact: true })).toBeVisible();
	});

	test('listing offer panel presents a non-binding intent and all offer variants', async ({ page }) => {
		await gotoHydrated(page, '/listing/lattafa-khamrah-edp-100ml');
		await page.getByRole('button', { name: 'Изпрати оферта' }).click();

		const panel = page.getByRole('dialog', { name: 'Твоята оферта' });
		await expect(panel).toBeVisible();
		await expect(panel.getByText(/не създава договор или плащане/i)).toBeVisible();

		await panel.getByRole('radio', { name: 'Размяна' }).check();
		await expect(panel.getByLabel('Твоя активна обява')).toBeVisible();
		await panel.getByLabel('Твоя активна обява').selectOption({ index: 1 });
		await expect(panel.getByLabel('Предложена сума')).toHaveCount(0);

		await panel.getByRole('radio', { name: 'Аромат + сума' }).check();
		await expect(panel.getByLabel('Твоя активна обява')).toBeVisible();
		await panel.getByLabel('Предложена сума').fill('70');
		await panel.getByRole('button', { name: 'Изпрати намерение' }).click();
		await expect(panel.getByRole('heading', { name: 'Офертата е изпратена.' })).toBeVisible();
	});
});

test.describe('publish wizard', () => {
	test('validates step one, then supports a wanted-listing path through the first steps', async ({
		page
	}) => {
		await gotoHydrated(page, '/publish');

		await expect(page.getByRole('heading', { name: 'Разкажи историята на аромата' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Стъпки за публикуване' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Кой е ароматът?' })).toBeVisible();

		await page.getByRole('button', { name: 'Продължи' }).click();
		await expect(page.locator('#brand-error')).toHaveText('Избери марка или използвай „Други“.');
		await expect(page.getByRole('combobox', { name: 'Марка' })).toBeFocused();

		await page.getByRole('combobox', { name: 'Марка' }).fill('Dior');
		await page.getByLabel('Име на парфюма').fill('Homme Parfum');
		await page.getByRole('radio', { name: /^Дамски/ }).check();
		await page.getByRole('button', { name: 'Продължи' }).click();
		await expect(page.getByRole('heading', { name: 'Каква обява създаваш?' })).toBeVisible();

		await page.getByRole('radio', { name: /^Търся парфюм/ }).check();
		await expect(page.getByText('Това е обява „Търся“')).toBeVisible();
		await page.getByRole('button', { name: 'Продължи' }).click();

		await expect(page.getByRole('heading', { name: 'Опиши какво търсиш' })).toBeVisible();
		await expect(page.getByText('Без конкретен физически артикул')).toBeVisible();
		await expect(page.getByLabel('Предпочитан оригинален обем')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /Провери в batch-code.com/ })).toHaveAttribute(
			'target',
			'_blank'
		);
	});
});

test.describe('responsive private area', () => {
	test('core pages do not create document-level overflow at acceptance viewports', async (
		{ page },
		testInfo
	) => {
		test.skip(testInfo.project.name !== 'chromium', 'One Chromium matrix covers the exact widths.');

		for (const width of [320, 375, 768, 1024, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			for (const path of ['/', '/listings', '/publish']) {
				await gotoHydrated(page, path);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
				);
				expect(overflow, `${path} has horizontal overflow at ${width}px`).toBe(false);
			}
		}
	});

	test('dashboard remains within the viewport and exposes its regions', async ({ page }) => {
		await gotoHydrated(page, '/dashboard');

		await expect(page.getByRole('heading', { name: 'Здравей, north_notes.' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Потребителска зона' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Статистика' })).toBeVisible();
		await expect(page.getByLabel('Използвани 3 от 10 активни слота')).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		).toBe(true);
	});

	test('messages supports its responsive conversation flow and accessible controls', async (
		{ page },
		testInfo
	) => {
		await gotoHydrated(page, '/messages');

		await expect(page.getByRole('heading', { name: 'Съобщения' })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Търси разговор' })).toBeVisible();

		if (testInfo.project.name === 'mobile') {
			await page.getByRole('button', { name: /amber_room/ }).click();
			await expect(page.getByRole('button', { name: 'Назад към разговорите' })).toBeVisible();
		}

		if (testInfo.project.name === 'mobile') {
			await expect(page.getByRole('button', { name: 'Информация за разговора' })).toBeVisible();
		} else {
			await expect(page.getByRole('link', { name: 'Докладвай' })).toBeVisible();
		}
		await page.getByRole('textbox', { name: 'Съобщение' }).fill('Тестово локално съобщение');
		await page.getByRole('button', { name: 'Изпрати' }).click();
		await expect(page.getByText('Тестово локално съобщение')).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		).toBe(true);
	});
});
