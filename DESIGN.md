---
name: "Парфюмен community marketplace"
description: "Ivory marketplace система, в която конкретният флакон, продавачът и доказателствата се четат като едно цяло."
colors:
  brand-main: "#f3dfbf"
  brand-secondary: "#f4ece1"
  brand-tertiary: "#d6caba"
  paper: "#f8f3eb"
  paper-strong: "#fffdf9"
  paper-deep: "#ede4d7"
  ink: "#2b201a"
  ink-soft: "#66584e"
  ink-faint: "#796a60"
  action: "#751d2b"
  action-hover: "#59131f"
  action-soft: "#f4e4e5"
  line: "#d8ccbd"
  line-strong: "#ad9d8b"
  success: "#315f47"
  success-soft: "#e7f0e9"
  warning: "#8b591e"
  warning-soft: "#f6ead6"
  danger: "#9c3037"
  danger-soft: "#f8e5e6"
typography:
  display:
    fontFamily: '"Manrope", Arial, "Helvetica Neue", Helvetica, sans-serif'
    fontSize: "clamp(2.4rem, 6vw, 5.25rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Manrope", Arial, "Helvetica Neue", Helvetica, sans-serif'
    fontSize: "clamp(1.75rem, 3.3vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Manrope", Arial, "Helvetica Neue", Helvetica, sans-serif'
    fontSize: "clamp(1.1rem, 1.8vw, 1.4rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: '"Manrope", Arial, "Helvetica Neue", Helvetica, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '"Manrope", Arial, "Helvetica Neue", Helvetica, sans-serif'
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.09em"
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "clamp(56px, 7vw, 104px)"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.paper-strong}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
    height: "46px"
  input-field:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
    height: "48px"
  pill:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 9px"
    height: "28px"
  listing-card:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "18px"
  choice-card:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "14px"
  header-navigation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    height: "68px"
  trust-status:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
    padding: "10px"
  member-rail:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-strong}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: Парфюмен community marketplace

## Overview

**Creative North Star: "The Community Bottle Ledger"**

Системата се държи като подреден общностен регистър на реални флакони: ivory хартия, тъмнокафяво мастило, taupe разграфяване и burgundy действия. Premium усещането идва от плътната фотография, стегнатата типография и точната информационна йерархия, а не от storefront театър или декоративен лукс.

Флаконът, остатъкът, продавачът и статусът на доказателствата се възприемат като една единица. Повърхностите остават спокойни и плоски, за да може потребителската снимка да носи характера; контролите са ясни, компактни и физически достатъчно големи.

**Key Characteristics:**
- Ivory paper canvas with porcelain cards and taupe rules.
- Deep burgundy reserved for decisions, active state and concise labels.
- Dense user photography paired with precise bottle and seller facts.
- One self-hosted sans-serif voice with compressed display hierarchy.
- Flat-by-default surfaces with restrained disclosure-only depth.

## Colors

Палитрата е топла и материална: три paper нива и walnut текст изграждат основата, burgundy маркира действията, а semantic цветовете са запазени за доказателства, предупреждения и сигнали.

