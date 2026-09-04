# Приходен модел и go-to-market за парфюмния marketplace

> **Historical archive — non-authoritative.**
>
> Preserve this material only as dated evidence. Current owner decisions, live GitHub state, root `AGENTS.md`, and active repository contracts outrank it.


## Статус и предназначение

Статус: работна, но авторитетна бизнес рамка за pre-launch beta и бъдещата монетизация.

Последно актуализирано: 11 август 2026 г.

Сумите, праговете и продуктовите механики в този документ са бизнес хипотези и продуктови решения.

Те подлежат на необходимото:

- счетоводно потвърждение;
- данъчно потвърждение;
- правно потвърждение;
- payment-provider acceptance;
- production authorization.

Този документ определя **бизнес модела и търговските ограничения**.

Той не е:

- engineering execution plan;
- GitHub backlog;
- payment implementation specification;
- legal opinion;
- accounting opinion;
- разрешение за активиране на monetisation;
- разрешение за production mutation.

За текущото състояние използвай:

- `docs/PROJECT-STATUS.md`

За release/readiness gates:

- `docs/LAUNCH-GATES.md`

За архитектура:

- `docs/ARCHITECTURE.md`

За autonomy, Human Gates и execution:

- `docs/agents/`

GitHub Issues остават canonical executable queue.

---

# 1. Какво всъщност монетизираме

Платформата не взема плащането за парфюма и не удържа комисиона от самата marketplace сделка.

Продавачът и купувачът сами договарят:

- плащане;
- доставка;
- преглед;
- други извънплатформени условия по сделката.

Платформата не е payment intermediary за стойността на парфюма в текущия продуктов модел.

Приходът идва от собствени дигитални услуги на платформата:

- повече активен капацитет за обяви;
- професионални инструменти за търговци;
- ясно означено временно промотиране;
- директни релевантни рекламни позиции след достигане на достатъчна аудитория.

Този модел пази MVP по-лек, но означава, че ликвидността и доверието трябва да бъдат доказани преди въвеждането на такси.

`Проверен търговец` е trust статус.

Той:

- остава безплатен;
- не може да бъде купен;
- не може да бъде включен като paid-plan benefit;
- не може да бъде заместен от VIP, subscription или boost статус.

Съществуващ payment/provider код е бъдещо scaffolding.

Наличието му не означава, че billing е разрешен или активен.

---

# 2. Продуктова тарифа

| Услуга | Цена | Право | Кога се предлага |
|---|---:|---|---|
| Private / Merchant Basic | €0 | 10 активни обяви | От първия ден |
| Допълнителен активен слот | €1,99 еднократно | +1 активна обява; правото се запазва при 60-дневно подновяване | Само след billing gate |
| Merchant Start | €14,99/месец | До 50 активни обяви | След merchant billing gate |
| Merchant Pro | €29,99/месец | До 200 активни обяви, bulk управление, статистика и promo кредити | След merchant billing gate |
| Boost | €1,99/7 дни | Ясно означена спонсорирана позиция | След billing gate; максимум 10% от feed |
| Директна реклама | €99 пилот | Един измерим пилотен пакет | След advertising gate |
| Директна реклама | €149–249/месец | Договорен релевантен пакет | След успешен пилот |

Не се предлагат:

- pay-to-verify;
- скрито платено органично класиране;
- такса за чат;
- процент от стойността на парфюма;
- платен trust/status upgrade;
- скрито смесване на sponsored и organic ranking.

Тези цени не трябва да бъдат активирани само защото съответният код съществува.

Всички paid capabilities остават feature-gated до изпълнение на приложимите business, legal, accounting, provider и production gates.

---

# 3. Задължителни activation gates

## Такси за обяви, merchant планове и boost

Преди activation всички следващи условия трябва да бъдат изпълнени в **три последователни месеца**:

- поне 500 качествени активни обяви;
- поне 150 активни продавачи;
- поне 35% от новите обяви да получават квалифицирано запитване до 30 дни.

Това са business activation thresholds.

Те не са препоръчителни engineering metrics.

Codex, Superpowers, Matt Pocock skills, ECC или други specialist tools не могат самостоятелно да ги намаляват, преинтерпретират или заобикалят.

### Квалифицирано запитване

`Квалифицирано запитване` е:

- структурирана оферта; или
- смислен първи чат

от различен потвърден профил.

Не се броят:

- spam;
- собствен профил;
- автоматични съобщения;
- тестови/fixture interactions, освен когато metric pipeline изрично ги изключва от production KPI.

