# Aromatika — Bulgarian perfume marketplace

Aromatika is a Bulgaria-first perfume marketplace being prepared for public launch.

Normal users register with email/password, confirm their email, complete onboarding, and can use the marketplace without an invitation, waiting list, phone verification, or SMS OTP. Staff/admin access remains separately protected with MFA.

Perfume payment and delivery are arranged directly between buyer and seller. Aromatika monetizes its own marketplace services rather than taking commission from the perfume sale.

Current operational readiness is documented in `docs/PROJECT-STATUS.md`.

## Реализирано

- cookie-based Supabase PKCE/SSR, проверена сесия, default-deny route guards и MFA за staff;
- публична email/password регистрация, email confirmation, onboarding, versioned consent history и private contact data;
- публични DTO проекции без директен достъп до чувствителните колони на профила;
- реални чернови и autosave, четири evidence снимки, атомарно публикуване и pending brand „Други“;
- PostgreSQL full-text/trigram търсене, aliases, филтри и keyset cursor pagination;
- любими, запазени търсения, структурирани оферти и атомарно резервиране;
- частен текстов чат след приета оферта, сделки, отказ, dispute и отзив; актуалната completion разлика е описана в `docs/PROJECT-STATUS.md`;
- merchant application и report-bound moderation с append-only audit;
- quarantine upload запис, реално MIME разпознаване, WebP/JPEG re-encode и премахване на EXIF;
- in-app известия и идемпотентен Resend delivery ledger;
- Cloudflare Worker конфигурация, автоматичен quality CI, ръчен staging deploy workflow и encrypted Storage backup;
- target-locked operator tooling е pinned към staging project ref `nuhkpqjjyuygiemrxbdp` в `eu-central-1`; текущото hosted състояние се доказва отделно в `docs/PROJECT-STATUS.md`;
- billing/payment/entitlement scaffolding е fail-closed по подразбиране и не доказва, че launch monetization flow е готов.

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

Нормалният flow започва с публична email/password регистрация, email confirmation и onboarding. Legacy/bootstrap invitation механизми може да останат за first-admin/operator compatibility; те не са normal-user admission model.

## Проверки

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
pnpm db:test
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
pnpm check:release -- --env-file=.env.production
```

`pnpm test` изпълнява каталожните, unit/contract тестовете, Svelte/TypeScript проверката и production build. `pnpm test:e2e` използва изрично включен локален demo runtime. Реалният multi-account staging сценарий се стартира само когато са зададени описаните в теста `E2E_REAL_*` secrets.

Release gate-ът нарочно се проваля при чист checkout и валидира текущия pre-launch security/provider baseline. Той не доказва hosted readiness или launch monetization readiness; актуалните блокери са в `docs/PROJECT-STATUS.md`.

## Миграции

`001` и `002` са запазени без промяна. Всички следващи schema промени са forward-only. Каноничната и пълна migration верига е проследена директно в `supabase/migrations/`; README не дублира списък, който може да остарее.

Каталогът се зарежда чрез една provenance-aware транзакция с `pnpm seed:catalog` локално или `pnpm seed:staging` след успешен hosted target guard. Провереният baseline съдържа 196 марки, 48 aliases и 335 editorial memberships. Точните редакционни колекции остават `80/80/80/80/15`.

## Production граници

- Browser Supabase клиентът е само за разрешени Realtime subscriptions; всички writes минават през валидирани server actions.
- Service-role/secret keys, Resend, SMS, Turnstile и image credentials никога не са `PUBLIC_*`.
- Оригиналните снимки са private и се изтриват след успешна обработка; публична е само sanitised версията.
- Телефонът и имейлът не се четат от публичната база.
- Плащането и доставката на парфюма остават извън платформата. Структурираната оферта не е checkout или договор.
- Batch code проверката е само информационна и не представлява гаранция за оригиналност.

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime, trust boundaries и data flows;
- [`docs/STAGING-CREDENTIALS.md`](docs/STAGING-CREDENTIALS.md) — актуален hosted staging checkpoint, secret ownership, dashboard locations и rollback ред;
- [`docs/PRODUCTION-SETUP.md`](docs/PRODUCTION-SETUP.md) — среди, secrets и deploy последователност;
- [`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md) — отделен encrypted backup за Storage;
- [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md) — incident/contact процес;
- [`docs/LAUNCH-GATES.md`](docs/LAUNCH-GATES.md) — външни и правни блокери;
- [`docs/PERFUME-CATALOG-AND-UI-SPEC.md`](docs/PERFUME-CATALOG-AND-UI-SPEC.md) — продуктовият/UI договор;
- [`catalog/brand-categories.json`](catalog/brand-categories.json) — canonical brand registry.

## Hosted and provider state

Do not infer staging or production state from this README. Use `docs/PROJECT-STATUS.md` for current verified facts, `docs/STAGING-CREDENTIALS.md` for target-locked operator guidance, and `docs/LAUNCH-GATES.md` for evidence still required before launch.
