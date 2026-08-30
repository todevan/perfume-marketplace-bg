<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { ArrowLeft, Ban, CheckCheck, Flag, ImagePlus, MessageCircle, MoreHorizontal, Paperclip, Search, Send, ShieldCheck } from '@lucide/svelte';
  import { getSupabaseBrowserClient } from '$lib/client/supabase';
  import type { MessageDto } from '$lib/contracts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let text = $state('');
  let mobileChat = $state(false);
  let optimisticMessages = $state<MessageDto[]>([]);
  let blockedConversationId = $state<string | null>(null);
  let localMessages = $derived([...data.messages, ...optimisticMessages]);
  let activeConversation = $derived(
    data.conversations.find((conversation) => conversation.id === data.activeConversationId) ?? null
  );
  let conversationBlocked = $derived(Boolean(
    activeConversation?.blocked || activeConversation?.id === blockedConversationId
  ));

  $effect(() => {
    if (data.demoMode || !data.activeConversationId) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`conversation:${data.activeConversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${data.activeConversationId}` },
        () => void invalidateAll()
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  });

  function initial(username: string): string {
    return username.slice(0, 1).toLocaleUpperCase('bg-BG');
  }

  function time(value: string): string {
    return new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  function preview(conversation: (typeof data.conversations)[number]): string {
    return conversation.lastMessage?.body ?? 'Разговорът е отключен след приета оферта.';
  }

  function unread(conversation: (typeof data.conversations)[number]): boolean {
    return Boolean(
      conversation.lastMessage &&
      conversation.lastMessage.sender.id !== data.viewerId &&
      (!conversation.lastReadAt || conversation.lastMessage.createdAt > conversation.lastReadAt)
    );
  }

  async function openConversation(id: string) {
    mobileChat = true;
    await goto(`/messages?conversation=${encodeURIComponent(id)}`);
  }

  const enhanceSend: SubmitFunction = ({ formData, cancel }) => {
    const body = formData.get('body')?.toString().trim() ?? '';
    if (!body) { cancel(); return; }
    if (data.demoMode && activeConversation) {
      cancel();
      optimisticMessages = [...optimisticMessages, {
        id: crypto.randomUUID(), conversationId: activeConversation.id,
        sender: { id: data.viewerId, username: 'demo_user', avatarUrl: null, accountKind: 'private', merchantVerified: false },
        body, replyToId: null, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null
      }];
      text = '';
      return;
    }
    return async ({ update }) => { text = ''; await update({ reset: true, invalidateAll: true }); };
  };

  const enhanceBlock: SubmitFunction = ({ formData, cancel }) => {
    if (!confirm('Блокирането спира новите съобщения и за двамата участници. Продължаване?')) {
      cancel();
      return;
    }
    const conversationId = formData.get('conversationId')?.toString() ?? null;
    if (data.demoMode) {
      cancel();
      blockedConversationId = conversationId;
      text = '';
      return;
    }
    return async ({ result, update }) => {
      const response = result.type === 'success'
        ? result.data as { ok?: boolean; blocked?: boolean }
        : null;
      if (response?.ok && response.blocked) {
        blockedConversationId = conversationId;
        text = '';
      }
      await update({ reset: false, invalidateAll: true });
    };
  };
</script>

<svelte:head><title>Съобщения · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="messages-shell container">
  <aside class:mobile-hidden={mobileChat} class="conversation-list surface">
    <div class="list-head"><div><span class="eyebrow">Частен чат</span><h1>Съобщения</h1></div><button aria-label="Още настройки"><MoreHorizontal size={20} /></button></div>
    <label class="chat-search"><Search size={18} /><span class="sr-only">Търси разговор</span><input placeholder="Търси разговор..." /></label>
    <div class="conversation-items">
      {#each data.conversations as conversation}
        <button class:active={data.activeConversationId === conversation.id} onclick={() => openConversation(conversation.id)}>
          <span class="avatar">{initial(conversation.counterpart.username)}</span>
          <span class="conversation-copy"><strong>{conversation.counterpart.username}</strong><small>{conversation.listingTitle}</small><span>{preview(conversation)}</span></span>
          <span class="conversation-meta"><time>{time(conversation.updatedAt)}</time>{#if unread(conversation)}<b>1</b>{/if}</span>
        </button>
      {/each}
      {#if data.conversations.length === 0}<p class="empty-conversations">Няма разговори. Чат се отключва след приета оферта.</p>{/if}
    </div>
    <div class="privacy"><ShieldCheck size={17} /><p>Разговорите са видими само за участниците. Модератор получава достъп единствено при активен сигнал.</p></div>
  </aside>

  {#if activeConversation}
  <div class:mobile-visible={mobileChat} class="chat surface">
    <header class="chat-head">
      <button class="back" aria-label="Назад към разговорите" onclick={() => (mobileChat = false)}><ArrowLeft size={21} /></button>
      <span class="avatar">{initial(activeConversation.counterpart.username)}</span>
      <div><strong>{activeConversation.counterpart.username}</strong><span>за {activeConversation.listingTitle}</span></div>
      {#if !conversationBlocked}
        <form method="POST" action="?/state" use:enhance={enhanceBlock}>
          <input type="hidden" name="conversationId" value={activeConversation.id} />
          <input type="hidden" name="operation" value="block" />
          <input type="hidden" name="enabled" value="true" />
          <button type="submit" aria-label="Блокирай контакт" title="Блокирай контакт"><Ban size={19} /></button>
        </form>
      {:else}
        <span class="blocked-chip"><Ban size={17} /> Блокиран</span>
      {/if}
      <a href={`/report?targetType=conversation&targetId=${activeConversation.id}`} aria-label="Докладвай"><Flag size={18} /></a>
    </header>

    <div class="listing-context"><div class="bottle-mini"><span></span></div><div><span>Резервирана обява</span><strong>{activeConversation.listingTitle}</strong><small>Детайлите и условията са в обявата и сделката.</small></div><a href="/deals">Сделка</a></div>

    <div class="message-stream" aria-live="polite">
      <div class="date-divider"><span>Днес</span></div>
      {#each localMessages as message (message.id)}
        <div class:mine={message.sender.id === data.viewerId} class="message"><p>{message.body ?? 'Съобщението е изтрито.'}</p><span>{time(message.createdAt)} {#if message.editedAt}· редактирано{/if} {#if message.sender.id === data.viewerId}<CheckCheck size={14} />{/if}</span></div>
      {/each}
    </div>

    {#if conversationBlocked}
      <p class="blocked-notice" role="status">Контактът е блокиран. Нови съобщения не могат да бъдат изпращани.</p>
    {/if}

    <form class="composer" method="POST" action="?/send" use:enhance={enhanceSend}>
      <input type="hidden" name="conversationId" value={activeConversation.id} />
      <button type="button" aria-label="Снимките в чат предстоят" disabled><ImagePlus size={20} /></button>
      <button type="button" aria-label="Файловете в чат предстоят" disabled><Paperclip size={19} /></button>
      <label><span class="sr-only">Съобщение</span><textarea name="body" bind:value={text} rows="1" maxlength="4000" required disabled={conversationBlocked} placeholder={conversationBlocked ? 'Контактът е блокиран' : 'Напиши съобщение...'}></textarea></label>
      <button class="send" type="submit" aria-label="Изпрати" disabled={activeConversation.status !== 'open' || conversationBlocked}><Send size={19} /></button>
    </form>
    <p class="chat-disclaimer">Не изпращай картови данни или кодове за потвърждение. Плащането е извън платформата.</p>
  </div>
  {:else}
    <div class="chat empty-chat surface"><MessageCircle size={38} /><h2>Няма отключен разговор</h2><p>Чатът се създава автоматично, когато продавачът приеме структурирана оферта.</p><a class="button primary" href="/listings">Разгледай обявите</a></div>
  {/if}
</section>

<style>
  .messages-shell {
    display: grid;
    height: calc(100vh - var(--header-height) - 58px);
    height: calc(100dvh - var(--header-height) - 58px);
    min-height: 610px;
    grid-template-columns: 330px minmax(0, 1fr);
    gap: 14px;
    padding-block: 14px 18px;
    font-family: inherit;
  }

  .conversation-list,
  .chat {
    min-height: 0;
    overflow: hidden;
    border-color: var(--line-strong);
    background: var(--paper-strong);
    box-shadow: none;
  }

  .conversation-list {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
  }

  .list-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    padding: 20px 20px 12px;
  }

  .list-head .eyebrow {
    margin-bottom: 4px;
  }

  .list-head h1 {
    margin: 0;
    font-size: 2rem;
  }

  .list-head > button,
  .chat-head > button,
  .chat-head > a,
  .chat-head > form > button,
  .composer > button {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    font: inherit;
  }

  .list-head > button:hover,
  .chat-head > button:hover,
  .chat-head > a:hover,
  .chat-head > form > button:hover,
  .composer > button:hover {
    background: var(--brand-tertiary);
  }

  .chat-search {
    display: grid;
    min-height: 46px;
    align-items: center;
    grid-template-columns: 20px 1fr;
    gap: 8px;
    margin: 0 14px 10px;
    padding: 7px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--paper-strong);
  }

  .chat-search input {
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
  }

  .conversation-items {
    overflow-y: auto;
  }

  .empty-conversations {
    padding: 22px;
    color: var(--ink-soft);
    font-size: .78rem;
  }

  .conversation-items > button {
    display: grid;
    width: 100%;
    min-height: 88px;
    align-items: center;
    grid-template-columns: 44px 1fr auto;
    gap: 10px;
    padding: 13px 16px;
    border: 0;
    border-top: 1px solid rgb(138 121 103 / 18%);
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .conversation-items > button:hover,
  .conversation-items > button.active {
    background: var(--brand-main);
  }

  .avatar {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 50%;
    color: var(--paper-strong);
    background: var(--action);
    font-weight: 700;
  }

  .conversation-copy,
  .conversation-meta {
    display: grid;
    min-width: 0;
  }

  .conversation-copy strong {
    font-size: 0.8rem;
  }

  .conversation-copy small {
    overflow: hidden;
    color: var(--ink-faint);
    font-size: 0.63rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-copy > span {
    overflow: hidden;
    color: var(--ink-soft);
    font-size: 0.7rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-meta {
    justify-items: end;
    gap: 10px;
  }

  .conversation-meta time {
    color: var(--ink-faint);
    font-size: 0.58rem;
  }

  .conversation-meta b {
    display: grid;
    min-width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 50%;
    color: white;
    background: var(--action);
    font-size: 0.58rem;
  }

  .privacy {
    display: grid;
    align-items: start;
    grid-template-columns: 18px 1fr;
    gap: 8px;
    padding: 14px;
    border-top: 1px solid var(--line);
    color: var(--success);
  }

  .privacy p {
    margin: 0;
    font-size: 0.64rem;
  }

  .chat {
    display: grid;
    grid-template-rows: auto auto 1fr auto auto;
  }

  .chat-head {
    display: grid;
    min-height: 72px;
    align-items: center;
    grid-template-columns: 44px 1fr auto 44px;
    gap: 9px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }

  .chat-head .back {
    display: none;
  }

  .chat-head > div {
    display: grid;
  }

  .chat-head > div span {
    color: var(--ink-faint);
    font-size: 0.63rem;
  }

  .chat-head > form {
    margin: 0;
  }

  .blocked-chip {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    gap: 5px;
    padding-inline: 9px;
    border-radius: 999px;
    color: var(--danger);
    background: var(--danger-soft);
    font-size: .64rem;
    font-weight: 700;
  }

  .listing-context {
    display: grid;
    min-height: 70px;
    align-items: center;
    grid-template-columns: 43px 1fr auto;
    gap: 11px;
    padding: 8px 17px;
    border-bottom: 1px solid var(--line);
    background: var(--brand-main);
  }

  .bottle-mini {
    display: grid;
    height: 50px;
    place-items: end center;
    border-radius: 7px;
    background: #d7d8d5;
  }

  .bottle-mini span {
    width: 24px;
    height: 39px;
    border-radius: 5px 5px 2px 2px;
    background: #263743;
  }

  .listing-context > div:nth-child(2) {
    display: grid;
  }

  .listing-context span,
  .listing-context small {
    color: var(--ink-faint);
    font-size: 0.62rem;
  }

  .listing-context a {
    font-size: 0.7rem;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .message-stream {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px;
    overflow-y: auto;
    background: var(--paper);
  }

  .date-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--ink-faint);
    font-size: 0.62rem;
  }

  .date-divider::before,
  .date-divider::after {
    height: 1px;
    flex: 1;
    background: var(--line);
    content: '';
  }

  .message {
    max-width: min(76%, 540px);
    align-self: flex-start;
    padding: 11px 13px 7px;
    border: 1px solid var(--line);
    border-radius: 5px 16px 16px 16px;
    background: var(--paper-strong);
  }

  .message.mine {
    align-self: flex-end;
    border-color: rgb(74 49 38 / 20%);
    border-radius: 16px 5px 16px 16px;
    background: var(--brand-main);
  }

  .message p {
    margin: 0;
    font-size: 0.82rem;
  }

  .message span {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 3px;
    color: var(--ink-faint);
    font-size: 0.57rem;
  }

  .composer {
    display: grid;
    align-items: end;
    grid-template-columns: 44px 44px 1fr 48px;
    gap: 5px;
    padding: 10px 13px;
    border-top: 1px solid var(--line);
    background: var(--paper-strong);
  }

  .blocked-notice {
    margin: 0;
    padding: 9px 15px;
    border-top: 1px solid var(--line);
    color: var(--danger);
    background: var(--danger-soft);
    font-size: .7rem;
    text-align: center;
  }

  .composer label {
    min-width: 0;
  }

  .composer textarea {
    width: 100%;
    min-height: 44px;
    max-height: 130px;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 22px;
    outline: 0;
    resize: none;
    background: var(--brand-secondary);
    font: inherit;
  }

  .composer .send {
    width: 48px;
    height: 48px;
    color: var(--paper-strong);
    background: var(--action);
  }

  .chat-disclaimer {
    margin: 0;
    padding: 4px 15px 8px;
    color: var(--ink-faint);
    background: var(--paper-strong);
    font-size: 0.58rem;
    text-align: center;
  }

  .composer button:disabled {
    cursor: not-allowed;
    opacity: .38;
  }

  .empty-chat {
    display: grid;
    min-height: 520px;
    place-items: center;
    align-content: center;
    gap: 10px;
    padding: 30px;
    color: var(--ink-soft);
    text-align: center;
  }

  .empty-chat h2,
  .empty-chat p { margin: 0; }

  .empty-chat p { max-width: 430px; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  @media (max-width: 800px) {
    .messages-shell {
      height: calc(100vh - var(--header-height) - 58px);
      height: calc(100dvh - var(--header-height) - 58px);
      min-height: 560px;
      grid-template-columns: 1fr;
      width: 100%;
      padding: 0;
    }

    .conversation-list,
    .chat {
      border: 0;
      border-radius: 0;
    }

    .conversation-list.mobile-hidden {
      display: none;
    }

    .chat {
      display: none;
    }

    .chat.mobile-visible {
      display: grid;
    }

    .chat-head {
      grid-template-columns: 44px 44px 1fr auto 44px;
    }

    .chat-head .back {
      display: grid;
    }

    .chat-head > button:last-child {
      display: none;
    }
  }
</style>
