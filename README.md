# Bulgarian perfume marketplace — closed beta

Работеща SvelteKit основа за затворен marketplace за нови и употребявани парфюми, продажба, размяна и обяви „Търся“. Името, логото и домейнът остават конфигурационни.

Кодът вече съдържа production data flow, invite-only authentication и forward-only Supabase hardening. Външните staging/production акаунти, домейнът, SMS операторът и одобрените правни текстове не могат да бъдат създадени от хранилището и остават launch gates.

## Реализирано

- cookie-based Supabase PKCE/SSR, проверена сесия, default-deny route guards и MFA за staff;
- еднократни администраторски покани, onboarding, versioned consent history и скрит телефон;
- публични DTO проекции без директен достъп до чувствителните колони на профила;
- реални чернови и autosave, четири evidence снимки, атомарно публикуване и pending brand „Други“;
- PostgreSQL full-text/trigram търсене, aliases, филтри и keyset cursor pagination;
- любими, запазени търсения, структурирани оферти и атомарно резервиране;
- частен текстов чат след приета оферта, сделки, спор, двойно потвърждение и отзив;
- merchant application и report-bound moderation с append-only audit;
- quarantine upload запис, реално MIME разпознаване, WebP/JPEG re-encode и премахване на EXIF;
- in-app известия и идемпотентен Resend delivery ledger;
- Cloudflare Worker конфигурация, автоматичен quality CI, ръчен staging deploy workflow и encrypted Storage backup;
- всички billing/payment/boost/subscription/ads функции са изключени по подразбиране.

## Runtime режими

Production режимът изисква Supabase конфигурация и отказва достъп при липсваща или невалидна auth услуга. Демо режимът е само за локална визуална проверка и Playwright UI тестове; той никога не се включва автоматично.

```powershell
pnpm install
$env:PUBLIC_DEMO_MODE='true'
$env:APP_ENV='development'
pnpm dev
```

За реална локална среда стартирайте Supabase и попълнете `.env` от `.env.example` с локалните URL/keys:

```powershell
pnpm db:start
pnpm db:reset
pnpm db:lint
pnpm db:test
pnpm seed:catalog
pnpm dev
```

Публичната регистрация е изключена. Реалният flow започва с покана от MFA-защитения `/admin` панел.

## Проверки

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
pnpm db:test
pnpm check:release -- --env-file=.env.production
```

`pnpm test` изпълнява каталожните, unit/contract тестовете, Svelte/TypeScript проверката и production build. `pnpm test:e2e` използва изрично включен локален demo runtime. Реалният multi-account staging сценарий се стартира само когато са зададени описаните в теста `E2E_REAL_*` secrets.

Release gate-ът нарочно се проваля при чист checkout: изисква HTTPS custom domain, реални Supabase/Resend/Turnstile/Twilio/Cloudflare secrets, включен защитен image processor, одобрени правни версии и всички monetisation flags да останат `false`.

## Миграции

`001` и `002` са запазени без промяна. Новите миграции са forward-only:

1. `202607220003_beta_access_privacy.sql` — покани, beta membership, consent и public profile projection;
2. `202607220004_workflow_invariants.sql` — атомарни listing/offer/deal transitions и lifecycle правила;
3. `202607220005_uploads_evidence.sql` — quarantine/finalized upload records и cleanup;
4. `202607220006_moderation_lifecycle.sql` — report-bound решения, suspension и audit;
5. `202607220007_search_realtime_jobs.sql` — slugs, search RPC, Realtime, notifications, email ledger и scheduled jobs;
6. `202607220008_first_admin_bootstrap.sql` — еднократен, service-role-only bootstrap за първия staging администратор.

Каталогът се зарежда чрез една provenance-aware транзакция с `pnpm seed:catalog`. Точните редакционни колекции остават `80/80/80/80/15`.

## Production граници

- Browser Supabase клиентът е само за разрешени Realtime subscriptions; всички writes минават през валидирани server actions.
- Service-role/secret keys, Resend, SMS, Turnstile и image credentials никога не са `PUBLIC_*`.
- Оригиналните снимки са private и се изтриват след успешна обработка; публична е само sanitised версията.
- Телефонът и имейлът не се четат от публичната база.
- Плащането и доставката на парфюма остават извън платформата. Структурираната оферта не е checkout или договор.
- Batch code проверката е само информационна и не представлява гаранция за оригиналност.

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime, trust boundaries и data flows;
- [`docs/PRODUCTION-SETUP.md`](docs/PRODUCTION-SETUP.md) — среди, secrets и deploy последователност;
- [`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md) — отделен encrypted backup за Storage;
- [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md) — incident/contact процес;
- [`docs/LAUNCH-GATES.md`](docs/LAUNCH-GATES.md) — външни и правни блокери;
- [`docs/PERFUME-CATALOG-AND-UI-SPEC.md`](docs/PERFUME-CATALOG-AND-UI-SPEC.md) — продуктовият/UI договор;
- [`catalog/brand-categories.json`](catalog/brand-categories.json) — canonical brand registry.

## Преди първа външна покана

Новият canonical private remote е `todevan/perfume-marketplace-bg`; старото repo `todevan/remix-of-scent-exchange` остава недокоснато. Текущият GitHub Free модел използва repository secrets и само ръчно staging пускане, без да разчита на protected branch/environment enforcement. Преди свързване направете read-only inventory на remote-а, Supabase staging и Cloudflare и спрете при всяко несъответствие — без remote reset или repair. Hosted provider интеграциите, production, custom domain, carrier тестовете, backup/restore rehearsal, външните покани и правният преглед остават launch gates.
