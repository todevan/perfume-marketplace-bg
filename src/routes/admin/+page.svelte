<script lang="ts">
  import {
    AlertTriangle,
    BadgeCheck,
    Check,
    ChevronRight,
    Clock3,
    Flag,
    LayoutDashboard,
    ShieldAlert,
    UserRound,
    X
  } from '@lucide/svelte';

  let { data, form } = $props();

  function elapsed(createdAt: string): string {
    const milliseconds = Math.max(0, Date.parse(data.generatedAt) - Date.parse(createdAt));
    const minutes = Math.floor(milliseconds / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)} мин.`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} ч.`;
    return `${Math.floor(hours / 24)} дни`;
  }

  function timestamp(value: string): string {
    return new Intl.DateTimeFormat('bg-BG', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Sofia'
    }).format(new Date(value));
  }

  function inspectedMessages(value: unknown, caseId: string): readonly {
    id: string;
    senderId: string;
    body: string | null;
    createdAt: string;
  }[] {
    if (!value || typeof value !== 'object') return [];
    const result = value as Record<string, unknown>;
    if (result.action !== 'inspect' || result.caseId !== caseId || !Array.isArray(result.messages)) {
      return [];
    }
    return result.messages.filter((message): message is {
      id: string;
      senderId: string;
      body: string | null;
      createdAt: string;
    } => Boolean(
      message &&
      typeof message === 'object' &&
      typeof message.id === 'string' &&
      typeof message.senderId === 'string' &&
      (typeof message.body === 'string' || message.body === null) &&
      typeof message.createdAt === 'string'
    ));
  }

  function actionFeedback(value: unknown): { kind: 'success' | 'error'; message: string } | null {
    if (!value || typeof value !== 'object') return null;
    const result = value as Record<string, unknown>;
    if (result.ok === false && typeof result.message === 'string') {
      return { kind: 'error', message: result.message };
    }
    if (result.ok === true && result.action === 'assign') {
      return { kind: 'success', message: 'Сигналът е присвоен и е в активно разследване.' };
    }
    if (result.ok === true && result.action === 'decide') {
      return { kind: 'success', message: 'Решението и audit записът са съхранени.' };
    }

    if (result.ok === true && result.action === 'merchant') {
      return { kind: 'success', message: 'Търговската кандидатура е обновена чрез защитения review RPC.' };
    }
    return null;
  }

  let feedback = $derived(actionFeedback(form));
</script>

