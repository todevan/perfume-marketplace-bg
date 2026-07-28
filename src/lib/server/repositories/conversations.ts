import type {
	ActorSummaryDto,
	ConversationListInput,
	ConversationPageDto,
	ConversationSummaryDto,
	EditMessageInput,
	MessageDto,
	MessageListInput,
	MessagePageDto,
	SendMessageInput,
	UpdateConversationStateInput
} from '../../contracts';
import type { Tables, Views } from '../database.types';
import { toActorSummaryDto } from './profiles';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type ConversationRow = Tables<'conversations'>;
type MemberRow = Tables<'conversation_members'>;
type MessageRow = Tables<'messages'>;
type OfferRow = Tables<'offers'>;
type ProfileRow = Views<'public_profiles'>;

function actor(row: ProfileRow): ActorSummaryDto {
	return toActorSummaryDto(row, 'conversations.actor');
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

export function toMessageDto(row: MessageRow, sender: ActorSummaryDto): MessageDto {
	return {
		id: row.id,
		conversationId: row.conversation_id,
		sender,
		body: row.deleted_at ? null : row.body,
		replyToId: row.reply_to_id,
		createdAt: row.created_at,
		editedAt: row.edited_at,
		deletedAt: row.deleted_at
	};
}

async function loadActors(
	client: MarketplaceSupabaseClient,
	profileIds: readonly string[]
): Promise<ReadonlyMap<string, ActorSummaryDto>> {
	if (profileIds.length === 0) return new Map();
	const { data, error } = await client
		.from('public_profiles')
		.select('id,username,avatar_path,account_kind,is_merchant_verified')
		.in('id', [...new Set(profileIds)]);
	throwIfError('conversations.actors', error);
	return new Map(
		((data ?? []) as unknown as ProfileRow[]).map((row) => {
			const summary = actor(row);
			return [summary.id, summary] as const;
		})
	);
}

export async function listConversations(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: ConversationListInput
): Promise<ConversationPageDto> {
	const { data: memberships, error: membershipError, count } = await client
		.from('conversation_members')
		.select('*', { count: 'exact' })
		.eq('profile_id', profileId)
		.order('joined_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	throwIfError('conversations.memberships', membershipError);
	const memberRows = (memberships ?? []) as MemberRow[];
	if (memberRows.length === 0) return pageDto([], count, input.limit, input.offset);

	const conversationIds = memberRows.map((row) => row.conversation_id);
	const { data: conversations, error: conversationError } = await client
		.from('conversations')
		.select('*')
		.in('id', conversationIds)
		.order('updated_at', { ascending: false });
	throwIfError('conversations.list', conversationError);
	const conversationRows = (conversations ?? []) as ConversationRow[];
	const offerIds = conversationRows.map((row) => row.accepted_offer_id);
	const listingIds = conversationRows.map((row) => row.listing_id);

	const [offersResult, listingsResult, messagesResult] = await Promise.all([
		client.from('offers').select('id,offerer_id').in('id', offerIds),
		client.from('listings').select('id,title,seller_id').in('id', listingIds),
		client
			.from('messages')
			.select('*')
			.in('conversation_id', conversationIds)
			.order('created_at', { ascending: false })
			.limit(Math.max(100, conversationIds.length * 10))
	]);
	throwIfError('conversations.offers', offersResult.error);
	throwIfError('conversations.listings', listingsResult.error);
	throwIfError('conversations.lastMessages', messagesResult.error);

	const offers = (offersResult.data ?? []) as Pick<OfferRow, 'id' | 'offerer_id'>[];
	const listings = (listingsResult.data ?? []) as Array<
		Pick<Tables<'listings'>, 'id' | 'title' | 'seller_id'>
	>;
	const messageRows = (messagesResult.data ?? []) as MessageRow[];
	const actorIds = [
		...offers.map((row) => row.offerer_id),
		...listings.map((row) => row.seller_id),
		...messageRows.map((row) => row.sender_id)
	];
	const actors = await loadActors(client, actorIds);
	const offerById = new Map(offers.map((row) => [row.id, row]));
	const listingById = new Map(listings.map((row) => [row.id, row]));
	const membershipByConversation = new Map(memberRows.map((row) => [row.conversation_id, row]));
	const lastMessageByConversation = new Map<string, MessageRow>();
	for (const message of messageRows) {
		if (!lastMessageByConversation.has(message.conversation_id)) {
			lastMessageByConversation.set(message.conversation_id, message);
		}
	}

	const items: ConversationSummaryDto[] = conversationRows.flatMap((conversation) => {
		const membership = membershipByConversation.get(conversation.id);
		const offer = offerById.get(conversation.accepted_offer_id);
		const listing = listingById.get(conversation.listing_id);
		if (!membership || !offer || !listing) return [];
		const counterpartId = listing.seller_id === profileId ? offer.offerer_id : listing.seller_id;
		const counterpart = actors.get(counterpartId) ?? removedActor(counterpartId);
		const lastRow = lastMessageByConversation.get(conversation.id);
		const lastSender = lastRow
			? actors.get(lastRow.sender_id) ?? removedActor(lastRow.sender_id)
			: undefined;
		return [{
			id: conversation.id,
			listingId: listing.id,
			listingTitle: listing.title,
			counterpart,
			status: conversation.status,
			lastReadAt: membership.last_read_at,
			muted: membership.muted_at !== null,
			blocked: membership.blocked_at !== null,
			lastMessage: lastRow && lastSender ? toMessageDto(lastRow, lastSender) : null,
			updatedAt: conversation.updated_at
		}];
	});

	return pageDto(items, count, input.limit, input.offset);
}

export async function listMessages(
	client: MarketplaceSupabaseClient,
	input: MessageListInput
): Promise<MessagePageDto> {
	const { data, error, count } = await client
		.from('messages')
		.select('*', { count: 'exact' })
		.eq('conversation_id', input.conversationId)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	throwIfError('messages.list', error);
	const rows = (data ?? []) as MessageRow[];
	const actors = await loadActors(client, rows.map((row) => row.sender_id));
	const items = rows.map((row) =>
		toMessageDto(row, actors.get(row.sender_id) ?? removedActor(row.sender_id))
	);
	return pageDto(items, count, input.limit, input.offset);
}

export async function sendMessage(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: SendMessageInput
): Promise<MessageDto> {
	const { data, error } = await client
		.from('messages')
		.insert({
			conversation_id: input.conversationId,
			sender_id: profileId,
			body: input.body,
			reply_to_id: input.replyToId ?? null
		})
		.select('*')
		.single();
	throwIfError('messages.send', error);
	const row = requireData('messages.send', data) as MessageRow;
	const sender = (await loadActors(client, [profileId])).get(profileId) ?? removedActor(profileId);
	return toMessageDto(row, sender);
}

export async function updateConversationState(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateConversationStateInput,
	now = new Date().toISOString()
): Promise<void> {
	const patch = {
		...(input.lastReadAt !== undefined ? { last_read_at: input.lastReadAt ?? now } : {}),
		...(input.muted !== undefined ? { muted_at: input.muted ? now : null } : {}),
		...(input.blocked !== undefined ? { blocked_at: input.blocked ? now : null } : {})
	};
	const { data, error } = await client
		.from('conversation_members')
		.update(patch)
		.eq('conversation_id', input.conversationId)
		.eq('profile_id', profileId)
		.select('conversation_id')
		.maybeSingle();
	throwIfError('conversations.updateState', error);
	requireData('conversations.updateState', data);
}

export async function editOrDeleteMessage(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: EditMessageInput,
	now = new Date().toISOString()
): Promise<void> {
	const patch = input.body === null
		? { deleted_at: now }
		: { body: input.body, edited_at: now, deleted_at: null };
	const { data, error } = await client
		.from('messages')
		.update(patch)
		.eq('id', input.messageId)
		.eq('sender_id', profileId)
		.select('id')
		.maybeSingle();
	throwIfError('messages.edit', error);
	requireData('messages.edit', data);
}
