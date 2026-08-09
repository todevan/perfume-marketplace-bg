import { validateMoney } from './money';
import { issuesResult } from './result';
import type {
	DomainIssue,
	ListingActivationContext,
	ListingInput,
	ListingStatus,
	PhotoRole,
	ValidationResult
} from './types';
import { validateBottleAmount } from './volume';

export const LISTING_LIFETIME_DAYS = 60;
export const MIN_LISTING_PHOTOS = 4;

const terminalStatuses = new Set<ListingStatus>(['completed', 'rejected', 'removed']);

const transitions: Record<ListingStatus, ReadonlySet<ListingStatus>> = {
	draft: new Set(['active', 'rejected', 'removed']),
	active: new Set(['reserved', 'paused', 'completed', 'expired', 'rejected', 'removed']),
	reserved: new Set(['active', 'paused', 'completed', 'expired', 'removed']),
	paused: new Set(['active', 'expired', 'removed']),
	completed: new Set(),
	expired: new Set(['active', 'removed']),
	rejected: new Set(['draft', 'removed']),
	removed: new Set()
};

export function canTransitionListing(from: ListingStatus, to: ListingStatus): boolean {
	return from === to || transitions[from].has(to);
}

export function isTerminalListingStatus(status: ListingStatus): boolean {
	return terminalStatuses.has(status);
}

export function listingExpiresAt(activatedAt: Date, lifetimeDays = LISTING_LIFETIME_DAYS): Date {
	const result = new Date(activatedAt);
	result.setUTCDate(result.getUTCDate() + lifetimeDays);
	return result;
}

export function isAllowedFragranticaUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			url.hostname.toLowerCase() === 'www.fragrantica.com' &&
			url.pathname.startsWith('/perfume/') &&
			url.username === '' &&
			url.password === ''
		);
	} catch {
		return false;
	}
}

export function requiredPhotoRoles(listing: ListingInput): ReadonlySet<PhotoRole> {
	if (listing.productFormat === 'official_sample') {
		return new Set(['product_full', 'manufacturer_label', 'manufacturer_markings', 'seal']);
	}

	if (listing.amount?.isSealed) {
		return new Set(['box_front', 'box_bottom', 'batch_code', 'seal']);
	}

	return new Set(['product_full', 'bottle_bottom', 'batch_code', 'fill_level']);
}

function collectResult(issues: DomainIssue[], result: ValidationResult): void {
	if (!result.ok) issues.push(...result.issues);
}

function validatePriceRules(listing: ListingInput, issues: DomainIssue[]): void {
	if (listing.kind === 'wanted') {
		collectResult(issues, validateMoney(listing.maxBudget, 'maxBudget'));
		if (listing.price != null || listing.estimatedValue != null) {
			issues.push({
				code: 'wanted_price_fields_invalid',
				field: 'price',
				message: 'Обява „Търся“ използва само максимален бюджет.'
			});
		}
		return;
	}

	if (listing.dealMode === 'sale' || listing.dealMode === 'sale_or_swap') {
		collectResult(issues, validateMoney(listing.price, 'price', { required: true }));
	} else if (listing.price != null) {
		issues.push({
			code: 'swap_price_invalid',
			field: 'price',
			message: 'Обява само за размяна няма продажна цена.'
		});
	}

	collectResult(issues, validateMoney(listing.estimatedValue, 'estimatedValue'));
	if (listing.maxBudget != null) {
		issues.push({
			code: 'offer_budget_invalid',
			field: 'maxBudget',
			message: 'Максимален бюджет се използва само при обява „Търся“.'
		});
	}
}

function validatePhotos(listing: ListingInput, issues: DomainIssue[]): void {
	if (listing.photos.length < MIN_LISTING_PHOTOS) {
		issues.push({
			code: 'photos_too_few',
			field: 'photos',
			message: `Необходими са поне ${MIN_LISTING_PHOTOS} различни снимки.`
		});
	}

	const roles = new Set(listing.photos.map((photo) => photo.role));
	for (const role of requiredPhotoRoles(listing)) {
		if (!roles.has(role)) {
			issues.push({
				code: 'photo_role_missing',
				field: 'photos',
				message: `Липсва задължителна снимка от тип ${role}.`
			});
		}
	}
}

export function validateListing(
	listing: ListingInput,
	activation?: ListingActivationContext
): ValidationResult {
	const issues: DomainIssue[] = [];
	const trimmedName = listing.fragranceName.trim();
	if (trimmedName.length < 2 || trimmedName.length > 160) {
		issues.push({
			code: 'fragrance_name_invalid',
			field: 'fragranceName',
			message: 'Името на аромата трябва да е между 2 и 160 знака.'
		});
	}

	if (new Set(listing.segments).size !== listing.segments.length) {
		issues.push({ code: 'segments_duplicate', field: 'segments', message: 'Сегментите се повтарят.' });
	}

	if (!listing.brandId) {
		const otherBrand = listing.otherBrandName?.trim() ?? '';
		if (otherBrand.length < 2 || otherBrand.length > 80) {
			issues.push({
				code: 'brand_required',
				field: 'otherBrandName',
				message: 'Въведете марка между 2 и 80 знака.'
			});
		}
		if (/https?:\/\/|www\.|@|\+?\d[\d\s().-]{6,}/iu.test(otherBrand)) {
			issues.push({
				code: 'brand_contact_data',
				field: 'otherBrandName',
				message: 'Името на марката не може да съдържа URL или данни за контакт.'
			});
		}
	}

	if (listing.fragranticaUrl && !isAllowedFragranticaUrl(listing.fragranticaUrl)) {
		issues.push({
			code: 'fragrantica_url_invalid',
			field: 'fragranticaUrl',
			message: 'Използвайте директен https://www.fragrantica.com/perfume/… линк.'
		});
	}

	if (
		listing.concentration === 'OTHER_NOT_STATED' &&
		(listing.concentrationLabel?.trim().length ?? 0) > 80
	) {
		issues.push({
			code: 'concentration_label_too_long',
			field: 'concentrationLabel',
			message: 'Точното изписване може да бъде до 80 знака.'
		});
	}

	validatePriceRules(listing, issues);

	if (listing.kind === 'offer') {
		if (!listing.productFormat || !listing.amount) {
			issues.push({
				code: 'physical_product_required',
				field: 'productFormat',
				message: 'Продаващата обява трябва да описва един физически продукт.'
			});
		} else {
			collectResult(issues, validateBottleAmount(listing.amount, listing.status === 'active'));
		}
	} else if (listing.amount != null) {
		collectResult(issues, validateBottleAmount(listing.amount));
	}

	if (listing.status === 'active') {
		if (listing.kind === 'offer') validatePhotos(listing, issues);
		if (!activation) {
			issues.push({
				code: 'activation_context_required',
				message: 'Липсва контекст за публикуване на обявата.'
			});
		} else {
			if (activation.activeListingCount >= activation.activeListingLimit) {
				issues.push({
					code: 'active_listing_quota_reached',
					message: 'Достигнат е лимитът за активни обяви.'
				});
			}
		}
	}

	return issuesResult(issues);
}