<svelte:head><title>Модерация · Admin beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<div class="admin-shell">
  <aside class="admin-nav">
    <div class="admin-mark"><ShieldAlert size={25} /><span>ADMIN<small>protected operations</small></span></div>
    <nav aria-label="Администрация">
      <a class="active" href="/admin"><LayoutDashboard size={18} /> <span>Преглед</span></a>
      <a href="/admin"><Flag size={18} /> <span>Сигнали</span> <b>{data.stats.total}</b></a>
    </nav>
    <div class="admin-user"><div>{data.actor.role === 'admin' ? 'AD' : 'MO'}</div><span><strong>@{data.actor.username}</strong><small>{data.actor.role}</small></span></div>
  </aside>

  <section class="admin-main" aria-label="Модерационен център">
    <header>
      <div><span>Защитена сесия · AAL2</span><h1>Модерационен център</h1></div>
      <div class="session-chip"><BadgeCheck size={18} /><span>{data.actor.role}</span></div>
    </header>

    {#if feedback}
      <div class:success={feedback.kind === 'success'} class:error={feedback.kind === 'error'} class="action-feedback" role={feedback.kind === 'error' ? 'alert' : 'status'}>
        {feedback.message}
      </div>
    {/if}

    <section class="admin-stats" aria-label="Състояние на опашката">
      <article><span>Отворени сигнали</span><strong>{data.stats.open}</strong><small class="danger">{data.stats.highRisk} висок риск</small></article>
      <article><span>В разследване</span><strong>{data.stats.investigating}</strong><small class="success">с присвоен staff actor</small></article>
      <article><span>В текущата опашка</span><strong>{data.stats.total}</strong><small>до 50 най-стари случая</small></article>
      <article><span>Търговски кандидатури</span><strong>{data.stats.merchantPending}</strong><small>submitted / under review</small></article>
    </section>


    {#if data.merchantApplications.length > 0}
      <section class="merchant-panel" aria-labelledby="merchant-title">
        <div class="merchant-heading"><div><UserRound size={20} /><div><h2 id="merchant-title">Търговски кандидатури</h2><p>Решенията минават само през review_merchant_application RPC.</p></div></div><span>{data.merchantApplications.length}</span></div>
        <div class="merchant-grid">
          {#each data.merchantApplications as application}
            <article>
              <header><div><small>@{application.applicant}</small><h3>{application.legalName}</h3></div><span>{application.status}</span></header>
              <dl><div><dt>ЕИК / регистрация</dt><dd>{application.registrationNumber}</dd></div><div><dt>Адрес</dt><dd>{application.registeredAddress}</dd></div></dl>
              <div class="document-links">
                {#each application.documents as document}
                  <a href={document.url} target="_blank" rel="noreferrer">{document.label}</a>
                {:else}
                  <span>Няма приложени документи</span>
                {/each}
                {#if application.websiteUrl}<a href={application.websiteUrl} target="_blank" rel="noreferrer">Уебсайт</a>{/if}
              </div>
              {#if application.canClaim}
                <form method="POST" action="?/merchant">
                  <input type="hidden" name="applicationId" value={application.id} />
                  <button class="button primary" type="submit" name="decision" value="claim">Поеми проверката</button>
                </form>
              {:else if application.canDecide}
                <form class="merchant-decision" method="POST" action="?/merchant">
                  <input type="hidden" name="applicationId" value={application.id} />
                  <label><span>Бележки към решението</span><textarea name="notes" minlength="2" maxlength="4000" required></textarea></label>
                  <div><button class="approve" type="submit" name="decision" value="approve">Одобри</button><button class="remove" type="submit" name="decision" value="reject">Откажи</button></div>
                </form>
              {:else}
                <p class="locked-note">Кандидатурата е присвоена на друг reviewer.</p>
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/if}

    <section class="workbench">
      <div class="case-list">
        <div class="panel-head"><div><Flag size={18} /><strong>Активни сигнали</strong></div><a class="panel-control" href="/admin" aria-label="Обнови опашката"><Clock3 size={18} /></a></div>
        {#each data.cases as item}
          <a class:active={data.selected?.id === item.id} href={`/admin?case=${encodeURIComponent(item.id)}`}><span class:risk-high={item.risk === 'high'} class="risk-dot"></span><div><small>{item.reference} · {elapsed(item.createdAt)}</small><strong>{item.reason}</strong><span>{item.targetTitle}</span></div><ChevronRight size={17} /></a>
        {:else}
          <p class="empty-list">Няма активни сигнали за обяви.</p>
        {/each}
      </div>

      <article class="case-detail">
        {#if data.selected}
          <div class="case-head"><div><span>{data.selected.reference}</span><h2>{data.selected.reason}</h2><p>{data.selected.targetTitle}</p></div><span class:risk-high={data.selected.risk === 'high'} class="risk-pill">{data.selected.risk === 'high' ? 'Висок' : 'Среден'} риск</span></div>
          <div class="evidence-strip">
            {#each data.selected.evidence as evidence}
              <div><img src={evidence.url} alt={evidence.label} loading="lazy" /><small>{evidence.label}</small></div>
            {:else}
              <div class="no-evidence"><AlertTriangle size={24} /><small>Няма приложени снимки</small></div>
            {/each}
          </div>
          <dl><div><dt>Подател</dt><dd>@{data.selected.reporter}</dd></div><div><dt>Тип цел</dt><dd>{data.selected.targetType}</dd></div><div><dt>Основание</dt><dd>{data.selected.details ?? 'Подателят не е добавил допълнителни подробности.'}</dd></div><div><dt>Статус на целта</dt><dd>{data.selected.targetStatus}</dd></div><div><dt>Workflow</dt><dd>{data.selected.status === 'open' ? 'Чака присвояване' : 'Активно разследване'}</dd></div></dl>

          {#if data.selected.canClaim}
            <div class="moderation-note"><AlertTriangle size={19} /><p>Преди достъп до решение случаят трябва да бъде присвоен. Преходът към investigating създава append-only audit запис.</p></div>
            <form method="POST" action="?/assign">
              <input type="hidden" name="caseId" value={data.selected.id} />
              <button class="button primary claim-button" type="submit"><Check size={17} /> Поеми случая</button>
            </form>
          {:else if data.selected.canDecide}
            {#if data.selected.targetType === 'conversation' || data.selected.targetType === 'message'}
              <form method="POST" action="?/inspect">
                <input type="hidden" name="caseId" value={data.selected.id} />
                <button class="button secondary claim-button" type="submit">Прегледай одитираната кореспонденция</button>
              </form>
              {@const messages = inspectedMessages(form, data.selected.id)}
              {#if messages.length}
                <ol class="message-evidence" aria-label="Одитирана кореспонденция">
                  {#each messages as message}
                    <li>
                      <small>{timestamp(message.createdAt)} · {message.senderId.slice(0, 8)}</small>
                      <p>{message.body ?? '[премахнато съобщение]'}</p>
                    </li>
                  {/each}
                </ol>
              {/if}
            {/if}
            <form method="POST" action="?/decide" class="decision-form">
              <input type="hidden" name="caseId" value={data.selected.id} />
              <label class="decision-note"><span>Мотиви към решението</span><textarea name="rationale" minlength="10" maxlength="4000" required placeholder="Опиши конкретните факти и приложеното правило..."></textarea></label>
              <div class="decision-actions">
                {#if data.selected.targetType === 'listing'}
                  <button class="approve" type="submit" name="decision" value="keep"><Check size={17} /> Остави активна</button>
                  <button class="request" type="submit" name="decision" value="hide"><Clock3 size={17} /> Скрий временно</button>
                  <button class="remove" type="submit" name="decision" value="remove"><X size={17} /> Премахни</button>
                {:else if data.selected.targetType === 'profile'}
                  <button class="approve" type="submit" name="decision" value="restore"><Check size={17} /> Възстанови профила</button>
                  <button class="remove" type="submit" name="decision" value="suspend"><X size={17} /> Спри профила</button>
                {:else if data.selected.targetType === 'review' || data.selected.targetType === 'profile_comment'}
                  <button class="approve" type="submit" name="decision" value="publish"><Check size={17} /> Публикувай</button>
                  <button class="request" type="submit" name="decision" value="hide"><Clock3 size={17} /> Скрий</button>
                  <button class="remove" type="submit" name="decision" value="remove"><X size={17} /> Премахни</button>
                {:else if data.selected.targetType === 'deal'}
                  <button class="approve" type="submit" name="decision" value="resume"><Check size={17} /> Върни за потвърждение</button>
                  <button class="remove" type="submit" name="decision" value="cancel"><X size={17} /> Отмени сделката</button>
                {:else if data.selected.targetType === 'message'}
                  <button class="approve" type="submit" name="decision" value="keep"><Check size={17} /> Без нарушение</button>
                  <button class="remove" type="submit" name="decision" value="remove"><X size={17} /> Премахни съобщението</button>
                {:else if data.selected.targetType === 'conversation'}
                  <button class="approve" type="submit" name="decision" value="keep"><Check size={17} /> Без нарушение</button>
                  <button class="remove" type="submit" name="decision" value="hide"><X size={17} /> Блокирай разговора</button>
                {/if}
              </div>
            </form>
          {:else if !data.selected.supported}
            <div class="moderation-note"><AlertTriangle size={19} /><p>Този тип сигнал няма безопасен report-bound decision RPC. Случаят остава отворен без директна промяна на целевата таблица.</p></div>
          {:else}
            <div class="moderation-note"><AlertTriangle size={19} /><p>Случаят е присвоен на друг модератор. Само назначеният модератор или администратор може да приложи report-bound решение.</p></div>
          {/if}
        {:else}
          <div class="resolved"><div><Check size={30} /></div><h2>Опашката е празна.</h2><p>Няма отворени или разследвани сигнали за обяви.</p><a class="button primary" href="/admin">Обнови</a></div>
        {/if}
      </article>

      <aside class="audit-panel"><div class="panel-head"><div><BadgeCheck size={18} /><strong>Audit trail</strong></div></div>{#if data.selected}<ol><li><span></span><div><strong>Сигналът е подаден</strong><small>{timestamp(data.selected.createdAt)}</small></div></li>{#each data.audit as entry, index}<li><span class:current={index === data.audit.length - 1}></span><div><strong>{entry.action}</strong><small>@{entry.actor} · {timestamp(entry.createdAt)}</small><p>{entry.rationale}</p></div></li>{/each}</ol><div class="sla"><Clock3 size={17} /><div><span>Текущ статус</span><strong>{data.selected.status}</strong></div></div>{:else}<p class="empty-audit">Няма избран случай.</p>{/if}</aside>
    </section>
  </section>
</div>

<style>
  .message-evidence {
    display: grid;
    max-height: 360px;
    gap: .55rem;
    margin: 1rem 0;
    padding: .75rem;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--paper-strong);
  }

  .message-evidence li {
    padding: .65rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-xs);
  }

  .message-evidence small {
    color: var(--ink-faint);
  }

  .message-evidence p {
    margin: .35rem 0 0;
    white-space: pre-wrap;
  }

  :global(.site-header),
  :global(.footer) {
    display: none;
  }

  .admin-shell {
    display: grid;
    min-height: 100vh;
    grid-template-columns: 230px minmax(0, 1fr);
    color: #28231f;
    background: #eeeae4;
  }

  .admin-nav {
    position: sticky;
    top: 0;
    display: grid;
    height: 100vh;
    grid-template-rows: auto 1fr auto;
    color: #f1ece5;
    background: #26211d;
  }

  .admin-mark {
    display: flex;
    min-height: 76px;
    align-items: center;
    gap: 10px;
    padding: 18px;
    border-bottom: 1px solid rgb(255 255 255 / 12%);
  }

  .admin-mark > span,
  .admin-user > span {
    display: grid;
    font-size: .72rem;
    font-weight: 700;
    letter-spacing: .11em;
  }

  .admin-mark small,
  .admin-user small {
    color: rgb(255 255 255 / 42%);
    font-size: .55rem;
    font-weight: 400;
    letter-spacing: .02em;
  }

  .admin-nav nav {
    display: grid;
    align-content: start;
    gap: 4px;
    padding: 14px 10px;
  }

  .admin-nav nav a {
    display: grid;
    min-height: 44px;
    align-items: center;
    grid-template-columns: 22px 1fr auto;
    gap: 8px;
    padding: 10px;
    border-radius: 7px;
    color: rgb(255 255 255 / 58%);
    font-size: .73rem;
  }

  .admin-nav nav a:hover,
  .admin-nav nav a.active {
    color: white;
    background: rgb(255 255 255 / 9%);
  }

  .admin-nav nav b {
    display: grid;
    min-width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 50%;
    color: #26211d;
    background: #f3dfbf;
    font-size: .57rem;
  }

  .admin-user {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 15px;
    border-top: 1px solid rgb(255 255 255 / 12%);
  }

  .admin-user > div {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 7px;
    color: #26211d;
    background: #f3dfbf;
    font-size: .67rem;
    font-weight: 700;
  }

  .admin-main {
    min-width: 0;
    padding: 30px;
  }

  .admin-main > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 25px;
  }

  .admin-main header span {
    color: #7d7167;
    font-size: .62rem;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 5px 0 0;
    font-size: 2.4rem;
    font-style: normal;
    letter-spacing: -.04em;
  }

  .session-chip {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 7px;
    padding: 8px 13px;
    border: 1px solid #b9cfc2;
    border-radius: 999px;
    color: #2f6b4f;
    background: #eef5f0;
  }

  .action-feedback {
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid;
    border-radius: 8px;
    font-size: .73rem;
    font-weight: 700;
  }

  .action-feedback.success {
    border-color: #9dbbaa;
    color: #2f6b4f;
    background: #eef5f0;
  }

  .action-feedback.error {
    border-color: #d4a5aa;
    color: #8d2f36;
    background: #f8e9ea;
  }

  .admin-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-block: 26px;
  }

  .admin-stats article {
    display: grid;
    min-height: 120px;
    padding: 16px;
    border: 1px solid #d5cdc4;
    border-radius: 9px;
    background: #f9f7f3;
  }

  .admin-stats article > span,
  .admin-stats small {
    color: #7d7167;
    font-size: .65rem;
  }

  .admin-stats strong {
    align-self: end;
    font-size: 1.65rem;
  }

  .admin-stats .danger {
    color: #a53b43;
  }

  .admin-stats .success {
    color: #2f6b4f;
  }


  .merchant-panel {
    margin-bottom: 18px;
    border: 1px solid #d0c8bf;
    border-radius: 9px;
    background: #f9f7f3;
  }

  .merchant-heading {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid #d8d1c8;
  }

  .merchant-heading > div {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .merchant-heading h2,
  .merchant-heading p {
    margin: 0;
  }

  .merchant-heading h2 {
    font-size: .9rem;
    font-style: normal;
  }

  .merchant-heading p,
  .locked-note {
    margin-top: 3px;
    color: #7d7167;
    font-size: .62rem;
  }

  .merchant-heading > span {
    display: grid;
    min-width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 50%;
    color: #f9f7f3;
    background: #4a3126;
    font-size: .65rem;
    font-weight: 700;
  }

  .merchant-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .merchant-grid > article {
    padding: 16px;
    border-right: 1px solid #d8d1c8;
    border-bottom: 1px solid #d8d1c8;
  }

  .merchant-grid > article header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .merchant-grid h3 {
    margin: 3px 0 0;
    font-size: .88rem;
  }

  .merchant-grid header small,
  .merchant-grid header > span {
    color: #7d7167;
    font-size: .6rem;
  }

  .merchant-grid header > span {
    padding: 4px 7px;
    border-radius: 999px;
    background: #eee8e0;
  }

  .merchant-grid dl {
    margin-block: 12px;
  }

  .merchant-grid dl div {
    grid-template-columns: 120px 1fr;
    font-size: .65rem;
  }

  .document-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 13px;
  }

  .document-links a,
  .document-links span {
    min-height: 32px;
    padding: 7px 9px;
    border: 1px solid #cfc6bd;
    border-radius: 6px;
    color: #4a3126;
    font-size: .6rem;
  }

  .merchant-grid form > button {
    min-height: 44px;
  }

  .merchant-decision,
  .merchant-decision label {
    display: grid;
    gap: 7px;
  }

  .merchant-decision label span {
    color: #6f635a;
    font-size: .62rem;
    font-weight: 700;
  }

  .merchant-decision textarea {
    min-height: 70px;
    padding: 9px;
    border: 1px solid #cfc6bd;
    border-radius: 7px;
    resize: vertical;
  }

  .merchant-decision > div {
    display: flex;
    gap: 7px;
  }

  .merchant-decision button {
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid;
    border-radius: 7px;
    background: white;
    font-size: .65rem;
    font-weight: 700;
  }

  .workbench {
    display: grid;
    min-height: 620px;
    grid-template-columns: 250px minmax(420px, 1fr) 240px;
    overflow: hidden;
    border: 1px solid #d0c8bf;
    border-radius: 10px;
    background: #f9f7f3;
  }

  .case-list,
  .audit-panel {
    background: #f2eee8;
  }

  .case-list {
    border-right: 1px solid #d0c8bf;
  }

  .audit-panel {
    border-left: 1px solid #d0c8bf;
  }

  .panel-head {
    display: flex;
    min-height: 55px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 15px;
    border-bottom: 1px solid #d0c8bf;
  }

  .panel-head > div {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: .73rem;
  }

  .panel-head .panel-control {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 50%;
    color: #6f635a;
  }

  .case-list > a {
    display: grid;
    width: 100%;
    min-height: 98px;
    align-items: start;
    grid-template-columns: 8px 1fr 18px;
    gap: 9px;
    padding: 15px;
    border-bottom: 1px solid #d8d1c8;
    color: #28231f;
    text-align: left;
  }

  .case-list > a.active {
    color: #751d2b;
    background: #f4ece1;
  }

  .risk-dot {
    width: 7px;
    height: 7px;
    margin-top: 5px;
    border-radius: 50%;
    background: #b07c2f;
  }

  .risk-dot.risk-high {
    background: #a53b43;
  }

  .case-list a > div {
    display: grid;
  }

  .empty-list,
  .empty-audit {
    margin: 0;
    padding: 20px 15px;
    color: #7d7167;
    font-size: .68rem;
  }

  .case-list small,
  .case-list span {
    color: #8a7f75;
    font-size: .6rem;
  }

  .case-list strong {
    margin-block: 5px 2px;
    font-size: .74rem;
  }

  .case-detail {
    padding: 24px;
    overflow-y: auto;
  }

  .case-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 18px;
  }

  .case-head span {
    color: #8a7f75;
    font-size: .62rem;
  }

  .case-head h2 {
    margin: 4px 0;
    font-size: 1.7rem;
    font-style: normal;
  }

  .case-head p {
    color: #6f635a;
    font-size: .78rem;
  }

  .risk-pill {
    padding: 5px 9px;
    border-radius: 999px;
    color: #8a5b16 !important;
    background: #f5ead7;
    font-weight: 700;
    white-space: nowrap;
  }

  .risk-pill.risk-high {
    color: #8d2f36 !important;
    background: #f4e1e3;
  }

  .evidence-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 7px;
    margin-block: 20px;
  }

  .evidence-strip > div {
    display: grid;
    min-height: 115px;
    align-content: end;
    place-items: center;
    gap: 7px;
    padding: 10px;
    border: 1px solid #d8d0c7;
    border-radius: 7px;
    background: #eee8e0;
  }

  .evidence-strip img {
    width: 100%;
    height: 82px;
    border-radius: 5px;
    object-fit: contain;
  }

  .evidence-strip .no-evidence {
    grid-column: 1 / -1;
    align-content: center;
    color: #7d7167;
  }

  .evidence-strip small {
    color: #6f635a;
    font-size: .56rem;
  }

  dl {
    border-top: 1px solid #d8d0c7;
  }

  dl div {
    display: grid;
    grid-template-columns: 130px 1fr;
    padding-block: 10px;
    border-bottom: 1px solid #d8d0c7;
    font-size: .7rem;
  }

  dt {
    color: #7d7167;
  }

  dd {
    margin: 0;
  }

  .moderation-note {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 8px;
    margin-block: 15px;
    padding: 12px;
    border: 1px solid #d9bf93;
    border-radius: 7px;
    color: #8a5b16;
    background: #faf1e2;
  }

  .moderation-note p {
    margin: 0;
    font-size: .66rem;
  }

  .decision-note {
    display: grid;
    gap: 7px;
    color: #6f635a;
    font-size: .66rem;
    font-weight: 700;
  }

  .decision-note textarea {
    min-height: 84px;
    padding: 10px;
    border: 1px solid #cfc6bd;
    border-radius: 7px;
    resize: vertical;
  }

  .decision-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 13px;
  }

  .decision-form {
    margin-top: 18px;
  }

  .claim-button {
    min-height: 44px;
  }

  .decision-actions button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid;
    border-radius: 7px;
    background: white;
    cursor: pointer;
    font-size: .65rem;
    font-weight: 700;
  }

  .approve { color: #2f6b4f; border-color: #7aa68f !important; }
  .request { color: #8a5b16; border-color: #caa56e !important; }
  .remove { color: white; border-color: #8d2f36 !important; background: #8d2f36 !important; }

  .audit-panel ol {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 18px;
    list-style: none;
  }

  .audit-panel li {
    display: grid;
    min-height: 70px;
    grid-template-columns: 16px 1fr;
    gap: 8px;
  }

  .audit-panel li > span {
    position: relative;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border: 2px solid #8a7967;
    border-radius: 50%;
    background: #f2eee8;
  }

  .audit-panel li > span::after {
    position: absolute;
    top: 8px;
    left: 2px;
    width: 1px;
    height: 55px;
    background: #c9c0b7;
    content: '';
  }

  .audit-panel li:last-child > span::after {
    display: none;
  }

  .audit-panel li > span.current {
    border-color: #4a3126;
    background: #4a3126;
  }

  .audit-panel li div {
    display: grid;
    align-content: start;
  }

  .audit-panel li strong {
    font-size: .68rem;
  }

  .audit-panel li small {
    color: #8a7f75;
    font-size: .58rem;
  }

  .audit-panel li p {
    margin: 3px 0 0;
    color: #6f635a;
    font-size: .58rem;
    line-height: 1.4;
  }

  .sla {
    display: grid;
    align-items: center;
    grid-template-columns: 20px 1fr;
    gap: 8px;
    margin: 8px 15px;
    padding: 12px;
    border: 1px solid #d0c8bf;
    border-radius: 7px;
    background: white;
  }

  .sla div {
    display: grid;
  }

  .sla span {
    color: #7d7167;
    font-size: .57rem;
  }

  .sla strong {
    font-size: .72rem;
  }

  .resolved {
    display: grid;
    min-height: 470px;
    place-items: center;
    align-content: center;
    text-align: center;
  }

  .resolved > div {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 50%;
    color: white;
    background: #2f6b4f;
  }

  .resolved h2 {
    margin: 18px 0 8px;
    font-style: normal;
  }

  .resolved p {
    max-width: 450px;
    color: #6f635a;
    font-size: .73rem;
  }


  @media (max-width: 1150px) {
    .workbench {
      grid-template-columns: 230px minmax(420px, 1fr);
    }

    .audit-panel {
      display: none;
    }
  }

  @media (max-width: 850px) {
    .admin-shell {
      grid-template-columns: 72px minmax(0, 1fr);
    }

    .admin-mark span,
    .admin-nav nav a span,
    .admin-user span,
    .admin-nav nav b {
      display: none;
    }

    .admin-nav nav a {
      grid-template-columns: 1fr;
      justify-items: center;
    }

    .admin-main {
      padding: 18px;
    }

    .admin-stats {
      grid-template-columns: repeat(2, 1fr);
    }

    .workbench {
      grid-template-columns: 1fr;
    }

    .case-list {
      display: none;
    }


    .merchant-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 560px) {
    .evidence-strip {
      grid-template-columns: repeat(2, 1fr);
    }

  }
</style>
