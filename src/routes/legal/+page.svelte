<script lang="ts">
  import { ArrowRight, Check, FileText, Gavel, LockKeyhole, Scale, ShieldCheck, TriangleAlert } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Правни документи · Beta</title>
  <meta name="description" content="Работни чернови на условията и политиката за поверителност на marketplace beta." />
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="legal-hero">
  <div class="container hero-grid">
    <div class="hero-copy reveal">
      <span class="draft-pill"><TriangleAlert size={16} /> Работна чернова · не е правен документ</span>
      <h1>Правната рамка е <em>част от продукта.</em></h1>
      <p>Тези страници показват планираната структура на документите за затворената beta. Те не са одобрени за публичен launch и не следва да се приемат от реални потребители.</p>
    </div>
    <div class="legal-mark reveal" style="animation-delay: 120ms" aria-hidden="true"><span>LEGAL</span><Scale size={66} strokeWidth={1.1} /><strong>DRAFT / 01</strong><i>за преглед от адвокат</i></div>
  </div>
</section>

<section class="section documents">
  <div class="container">
    <div class="section-heading"><div><span class="eyebrow">Работни документи</span><h2>Структура за преглед, не финален текст.</h2></div><p>Полетата за фирма, контакт, срокове и доставчици остават отворени до фирмено и правно решение.</p></div>
    <div class="document-grid">
      <a class="document-card terms" href="/legal/terms"><div class="doc-index">01 / TERMS</div><div class="doc-icon"><Gavel size={30} /></div><h2>Условия за използване</h2><p>Роля на платформата, профили, обяви, оферти, модерация, такси и обжалване.</p><span>Отвори черновата <ArrowRight size={17} /></span></a>
      <a class="document-card privacy" href="/legal/privacy"><div class="doc-index">02 / PRIVACY</div><div class="doc-icon"><LockKeyhole size={30} /></div><h2>Политика за поверителност</h2><p>Категории данни, цели, правни основания, срокове, получатели, права и канали за контакт.</p><span>Отвори черновата <ArrowRight size={17} /></span></a>
      <a class="document-card safety" href="/legal/rules"><div class="doc-index">03 / RULES</div><div class="doc-icon"><ShieldCheck size={30} /></div><h2>Правила на marketplace</h2><p>Разрешени стоки, доказателства, поведение, сигнали и последици при нарушение.</p><span>Към правилата <ArrowRight size={17} /></span></a>
    </div>
  </div>
</section>

<section class="section launch-gates">
  <div class="container gate-grid">
    <div><span class="eyebrow">Преди публичен launch</span><h2>Документите имат външни зависимости.</h2><p>Платените функции и публичното отваряне не трябва да се активират, преди тези точки да са затворени.</p></div>
    <ol>
      <li><span>01</span><Check size={18} /><div><strong>Българско дружество и администратор</strong><p>Фирмени данни, адрес, контакт и отговорно лице.</p></div></li>
      <li><span>02</span><Check size={18} /><div><strong>Правен преглед в България</strong><p>DSA, GPSR, GDPR, търговци/частни лица, DAC7 и спецификата на тестерите и мострите.</p></div></li>
      <li><span>03</span><Check size={18} /><div><strong>Счетоводен и платежен преглед</strong><p>Таксата от €1,99, абонаментите, фактурирането, refund и myPOS процесът.</p></div></li>
      <li><span>04</span><Check size={18} /><div><strong>Технически процеси и контакти</strong><p>Срокове за изтриване, получатели, искания на субекти и notice-and-action.</p></div></li>
    </ol>
  </div>
</section>

<section class="draft-footer"><div class="container"><FileText size={23} /><div><strong>Статус: неодобрена чернова</strong><p>Текстовете са продуктова основа и изискват преглед от квалифициран български адвокат.</p></div></div></section>

