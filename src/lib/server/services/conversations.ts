import {
	conversationListInputSchema,
	editMessageInputSchema,
	messageListInputSchema,
	sendMessageInputSchema,
	updateConversationStateInputSchema,
	type ActionResult,
	type ConversationPageDto,
	type MessageDto,
	type MessagePageDto
} from '../../contracts';
import {
	editOrDeleteMessage,
	listConversations as repoListConversations,
	listMessages as repoListMessages,
	sendMessage as repoSendMessage,
	updateConversationState as repoUpdateConversationState,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getConversations(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ConversationPageDto>> {
	return runAuthenticatedAction(client, conversationListInputSchema, rawInput, (profileId, input) =>
		repoListConversations(client, profileId, input)
	);
}

export function getMessages(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<MessagePageDto>> {
	return runAuthenticatedAction(client, messageListInputSchema, rawInput, (_profileId, input) =>
		repoListMessages(client, input)
	);
}

export function sendMessage(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<MessageDto>> {
	return runAuthenticatedAction(client, sendMessageInputSchema, rawInput, (profileId, input) =>
		repoSendMessage(client, profileId, input)
	);
}

export function setConversationState(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(
		client,
		updateConversationStateInputSchema,
		rawInput,
		(profileId, input) => repoUpdateConversationState(client, profileId, input)
	);
}

export function editMessage(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, editMessageInputSchema, rawInput, (profileId, input) =>
		editOrDeleteMessage(client, profileId, input)
	);
}