Ако след activation новите обяви спаднат с повече от 15%, съответната такса се паузира за продуктов review.

Паузата е business safeguard, а не автоматично разрешение инженерният агент да променя pricing стратегията.

---

## Директна реклама

Преди advertising activation трябва да бъдат изпълнени всички:

- 25 000 marketplace pageviews за месец;
- 3 000 MAU;
- поне трима реално заинтересовани партньори.

Рекламата трябва да бъде:

- релевантна за аудиторията;
- визуално разграничена;
- ясно означена;
- измервана отделно от organic feed.

Advertising scaffolding не трябва да бъде активирано преди този gate.

---

# 4. Илюстративни месечни сценарии

Следващите числа не са финансова прогноза.

Те са проверка на механиката на бизнес модела.

Сумите са илюстративен брутен оборот преди:

- ДДС;
- payment fees;
- refunds;
- chargebacks;
- данъци;
- инфраструктура;
- модерация;
- support;
- legal/accounting разходи.

| Източник | Ранен платен етап | Етап на растеж |
|---|---:|---:|
| Merchant Start | 30 × €14,99 = €449,70 | 100 × €14,99 = €1 499,00 |
| Merchant Pro | 10 × €29,99 = €299,90 | 40 × €29,99 = €1 199,60 |
| Boost | 150 × €1,99 = €298,50 | 500 × €1,99 = €995,00 |
| Допълнителни слотове | 80 × €1,99 = €159,20 | 250 × €1,99 = €497,50 |
| Директни партньори | 2 × €99 = €198,00 | 4 × €199 = €796,00 |
| **Общо бруто** | **€1 405,30** | **€4 987,10** |

Първата продуктова цел не е максимален ARPU.

Първо трябва да бъдат доказани:

- достатъчно предлагане;
- marketplace liquidity;
- бърз отговор;
- repeat participation;
- repeat deals;
- доверие.

При успешен модел subscriptions могат да станат основният предвидим приход.

Boost и advertising остават допълващи механизми и не трябва да изкривяват marketplace discovery.

---

# 5. KPI договор

## Основен KPI

Основен KPI:

**взаимно потвърдени продажби/размени на месец**

Двойното потвърждение е operational proxy за завършена сделка.

То не трябва да бъде представяно като абсолютна гаранция, че физическата сделка действително е протекла точно както страните твърдят.

---

## Поддържащи показатели

Следят се:

- медиана до първо квалифицирано запитване;
- 30-дневна ликвидност — дял нови обяви с квалифицирано запитване;
- дял обяви, достигнали двойно потвърждение;
- седмично повторно участие на купувачи и продавачи;
- месечно повторно участие на купувачи и продавачи;
- активни качествени обяви;
- активни продавачи;
- report rate на 100 активни обяви;
- медиана за модераторска реакция;
- p90 за модераторска реакция;
- merchant trial → paid conversion;
- merchant churn;
- използван merchant capacity;
- boost incremental lift спрямо сходни organic listings.

---

## Качествена активна обява

За целите на business KPI една `качествена активна обява` трябва да има:

- всички задължителни структурирани полета;
- необходимия набор от валидни доказателствени снимки;
- потвърден продавач;
- да не е duplicate;
- да няма активен high-risk сигнал, който според текущата moderation политика прави обявата неподходяща за quality inventory.

Ако техническите listing requirements се променят чрез по-нова продуктова/архитектурна спецификация, KPI implementation трябва да бъде синхронизиран с актуалния authoritative definition.

Не поддържай паралелни технически дефиниции за quality listing само в analytics кода.

---

# 6. Launch последователност

## 1. Free pre-launch beta

Ръчното набиране на колекционери и малък брой търговци остава валиден go-to-market подход.

Самата регистрация обаче **не е invite-only product requirement**.

Според актуалното owner решение продуктът използва стандартна public email/password регистрация.

Beta cohort може да бъде ограничаван operationally чрез:

- комуникация;
- onboarding;
- marketing;
- release exposure;
- feature availability;
- други изрично одобрени механизми,

без да се връща obsolete invite-only authentication policy.

По време на този етап:

- няма platform billing;
- няма paid plans;
- няма boosts;
- няма advertising revenue activation;
- няма platform payment за perfume transaction.

---

## 2. Liquidity validation

Извършва се редовен cohort review по релевантни dimensions като:

- категория;
- град;
- тип сделка;
- тип продавач.

Основната цел е подобряване на:

- време до първо качествено запитване;
- liquidity;
- repeat participation;
- inventory quality.

