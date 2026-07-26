import type {
	ActorSummaryDto,
	CreateReviewInput,
	ReviewDto,
	ReviewListInput,
	ReviewPageDto,
	UpdateReviewInput
} from '../../contracts';
import type { Tables, Views } from '../database.types';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type ReviewRow = Tables<'reviews'>;
type ProfileRow = Views<'public_profiles'>;

function actor(row: ProfileRow): ActorSummaryDto {
	return {
		id: row.id,
		username: row.username,
		avatarUrl: row.avatar_path,
		accountKind: row.account_kind,
		merchantVerified: row.is_merchant_verified
	};
}

function removedActor(profileId: string): ActorSummaryDto {
	return {
		id: profileId,
		username: 'Премахнат потребител',
		avatarUrl: null,
		accountKind: 'private',
		merchantVerified: false
	};
}

async function hydrateReviews(
	client: MarketplaceSupabaseClient,
	rows: readonly ReviewRow[]
): Promise<readonly ReviewDto[]> {
	if (rows.length === 0) return [];
	const { data, error } = await client
		.from('public_profiles')
		.select('id,username,avatar_path,account_kind,is_merchant_verified')
		.in('id', [...new Set(rows.map((row) => row.reviewer_id))]);
	throwIfError('reviews.reviewers', error);
	const reviewers = new Map(
		((data ?? []) as unknown as ProfileRow[]).map((profile) => [profile.id, actor(profile)])
	);
	return rows.map((row) => {
		const reviewer = reviewers.get(row.reviewer_id) ?? removedActor(row.reviewer_id);
		return {
			id: row.id,
			dealId: row.deal_id,
			reviewer,
			revieweeId: row.reviewee_id,
			rating: row.rating,
			body: row.body,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	});
}

export async function listReviewsForProfile(
	client: MarketplaceSupabaseClient,
	input: ReviewListInput
): Promise<ReviewPageDto> {
	const { data, error, count } = await client
		.from('reviews')
		.select('*', { count: 'exact' })
		.eq('reviewee_id', input.profileId)
		.eq('status', 'published')
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	throwIfError('reviews.list', error);
	const items = await hydrateReviews(client, (data ?? []) as ReviewRow[]);
	return pageDto(items, count, input.limit, input.offset);
}

export async function createReview(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: CreateReviewInput
): Promise<ReviewDto> {
	const { data, error } = await client
		.from('reviews')
		.insert({
			deal_id: input.dealId,
			reviewer_id: profileId,
			reviewee_id: input.revieweeId,
			rating: input.rating,
			body: input.body ?? null,
			status: 'published'
		})
		.select('*')
		.single();
	throwIfError('reviews.create', error);
	const item = (await hydrateReviews(client, [requireData('reviews.create', data) as ReviewRow]))[0];
	return requireData('reviews.create.hydrate', item ?? null);
}

export async function updateOwnReview(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateReviewInput
): Promise<ReviewDto> {
	const { data, error } = await client
		.from('reviews')
		.update({ rating: input.rating, body: input.body ?? null })
		.eq('id', input.reviewId)
		.eq('reviewer_id', profileId)
		.eq('status', 'published')
		.select('*')
		.single();
	throwIfError('reviews.updateOwn', error);
	const item = (await hydrateReviews(client, [requireData('reviews.updateOwn', data) as ReviewRow]))[0];
	return requireData('reviews.updateOwn.hydrate', item ?? null);
}