### Primary
- **Deep Burgundy** (`action`, #751d2b): Основни действия, активни състояния, навигационен индикатор и кратки market етикети.
- **Pressed Burgundy** (`action-hover`, #59131f): Натиснато или hover състояние на основното действие.
- **Burgundy Blush** (`action-soft`, #f4e4e5): Тих фон за избрани опции и hover на иконни контроли.

### Secondary
- **Warm Sand** (`brand-main`, #f3dfbf): Топъл акцент за вторични информационни области.

### Tertiary
- **Evidence Green / Mist** (`success` / `success-soft`, #315f47 / #e7f0e9): Само за положителен evidence или завършен процес.
- **Amber Warning / Wash** (`warning` / `warning-soft`, #8b591e / #f6ead6): Предупреждения и незавършени проверки.
- **Report Red / Blush** (`danger` / `danger-soft`, #9c3037 / #f8e5e6): Грешки, опасни действия и сигнализиране.

### Neutral
- **Ivory Paper** (`paper`, #f8f3eb): Основният canvas.
- **Porcelain Paper** (`paper-strong`, #fffdf9): Карти, полета и повдигнати от тона панели.
- **Deep Parchment** (`paper-deep`, #ede4d7): Работни пространства и по-плътни секционни полета.
- **Cream Wash / Taupe Field** (`brand-secondary` / `brand-tertiary`, #f4ece1 / #d6caba): Тихи member и media фонове.
- **Dark / Soft / Faded Walnut** (`ink` / `ink-soft` / `ink-faint`, #2b201a / #66584e / #796a60): Заглавия, основен текст и вторични метаданни.
- **Taupe Line / Strong Taupe Line** (`line` / `line-strong`, #d8ccbd / #ad9d8b): Разделители, граници и по-силен interactive stroke.

### Named Rules

**The Burgundy Decision Rule.** Burgundy означава действие, избор или пазарен статус; не се използва като общ декоративен фон.

**The Paper Before Chrome Rule.** Йерархията първо се строи с paper тонове и taupe линии, а не с ефекти.

## Typography

**Display Font:** Manrope (with Arial, Helvetica Neue, Helvetica, sans-serif fallback)  
**Body Font:** Manrope (with Arial, Helvetica Neue, Helvetica, sans-serif fallback)

**Character:** Единната sans-serif система е съвременна, компактна и човешка. Тежестта и мащабът носят редакционния характер; няма italic заглавия или декоративна втора гарнитура.

### Hierarchy
- **Display** (600, `clamp(2.4rem, 6vw, 5.25rem)`, 1.08): Големи page и product заглавия с плътна композиция.
- **Headline** (600, `clamp(1.75rem, 3.3vw, 3.25rem)`, 1.08): Секционни заглавия и ключови trust послания.
- **Title** (600, `clamp(1.1rem, 1.8vw, 1.4rem)`, 1.08): Имена на аромати, карти и панели.
- **Body** (400, `1rem`, 1.55): Описание и работен текст, обикновено до 72ch.
- **Label** (700, `0.72rem`, `0.09em`, uppercase): Eyebrow, статус и навигационни микроетикети; редовните метаданни остават в normal case.

### Named Rules

**The One Voice Rule.** Manrope е единственият визуален глас; йерархията идва от 400–700 тежести, мащаб и ритъм.

**The Compressed Display Rule.** Големите заглавия използват стегнат line-height и отрицателно letter-spacing, докато body текстът остава отворен и лесен за четене.

## Layout

Основният контейнер е ограничен до 1400px. На desktop той оставя 24px страничен gutter; при 760px и надолу gutter-ът става 14px. Общите секции използват fluid вертикален ритъм (`clamp(56px, 7vw, 104px)`), а повтарящите се card grids държат 16–18px междина.

Системата се подрежда чрез explicit CSS grids, които се свиват последователно, вместо чрез хоризонтално смаляване на съдържанието. Listing grid преминава от три към две колони при 1024px и към една при 620px; featured картата се подрежда вертикално при 720px; member rail се преобразува при 1080px; desktop header навигацията се заменя с disclosure меню при 1160px. Compact listing вариантът запазва хоризонтално photo-plus-facts четене до 420px, след което преразпределя ширините.

Всички съществени интеракции поддържат минимум 44px touch target. Responsive правилата пазят четимостта на facts, цената и действията, а не просто броя колони.

## Elevation & Depth

Системата е плоска по подразбиране. 1px taupe граници, tonal paper слоеве и photographic crop изграждат дълбочината; cards и controls нямат rest shadow. Единствената устойчива drop shadow употреба е под отвореното mobile navigation disclosure (`0 18px 48px rgb(69 47 35 / 11%)`).

### Shadow Vocabulary
- **Mobile Disclosure** (`0 18px 48px rgb(69 47 35 / 11%)`): Само за отвореното mobile меню, за да се отдели временно от страницата.

### Named Rules

**The Flat-by-Default Rule.** Resting cards, fields and panels use borders and tone, never a decorative shadow.

**The Disclosure Depth Rule.** Drop shadow се появява само когато временен слой се отваря над съществуващото съдържание.

## Shapes

Формата е сдържана и леко тактилна. 6px се използва за компактни controls и rail items, 8px е стандартът за buttons, fields и cards, 12px групира големи panels и shells, а 16px остава за редки по-големи editorial containers. Кръговете са запазени за avatar, favorite, icon и progress controls; 999px pills се използват само за кратък статус или filter label. Границите обикновено са 1px taupe и носят повече структура от самия радиус.

### Named Rules

**The Six-Eight-Twelve Rule.** Durable controls and cards live primarily at 6px, 8px and 12px; 16px is an exception for larger containers, not a default.

## Components

Компонентите са спокойни рамки за конкретни facts. Те използват restrained motion, видим focus и burgundy само когато действието или изборът го изисква.

### Buttons
- **Shape:** Леко заоблен правоъгълник (8px) с минимум 46px височина за общите actions.
- **Primary:** Deep Burgundy върху Porcelain Paper text, с 11px × 18px padding и тежест 650–700.
- **Hover / Focus:** Hover преминава към Pressed Burgundy и допуска 1px повдигане; `:focus-visible` е 3px burgundy outline с 3px offset.
- **Secondary / Ghost:** Secondary е porcelain с strong taupe border; ghost остава прозрачен и използва текстовата йерархия.

### Chips
- **Style:** Кратки pills са porcelain, с 1px taupe border, 999px silhouette и компактен 700 label.
- **State:** Selected filters и market labels могат да станат плътно burgundy; success status остава evidence green.

### Cards / Containers
- **Corner Style:** 8px за listing и choice cards; 12px за grouped surfaces.
- **Background:** Porcelain върху ivory или cream canvas.
- **Shadow Strategy:** Без shadow в покой.
- **Border:** 1px Taupe Line; hover усилва до Strong Taupe Line.
- **Internal Padding:** Основно 16–24px според плътността.

Listing card има `featured`, `catalog` и `compact` варианти, но винаги държи снимката, конкретния остатък, цената/режима, града, продавача, evidence статуса и явна връзка към обявата. Production media е само потребителска снимка; synthetic demo media винаги носи видим етикет „СИНТЕТИЧНА СНИМКА“.

### Inputs / Fields
- **Style:** Porcelain поле, 1px Strong Taupe Line, 8px radius, минимум 48px височина и 12px × 14px padding.
- **Focus:** Burgundy border и видим 3px focus treatment; комбинираните полета използват `focus-within`.
- **Error / Disabled:** Error използва Report Red и Report Blush; disabled намалява opacity, без да губи label-а.

### Navigation
- **Style:** Компактен 68px sticky header върху Ivory Paper; desktop links са тихи walnut labels с 2px burgundy active underline.
- **Mobile:** При 1160px основните links и actions се преместват в disclosure panel с 48px rows и един ясен primary action.
- **Member:** Dark Walnut rail използва 6px items, porcelain active state и хоризонтално пренареждане под 1080px.

### Search

Search shell е 58px porcelain field с 8px radius, leading icon, optional hint и отделен burgundy submit control с минимум 44px target. Compact вариантът намалява shell височината, но не и touch target-а.

### Choice Cards

Wizard options използват 8px cards с Strong Taupe Line. Hover усилва burgundy border; checked state добавя Burgundy Blush; focus обгръща цялата карта, не само native radio или checkbox.

### Named Rules

**The Bottle-plus-Seller Rule.** Marketplace cards never separate the physical bottle facts from seller identity and available evidence.

**The Forty-Four Rule.** Every essential icon, link row and form action keeps at least a 44px interactive target.

**The Evidence Language Rule.** Green означава прегледани доказателства или завършен процес, никога гарантирана автентичност.

## Do's and Don'ts

## Owner-authored product boundaries

The visual system supports a trust-oriented marketplace, not a checkout storefront. Preserve real seller, listing, and evidence context, visible keyboard focus, reduced-motion behavior, and minimum 44px targets. Evidence status must never be styled or worded as an authenticity guarantee; do not invent seller metrics, testimonials, or transaction claims to fill empty states. Design changes must not imply payments, monetisation, boosts, subscriptions, ads, or public profile writes that current product policy does not enable.

### Do:
- **Do** use real user photography as the densest visual material and preserve its character through consistent crop.
- **Do** pair bottle volume and remaining quantity with price or swap mode, seller identity and evidence status.
- **Do** keep surfaces flat with taupe borders and tonal paper layering.
- **Do** reserve burgundy for the dominant decision, selected state or concise marketplace label.
- **Do** keep visible keyboard focus, reduced-motion behavior and at least 44px touch targets.
- **Do** label every synthetic demo image „СИНТЕТИЧНА СНИМКА“.

### Don't:
- **Don't** use gradients, glassmorphism, backdrop blur or ornamental shadows.
- **Don't** use italic headings or introduce a decorative display font.
- **Don't** turn the system into a checkout storefront with cart-first or price-first hero logic.
- **Don't** use evidence green as an authenticity guarantee.
- **Don't** promote a page-specific featured-card topology into a system-wide layout rule.
- **Don't** invent seller metrics, deal counts or testimonials to fill empty states.