Не се въвеждат такси за компенсиране на слаба liquidity.

---

## 3. Merchant tools pilot

Bulk и analytics capabilities могат да бъдат тествани безплатно с приблизително 5–10 търговци.

Целта е да се измери:

- реално спестена работа;
- използваемост;
- нужда от capacity;
- стойност преди pricing.

Безплатното пилотно използване не означава, че merchant subscription billing е активиран.

---

## 4. Billing sandbox

Payment integration трябва да бъде доказана в sandbox/authorized test environment преди реална monetisation activation.

За планирания myPOS path трябва да бъдат проверени приложимите:

- signed callback/webhook;
- exact acknowledgement;
- duplicate event;
- idempotency;
- отказ;
- rollback/failure;
- refund;
- entitlement grant/revocation;
- authoritative server-side payment state.

Client-side success UI никога не е достатъчен за предоставяне на paid entitlement.

---

## 5. Controlled paid rollout

След изпълнение на всички applicable gates:

1. voluntary merchant pilot;
2. merchant plans;
3. boost;
4. additional private listing slots.

Този ред е business rollout preference.

Конкретната production activation остава защитена операция и изисква приложимото authorization.

---

## 6. Advertising pilot

Advertising започва едва след audience gate.

Първият етап трябва да бъде:

- ограничен;
- директно измерим;
- ясно sponsored;
- релевантен за marketplace audience.

Успехът на пилота трябва да се оценява и спрямо trust/liquidity ефекти, не само revenue.

---

# 7. Payment model и provider boundaries

В текущия продуктов модел payment provider обслужва само собствени дигитални услуги на платформата.

Не обслужва underlying perfume transaction.

Тази граница е бизнес и архитектурно решение.

Промяна към:

- escrow;
- marketplace checkout;
- platform-collected perfume payments;
- commissions върху сделката;
- seller payouts;

е материална промяна на business model и не може да бъде направена като engineering implementation detail.

Тя изисква ново изрично business/legal решение и съответните Human Gates.

---

## Primary и fallback provider

Текущата business посока е:

```text
Primary paid-service path
→ myPOS

Fallback/contingency path
→ Stripe
```

Stripe може да бъде разработван или тестван като fallback, когато това е изрично в scope.

Той не трябва автоматично да се активира само защото myPOS има временен проблем.

Provider activation трябва да следва одобрения payment/release gate.

---

# 8. Разходи и unit economics

Задължително се моделират отделно:

- ДДС;
- счетоводно третиране на всяка дигитална услуга;
- myPOS/Stripe processing;
- refunds;
- chargebacks;
- Supabase;
- Cloudflare;
- Storage;
- image processing;
- Realtime;
- transactional email;
- други активирани communication providers;
- човешка модерация;
- merchant verification;
- support;
- адвокат;
- счетоводител;
- застраховки;
- incident response;
- придобиване на продавач по channel;
- придобиване на купувач по channel.

Не приемай SMS като текущ задължителен cost center само защото по-стар план го е включвал.

Regular-user phone/SMS verification не е част от текущия authentication model.

Ако SMS бъде въведен за друга бъдеща функция, той се добавя към модела тогава.

---

## Management dashboard

Минималният management dashboard за платения етап трябва да показва:

- gross revenue;
- VAT/payment cost;
- refunds;
- chargebacks когато са приложими;
- net revenue;
- support cost;
- moderation cost;
- contribution margin по продукт.

Paid feature не се оценява само по turnover.

Следи се и влиянието върху:

- marketplace liquidity;
- ново предлагане;
- seller retention;
- buyer engagement;
- trust signals;
- moderation load.

---

# 9. Рискове и защитни правила

## Прекалено ранна такса

Такса, въведена твърде рано, може да намали marketplace supply.

Затова activation gate е system/business condition, а не календарна дата.

---

## Boost saturation

Boost може да превърне discovery feed-а в реклама.

Затова:

- максимум 10% от feed;
- ясно означение `Спонсорирано`;
- отделен sponsored ranking слой;
- organic rows под sponsored insertion не трябва да бъдат тайно пренареждани.

---

## Pay-to-trust

Платен план не може да купува trust.

Merchant verification остава:

- безплатен;
- независим от subscription;
- независим от boost;
- независим от advertising spend.

---

## Off-platform deal observability

Тъй като underlying сделки се извършват извън платформата, observability е непълна.

Двойното потвърждение остава основният operational signal, но не абсолютна гаранция за физическо изпълнение.

---