<style>
  .legal-hero { overflow: hidden; border-bottom: 1px solid var(--line); }
  .hero-grid { display: grid; min-height: 610px; align-items: center; grid-template-columns: 1.1fr .55fr; gap: clamp(55px, 8vw, 120px); padding-block: 70px; }
  .draft-pill { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 22px; padding: 7px 11px; border: 1px solid rgb(141 47 54 / 32%); border-radius: 999px; color: var(--danger); background: rgb(141 47 54 / 6%); font-size: .68rem; font-weight: 700; }
  .hero-copy h1 { max-width: 800px; }
  .hero-copy h1 em { display: block; color: var(--action); }
  .hero-copy > p { max-width: 700px; color: var(--ink-soft); font-size: 1.05rem; }
  .legal-mark { position: relative; display: grid; width: min(100%, 350px); min-height: 400px; place-items: center; align-content: center; gap: 22px; justify-self: end; border: 1px solid rgb(74 49 38 / 23%); background: var(--brand-main); box-shadow: 25px 27px 0 rgb(214 202 186 / 53%); transform: rotate(1.5deg); }
  .legal-mark::before { position: absolute; inset: 16px; border: 1px solid rgb(74 49 38 / 16%); content: ''; }
  .legal-mark > span { position: absolute; top: 31px; left: 34px; color: var(--ink-faint); font-size: .63rem; font-weight: 700; letter-spacing: .16em; }
  .legal-mark strong { font-size: .85rem; letter-spacing: .18em; }
  .legal-mark i { color: var(--ink-soft); font-size: .7rem; }
  .document-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 17px; }
  .document-card { position: relative; display: flex; min-height: 390px; flex-direction: column; overflow: hidden; padding: 27px; border: 1px solid rgb(138 121 103 / 28%); border-radius: var(--radius-md); background: rgb(255 253 249 / 75%); box-shadow: var(--shadow-sm); transition: transform 220ms ease, box-shadow 220ms ease; }
  .document-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-5px); }
  .document-card::before { position: absolute; top: -70px; right: -60px; width: 190px; height: 190px; border-radius: 50%; background: var(--brand-tertiary); content: ''; opacity: .45; }
  .document-card.privacy::before { background: #b9c8c4; }
  .document-card.safety::before { background: var(--brand-main); }
  .doc-index { position: relative; color: var(--ink-faint); font-size: .62rem; font-weight: 700; letter-spacing: .15em; }
  .doc-icon { position: relative; display: grid; width: 61px; height: 61px; place-items: center; margin: 50px 0 25px; border: 1px solid rgb(74 49 38 / 22%); border-radius: 50%; background: rgb(255 253 249 / 62%); }
  .document-card h2 { margin-bottom: 14px; font-size: 1.75rem; }
  .document-card p { flex: 1; color: var(--ink-soft); font-size: .8rem; }
  .document-card > span { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; color: var(--action); font-size: .76rem; font-weight: 700; font-style: italic; }
  .launch-gates { color: var(--paper-strong); background: var(--ink); }
  .gate-grid { display: grid; align-items: start; grid-template-columns: .72fr 1.28fr; gap: clamp(50px, 8vw, 120px); }
  .gate-grid > div .eyebrow { color: rgb(244 236 225 / 48%); }
  .gate-grid > div p { color: rgb(244 236 225 / 60%); }
  .gate-grid ol { margin: 0; padding: 0; border-top: 1px solid rgb(244 236 225 / 18%); list-style: none; }
  .gate-grid li { display: grid; grid-template-columns: 35px 25px 1fr; gap: 13px; padding: 24px 0; border-bottom: 1px solid rgb(244 236 225 / 15%); }
  .gate-grid li > span { color: rgb(244 236 225 / 35%); font-size: .62rem; font-weight: 700; letter-spacing: .12em; }
  .gate-grid li > :global(svg) { color: var(--brand-main); }
  .gate-grid li strong { color: var(--brand-main); font-size: .82rem; }
  .gate-grid li p { margin: 4px 0 0; color: rgb(244 236 225 / 57%); font-size: .75rem; }
  .draft-footer { padding-block: 25px; color: var(--danger); background: rgb(141 47 54 / 8%); }
  .draft-footer .container { display: grid; align-items: center; grid-template-columns: 32px 1fr; gap: 12px; }
  .draft-footer strong { font-size: .78rem; }
  .draft-footer p { margin: 3px 0 0; color: var(--ink-soft); font-size: .71rem; }
  @media (max-width: 900px) { .hero-grid, .gate-grid { grid-template-columns: 1fr; } .legal-mark { justify-self: center; } .document-grid { grid-template-columns: 1fr; } .document-card { min-height: 330px; } }
  @media (max-width: 560px) { .hero-grid { min-height: auto; padding-block: 55px 75px; } .legal-mark { width: calc(100% - 20px); min-height: 350px; } }
</style>
