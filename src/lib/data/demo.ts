export type DemoListing = {
  id: string;
  slug: string;
  brand: string;
  perfume: string;
  concentration: 'EDT' | 'EDP' | 'Parfum' | 'Extrait';
  mode: 'Продажба' | 'Размяна' | 'Продажба или размяна';
  price?: number;
  volumeMl: number;
  remainingMl: number;
  city: string;
  seller: string;
  sellerKind: 'Частно лице' | 'Проверен търговец';
  verifiedEvidence?: boolean;
  sponsored?: boolean;
  audience: 'Мъжки' | 'Дамски' | 'Унисекс';
  segments: Array<'Нишови' | 'Арабски'>;
  visual: {
    glass: string;
    liquid: string;
    cap: string;
    backdrop: string;
    shape: 'square' | 'round' | 'tall' | 'wide';
  };
  description: string;
  batchCode?: string;
  fragranticaUrl?: string;
};

export const demoListings: DemoListing[] = [
  {
    id: 'lst_01',
    slug: 'dior-sauvage-edp-100ml',
    brand: 'Dior',
    perfume: 'Sauvage',
    concentration: 'EDP',
    mode: 'Продажба',
    price: 76,
    volumeMl: 100,
    remainingMl: 82,
    city: 'София',
    seller: 'north_notes',
    sellerKind: 'Частно лице',
    verifiedEvidence: true,
    audience: 'Мъжки',
    segments: [],
    visual: { glass: '#263743', liquid: '#16242c', cap: '#11191e', backdrop: '#d7d8d5', shape: 'square' },
    description: 'Пазен на тъмно и хладно. Купуван от оторизиран магазин, с оригинална кутия.',
    batchCode: '3K01',
    fragranticaUrl: 'https://www.fragrantica.com/perfume/Dior/Sauvage-Eau-de-Parfum-48100.html'
  },
  {
    id: 'lst_02',
    slug: 'lattafa-khamrah-edp-100ml',
    brand: 'Lattafa Perfumes',
    perfume: 'Khamrah',
    concentration: 'EDP',
    mode: 'Продажба или размяна',
    price: 31,
    volumeMl: 100,
    remainingMl: 96,
    city: 'Пловдив',
    seller: 'amber_room',
    sellerKind: 'Частно лице',
    sponsored: true,
    audience: 'Унисекс',
    segments: ['Арабски'],
    visual: { glass: '#a66a2c', liquid: '#6b3518', cap: '#bd8845', backdrop: '#ead4b4', shape: 'square' },
    description: 'Само няколко впръсквания. Търся свеж нишов аромат или продажба.'
  },
  {
    id: 'lst_03',
    slug: 'tom-ford-oud-wood-edp-50ml',
    brand: 'Tom Ford',
    perfume: 'Oud Wood',
    concentration: 'EDP',
    mode: 'Размяна',
    volumeMl: 50,
    remainingMl: 37,
    city: 'Варна',
    seller: 'olfactive_journal',
    sellerKind: 'Частно лице',
    verifiedEvidence: true,
    audience: 'Унисекс',
    segments: ['Нишови'],
    visual: { glass: '#32261f', liquid: '#1e1713', cap: '#19110e', backdrop: '#cbb6a4', shape: 'wide' },
    description: 'Размяна за друг дървесен аромат. Нивото е показано ясно на снимките.'
  },
  {
    id: 'lst_04',
    slug: 'chanel-coco-mademoiselle-edp-100ml',
    brand: 'Chanel',
    perfume: 'Coco Mademoiselle',
    concentration: 'EDP',
    mode: 'Продажба',
    price: 112,
    volumeMl: 100,
    remainingMl: 91,
    city: 'София',
    seller: 'Maison Parfum',
    sellerKind: 'Проверен търговец',
    verifiedEvidence: true,
    audience: 'Дамски',
    segments: [],
    visual: { glass: '#e4c4b5', liquid: '#d99d85', cap: '#d7c8bf', backdrop: '#f1ded4', shape: 'square' },
    description: 'Демонстрационен флакон от магазин, пълен комплект и документиран произход.'
  },
  {
    id: 'lst_05',
    slug: 'maison-francis-kurkdjian-baccarat-rouge-540',
    brand: 'Maison Francis Kurkdjian',
    perfume: 'Baccarat Rouge 540',
    concentration: 'Extrait',
    mode: 'Продажба или размяна',
    price: 245,
    volumeMl: 70,
    remainingMl: 48,
    city: 'Бургас',
    seller: 'salt_and_amber',
    sellerKind: 'Частно лице',
    audience: 'Унисекс',
    segments: ['Нишови'],
    visual: { glass: '#a53232', liquid: '#701d21', cap: '#c1a06b', backdrop: '#ead2c8', shape: 'tall' },
    description: 'Личен флакон с доказателство за покупка. Приемам само конкретни нишови предложения.'
  },
  {
    id: 'lst_06',
    slug: 'ysl-libre-edp-90ml',
    brand: 'Yves Saint Laurent',
    perfume: 'Libre',
    concentration: 'EDP',
    mode: 'Продажба',
    price: 68,
    volumeMl: 90,
    remainingMl: 59,
    city: 'Русе',
    seller: 'iris_archive',
    sellerKind: 'Частно лице',
    audience: 'Дамски',
    segments: [],
    visual: { glass: '#c48d62', liquid: '#a9623f', cap: '#1f1714', backdrop: '#dfc7b7', shape: 'wide' },
    description: 'Без кутия, но с четири подробни снимки на флакона, кода и нивото.'
  },
  {
    id: 'lst_07',
    slug: 'amouage-interlude-man-edp-100ml',
    brand: 'Amouage',
    perfume: 'Interlude Man',
    concentration: 'EDP',
    mode: 'Размяна',
    volumeMl: 100,
    remainingMl: 88,
    city: 'Стара Загора',
    seller: 'resin_club',
    sellerKind: 'Частно лице',
    verifiedEvidence: true,
    audience: 'Мъжки',
    segments: ['Нишови'],
    visual: { glass: '#244c68', liquid: '#16384e', cap: '#b99b5d', backdrop: '#d2dbe0', shape: 'round' },
    description: 'Търся Amouage Reflection или Memo African Leather с доплащане при нужда.'
  },
  {
    id: 'lst_08',
    slug: 'xerjoff-erba-pura-edp-100ml',
    brand: 'Xerjoff',
    perfume: 'Erba Pura',
    concentration: 'EDP',
    mode: 'Продажба',
    price: 134,
    volumeMl: 100,
    remainingMl: 74,
    city: 'София',
    seller: 'Atelier 11',
    sellerKind: 'Проверен търговец',
    verifiedEvidence: true,
    audience: 'Унисекс',
    segments: ['Нишови'],
    visual: { glass: '#6e5c8f', liquid: '#4c3a70', cap: '#b5a365', backdrop: '#dcd4e5', shape: 'round' },
    description: 'Проверен търговец, издаваме документ за покупка. Изпращане с преглед.'
  }
];