## Advertising trust risk

Advertising без достатъчна аудитория:

- намалява trust;
- използва sales/support време;
- може да влоши marketplace UX.

Затова започва само след audience gate и доказан партньорски интерес.

---

## €1,99 economics

€1,99 може да има лоша unit economics след:

- VAT;
- payment fee;
- refund overhead;
- support cost.

Преди activation sandbox/business analysis трябва да установи реалния net receipt и operational cost.

Технически успешното payment integration само по себе си не доказва икономическа жизнеспособност.

---

# 10. Външни business/legal gates

Следващите области изискват owner и/или квалифицирано външно професионално решение.

Engineering agent не трябва самостоятелно да ги превръща в правни или счетоводни заключения.

## Български адвокат

Необходимо е приложимо професионално становище за теми като:

- DSA;
- GPSR / Safety Gate;
- DAC7;
- trader/private distinction;
- withdrawal/refund правила;
- testers/samples;
- marketplace Terms;
- privacy/retention;
- други приложими задължения.

---

## Счетоводител

Необходимо е професионално потвърждение за:

- ДДС;
- фактуриране;
- фискални документи;
- приходно признаване;
- subscriptions;
- refund accounting;
- други приложими счетоводни задължения.

---

## myPOS / payment onboarding

Преди реална activation са необходими applicable:

- фирмена/merchant структура;
- business bank account;
- provider onboarding;
- sandbox acceptance;
- production onboarding;
- approved secret/configuration handling.

Наличен API ключ или работещ sandbox не означава автоматично production authorization.

---

## Branding

Остават owner-controlled:

- име;
- лого;
- домейн;
- trademark стратегия.

До окончателно решение техническите елементи трябва да останат достатъчно конфигурационни, когато това е разумно и вече поддържано от архитектурата.

Не извършвай ненужна архитектурна абстракция само за хипотетично бъдещо rebranding.

---

# 11. Business decisions и Human Gates

Този файл съдържа вече взети бизнес решения и работни бизнес хипотези.

Когато implementation срещне действително нерешен business въпрос, използвай приложимия Human Gate от:

`docs/agents/HUMAN-GATES.md`

Не блокирай собственика за routine engineering details.

Business gate е необходим когато изборът материално променя например:

- pricing;
- monetisation;
- trust model;
- seller obligations;
- payment responsibility;
- public exposure;
- advertising policy;
- merchant policy;
- legal/commercial commitments.

След durable owner decision актуализирай подходящия authoritative документ, вместо решението да остава само в chat history.

---

# 12. Skill interaction

Skill routing е дефиниран в:

`docs/agents/SKILL-ROUTER.md`

За business-model related engineering нормалната зависимост е:

```text
Repository business rule
        ↓
GitHub issue / authorized scope
        ↓
Superpowers primary process
        ↓
Matt Pocock engineering/domain reasoning when useful
        ↓
ECC / provider specialist when useful
        ↓
repository-defined verification
```

Superpowers управлява engineering process-а.

Matt Pocock skills могат да помагат с:

- domain modeling;
- entitlement modeling;
- pricing-state modeling;
- codebase boundaries;
- failure modes.

ECC/platform specialists могат да помагат с:

- payment security;
- backend behavior;
- provider integrations;
- webhooks;
- E2E;
- Supabase/Cloudflare constraints.

Нито една skill система няма право самостоятелно да променя:

- pricing;
- activation thresholds;
- marketplace payment model;
- merchant trust rules;
- advertising caps;
- legal/accounting policy.

Не създавай втори planning, TDD, debugging или completion loop за business-related work.

---

# 13. Production и monetisation activation

Следните събития не са еквивалентни:

```text
payment code exists
≠
sandbox passes
≠
business gate passes
≠
legal/accounting gate passes
≠
production provider configured
≠
monetisation authorized
≠
paid feature active
```

Production billing activation трябва да бъде изрично разрешена според repository risk и Human Gate правилата.

Не активирай:

- payment provider production mode;
- paid entitlements;
- subscriptions;
- boosts;
- ads;
- listing fees;

като incidental част от друга задача.

---

# 14. Основен business invariant

```text
Perfume transaction остава off-platform.
Platform revenue идва от собствени дигитални услуги.
Trust не се продава.
Монетизацията идва след liquidity.
Paid features изискват business thresholds.
Payment scaffolding не е authorization.
Legal/accounting въпросите не се решават от engineering agent.
Production activation е защитена граница.
```

Тези правила са по-важни от предпочитанията на която и да е installed skill система.
