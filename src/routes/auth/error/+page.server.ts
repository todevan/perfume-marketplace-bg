import type { PageServerLoad } from './$types';

const COPY: Record<string, string> = {
	invalid_callback: 'Липсва валиден код за вход.',
	invalid_link: 'Връзката за потвърждение е невалидна.',
	invalid_or_expired: 'Връзката е невалидна или е изтекла.',
	missing_beta_invite: 'Връзката не съдържа покана за затворената beta.',
	invalid_beta_invite: 'Поканата е невалидна, изтекла или вече оттеглена.',
	not_configured: 'Услугата за вход временно не е достъпна.'
};

export const load: PageServerLoad = ({ url }) => ({
	message: COPY[url.searchParams.get('reason') ?? ''] ?? 'Не успяхме да потвърдим достъпа.'
});