export const categories = [
  { slug: 'men', label: 'Мъжки', count: 80, note: 'Свежи, дървесни и класически композиции', glyph: 'M' },
  { slug: 'women', label: 'Дамски', count: 80, note: 'Флорални, гурме и модерни подписи', glyph: 'Д' },
  { slug: 'unisex', label: 'Унисекс', count: 80, note: 'Аромати отвъд традиционните категории', glyph: 'У' },
  { slug: 'niche', label: 'Нишови', count: 80, note: 'Авторски къщи и необичайни суровини', glyph: 'Н' },
  { slug: 'arabic', label: 'Арабски', count: 15, note: 'Подбрани къщи от Близкия изток', glyph: 'ع' }
];

export const wantedItems = [
  { perfume: 'Guerlain · L’Homme Idéal Cologne', budget: 95, user: 'citrus_hunter', city: 'София', age: 'преди 2 ч.' },
  { perfume: 'Nishane · Ani X', budget: 135, user: 'vanilla_map', city: 'Пловдив', age: 'преди 5 ч.' },
  { perfume: 'Dior · Homme Parfum', budget: 150, user: 'iris_archive', city: 'Русе', age: 'вчера' }
];

export function getListing(slug: string) {
  return demoListings.find((listing) => listing.slug === slug);
}

export function remainingPercent(listing: DemoListing) {
  return Math.round((listing.remainingMl / listing.volumeMl) * 100);
}

export function formatPrice(price?: number) {
  return price == null ? 'Само размяна' : new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' }).format(price);
}
