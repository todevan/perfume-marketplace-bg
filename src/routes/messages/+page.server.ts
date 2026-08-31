import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ConversationSummaryDto, MessageDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { getConversations, getMessages, sendMessage, setConversationState } from '$lib/server/services';

const demoConversations: ConversationSummaryDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    listingId: '00000000-0000-4000-8000-000000000201',
    listingTitle: 'Dior · Sauvage',
    counterpart: { id: '00000000-0000-4000-8000-000000000301', username: 'amber_room', avatarUrl: null, accountKind: 'private', merchantVerified: false },
    status: 'open', lastReadAt: null, muted: false, blocked: false,
    lastMessage: null, updatedAt: '2026-07-20T14:41:00.000Z'
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    listingId: '00000000-0000-4000-8000-000000000202',
    listingTitle: 'Tom Ford · Oud Wood',
    counterpart: { id: '00000000-0000-4000-8000-000000000302', username: 'iris_archive', avatarUrl: null, accountKind: 'private', merchantVerified: false },
    status: 'open', lastReadAt: '2026-07-20T13:00:00.000Z', muted: false, blocked: false,
    lastMessage: null, updatedAt: '2026-07-20T13:08:00.000Z'
  }
];

const demoMessages: MessageDto[] = [
  { id: '00000000-0000-4000-8000-000000000401', conversationId: demoConversations[0].id, sender: demoConversations[0].counterpart, body: 'Здравей! Интересувам се от Sauvage. Видях снимките и кода.', replyToId: null, createdAt: '2026-07-20T14:33:00.000Z', editedAt: null, deletedAt: null },
  { id: '00000000-0000-4000-8000-000000000402', conversationId: demoConversations[0].id, sender: { id: '00000000-0000-4000-8000-000000000999', username: 'demo_user', avatarUrl: null, accountKind: 'private', merchantVerified: false }, body: 'Здравей, благодаря! Флаконът е наличен. Мога да изпратя утре.', replyToId: null, createdAt: '2026-07-20T14:38:00.000Z', editedAt: null, deletedAt: null },
  { id: '00000000-0000-4000-8000-000000000403', conversationId: demoConversations[0].id, sender: demoConversations[0].counterpart, body: 'Мога да предложа €70. Удобен ли е Спиди с преглед?', replyToId: null, createdAt: '2026-07-20T14:41:00.000Z', editedAt: null, deletedAt: null }
];

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Услугата за съобщения не е конфигурирана.');
  return locals.supabase as MarketplaceSupabaseClient;
}

function statusFor(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'CONFLICT') return 409;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'DATABASE' || code === 'INTERNAL') return 500;
  return 400;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.runtime.mode === 'demo') {
    const requested = url.searchParams.get('conversation');
    const activeConversationId = demoConversations.some((item) => item.id === requested)
      ? requested!
      : demoConversations[0].id;
    return {
      demoMode: true,
      viewerId: '00000000-0000-4000-8000-000000000999',
      conversations: demoConversations,
      activeConversationId,
      messages: demoMessages.filter((message) => message.conversationId === activeConversationId)
    };
  }

  const client = clientFrom(locals);
  const conversationResult = await getConversations(client, { limit: 50, offset: 0 });
  if (!conversationResult.ok) error(statusFor(conversationResult.error.code), conversationResult.error.message);
  const conversations = conversationResult.data.items;
  const requested = url.searchParams.get('conversation');
  const activeConversationId = conversations.some((item) => item.id === requested)
    ? requested
    : (conversations[0]?.id ?? null);

  if (!activeConversationId) {
    return { demoMode: false, viewerId: locals.user!.id, conversations, activeConversationId: null, messages: [] };
  }
  const messageResult = await getMessages(client, {
    conversationId: activeConversationId,
    limit: 100,
    offset: 0
  });
  if (!messageResult.ok) error(statusFor(messageResult.error.code), messageResult.error.message);

  return {
    demoMode: false,
    viewerId: locals.user!.id,
    conversations,
    activeConversationId,
    messages: [...messageResult.data.items].reverse()
  };
};

export const actions: Actions = {
  send: async ({ request, locals }) => {
    if (locals.runtime.mode === 'demo') return { ok: true, demo: true };
    const formData = await request.formData();
    const result = await sendMessage(clientFrom(locals), {
      conversationId: formData.get('conversationId'),
      body: formData.get('body'),
      replyToId: formData.get('replyToId') || null
    });
    if (!result.ok) return fail(statusFor(result.error.code), { ok: false, error: result.error });
    return { ok: true, message: result.data };
  },
  state: async ({ request, locals }) => {
    const formData = await request.formData();
    const operation = formData.get('operation');
    if (locals.runtime.mode === 'demo') {
      return { ok: true, demo: true, operation, blocked: operation === 'block' };
    }
    const result = await setConversationState(clientFrom(locals), {
      conversationId: formData.get('conversationId'),
      ...(operation === 'read' ? { lastReadAt: null } : {}),
      ...(operation === 'mute' ? { muted: formData.get('enabled') === 'true' } : {}),
      ...(operation === 'block' ? { blocked: formData.get('enabled') === 'true' } : {})
    });
    if (!result.ok) return fail(statusFor(result.error.code), { ok: false, error: result.error });
    return {
      ok: true,
      operation,
      blocked: operation === 'block' && formData.get('enabled') === 'true'
    };
  }
};
