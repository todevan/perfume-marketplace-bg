<script lang="ts">
  import { ArrowUpRight, AtSign } from '@lucide/svelte';
  import ScentMark from './ScentMark.svelte';
</script>

<footer class="footer">
  <div class="container footer-grid">
    <div class="footer-intro">
      <ScentMark size={58} inverted />
      <p>Подредено място за ароматите, които търсят следващия си притежател.</p>
      <span>България · затворена beta</span>
    </div>

    <div>
      <h2>Пазар</h2>
      <a href="/listings">Всички обяви</a>
      <a href="/wanted">Търся парфюм</a>
      <a href="/merchants">Проверени търговци</a>
      <a href="/publish">Публикувай</a>
    </div>

    <div>
      <h2>Доверие</h2>
      <a href="/safety">Безопасна търговия</a>
      <a href="/safety#authenticity">Проверка на доказателства</a>
      <a href="/legal/rules">Правила на пазара</a>
      <a href="/safety#report">Подай сигнал</a>
    </div>

    <div class="footer-note">
      <h2>Информационни проверки</h2>
      <a href="https://www.batch-code.com/" target="_blank" rel="noopener noreferrer">
        Batch code справка <ArrowUpRight size={15} />
      </a>
      <p>Валидният batch code не е гаранция за автентичност.</p>
      <a class="social" href="/" aria-label="Социален профил (предстои)"><AtSign size={17} /> Скоро</a>
    </div>
  </div>

  <div class="container footer-bottom">
    <span>© 2026 · Marketplace beta</span>
    <div><a href="/legal/privacy">Поверителност</a><a href="/legal/terms">Условия</a><a href="/legal/appeals">Обжалване</a></div>
  </div>
</footer>

<style>
  .footer {
    padding: 58px 0 20px;
    color: var(--brand-secondary);
    background: #2b201a;
  }

  .footer-grid {
    display: grid;
    grid-template-columns: 1.5fr repeat(3, 1fr);
    gap: 42px;
    padding-bottom: 48px;
  }

  .footer-intro {
    max-width: 290px;
  }

  .footer-intro p {
    margin: 20px 0 12px;
    color: rgb(248 243 235 / 78%);
    font-size: 1.08rem;
  }

  .footer-intro span,
  .footer-note p {
    color: rgb(248 243 235 / 54%);
    font-size: 0.76rem;
  }

  h2 {
    margin-bottom: 18px;
    color: rgb(248 243 235 / 54%);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer-grid > div:not(.footer-intro) {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 11px;
  }

  .footer a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: rgb(248 243 235 / 84%);
    font-size: 0.88rem;
  }

  .footer a:hover {
    color: var(--brand-main);
  }

  .social {
    margin-top: 4px;
  }

  .footer-bottom {
    display: flex;
    min-height: 54px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-top: 1px solid rgb(248 243 235 / 16%);
    color: rgb(248 243 235 / 48%);
    font-size: 0.73rem;
  }

  .footer-bottom div {
    display: flex;
    gap: 20px;
  }

  .footer-bottom a {
    color: inherit;
    font-size: inherit;
  }

  @media (max-width: 900px) {
    .footer-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 560px) {
    .footer-grid {
      grid-template-columns: 1fr;
    }

    .footer-bottom {
      align-items: flex-start;
      flex-direction: column;
      padding-block: 18px;
    }
  }
</style>
