#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const catalogPath = resolveInputPath(
  process.argv[2] ?? resolve(projectRoot, 'catalog', 'brand-categories.json'),
);
const catalog = readJson(catalogPath, 'catalog');
const declaredSchemaPath =
  typeof catalog.$schema === 'string' && catalog.$schema.length > 0
    ? resolve(dirname(catalogPath), catalog.$schema)
    : resolve(projectRoot, 'catalog', 'brand-categories.schema.json');
const schemaPath = resolveInputPath(process.argv[3] ?? declaredSchemaPath);
const schema = readJson(schemaPath, 'schema');

const errors = [];
const aliasTypes = [
  'searchAlias',
  'formerName',
  'misspelling',
  'transliteration',
  'productLine',
];
const collectionContracts = {
  men: { label: 'Мъжки', dimension: 'audience', value: 'men', count: 80 },
  women: { label: 'Дамски', dimension: 'audience', value: 'women', count: 80 },
  unisex: { label: 'Унисекс', dimension: 'audience', value: 'unisex', count: 80 },
  niche: { label: 'Нишови', dimension: 'segment', value: 'niche', count: 80 },
  arabic: { label: 'Арабски', dimension: 'segment', value: 'arabic', count: 15 },
};
const brandIdPattern = /^brand-[a-z0-9]+(?:-[a-z0-9]+)*$/;

validateSchemaContract();
validateTopLevel();
const registry = validateBrands();
const collectionResults = validateCollections(registry);
validateOtherBrandPolicy();

if (errors.length > 0) {
  console.error(`Catalog validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  const aliasSummary = aliasTypes
    .map((type) => `${type}: ${registry.aliasCounts.get(type) ?? 0}`)
    .join(', ');

  console.log('Catalog validation passed.');
  console.log(`- Registry brands: ${registry.byId.size}`);
  console.log(`- Typed aliases: ${registry.aliasTotal} (${aliasSummary})`);
  console.log(`- Parent-brand links: ${registry.parentLinkCount}`);
  for (const [key, result] of Object.entries(collectionResults)) {
    console.log(`- ${key}: ${result.actual}/${result.expected} brand IDs`);
  }
  console.log('- All collection IDs resolve; all registry brands are discoverable.');
}

function resolveInputPath(input) {
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Unable to read ${label} JSON at ${path}: ${error.message}`);
    process.exit(1);
  }
}

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkExactKeys(value, required, optional, path) {
  if (!isRecord(value)) {
    check(false, `${path} must be an object.`);
    return false;
  }

  const permitted = new Set([...required, ...optional]);
  for (const key of required) {
    check(Object.hasOwn(value, key), `${path}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    check(permitted.has(key), `${path}.${key} is not allowed.`);
  }
  return true;
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeSearchKey(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/&/gu, ' and ')
    .toLocaleLowerCase('bg-BG')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function validateSchemaContract() {
  check(
    schema.$schema === 'https://json-schema.org/draft/2020-12/schema',
    'Schema must declare JSON Schema draft 2020-12.',
  );
  check(
    schema?.properties?.schemaVersion?.const === 2,
    'Schema must lock schemaVersion to 2.',
  );
  check(
    schema?.$defs?.brandId?.pattern === '^brand-[a-z0-9]+(?:-[a-z0-9]+)*$',
    'Schema brandId pattern is missing or does not match the registry contract.',
  );
  check(
    arraysEqual(schema?.$defs?.alias?.properties?.type?.enum, aliasTypes),
    'Schema alias type enum must match metadata.supportedAliasTypes.',
  );
  check(
    schema?.$defs?.collectionBase80?.properties?.brandIds?.minItems === 80 &&
      schema?.$defs?.collectionBase80?.properties?.brandIds?.maxItems === 80,
    'Schema must require exactly 80 brand IDs for the four main collections.',
  );
  check(
    schema?.$defs?.collectionBase15?.properties?.brandIds?.minItems === 15 &&
      schema?.$defs?.collectionBase15?.properties?.brandIds?.maxItems === 15,
    'Schema must require exactly 15 brand IDs for the Arabic collection.',
  );
}

function validateTopLevel() {
  if (
    !checkExactKeys(
      catalog,
      ['$schema', 'schemaVersion', 'metadata', 'otherBrandPolicy', 'brands', 'collections'],
      [],
      'catalog',
    )
  ) {
    return;
  }

  check(catalog.$schema === './brand-categories.schema.json', 'catalog.$schema is invalid.');
  check(catalog.schemaVersion === 2, 'catalog.schemaVersion must be 2.');

  const metadata = catalog.metadata;
  if (
    !checkExactKeys(
      metadata,
      [
        'catalogId',
        'locale',
        'lastReviewed',
        'reviewCycle',
        'defaultCurrency',
        'selectionPolicy',
        'collectionSemantics',
        'supportedAliasTypes',
        'normalization',
        'provenance',
      ],
      [],
      'catalog.metadata',
    )
  ) {
    return;
  }

  check(metadata.catalogId === 'bg-beta-brand-registry', 'metadata.catalogId is invalid.');
  check(metadata.locale === 'bg-BG', 'metadata.locale must be bg-BG.');
  check(metadata.defaultCurrency === 'EUR', 'metadata.defaultCurrency must be EUR.');
  check(
    /^\d{4}-\d{2}-\d{2}$/u.test(metadata.lastReviewed) &&
      !Number.isNaN(Date.parse(`${metadata.lastReviewed}T00:00:00Z`)),
    'metadata.lastReviewed must be a valid ISO date.',
  );
  check(
    ['monthly', 'quarterly', 'semiannual', 'annual'].includes(metadata.reviewCycle),
    'metadata.reviewCycle is invalid.',
  );
  check(
    typeof metadata.selectionPolicy === 'string' && metadata.selectionPolicy.length >= 20,
    'metadata.selectionPolicy is missing or too short.',
  );
  check(
    typeof metadata.collectionSemantics === 'string' &&
      metadata.collectionSemantics.length >= 20,
    'metadata.collectionSemantics is missing or too short.',
  );
  check(
    arraysEqual(metadata.supportedAliasTypes, aliasTypes),
    'metadata.supportedAliasTypes must contain the five supported types in canonical order.',
  );

  const normalization = metadata.normalization;
  if (
    checkExactKeys(
      normalization,
      ['unicodeForm', 'caseFold', 'collapseWhitespace', 'stripDiacriticsForSearch'],
      [],
      'catalog.metadata.normalization',
    )
  ) {
    check(normalization.unicodeForm === 'NFKC', 'normalization.unicodeForm must be NFKC.');
    check(normalization.caseFold === true, 'normalization.caseFold must be true.');
    check(
      normalization.collapseWhitespace === true,
      'normalization.collapseWhitespace must be true.',
    );
    check(
      normalization.stripDiacriticsForSearch === true,
      'normalization.stripDiacriticsForSearch must be true.',
    );
  }

  const provenance = metadata.provenance;
  if (
    checkExactKeys(
      provenance,
      ['method', 'sourceCatalogVersion', 'externalImports', 'scraping'],
      [],
      'catalog.metadata.provenance',
    )
  ) {
    check(
      provenance.method === 'manual_editorial_curation',
      'metadata.provenance.method must be manual_editorial_curation.',
    );
    check(
      provenance.sourceCatalogVersion === 1,
      'metadata.provenance.sourceCatalogVersion must be 1.',
    );
    check(provenance.externalImports === false, 'External catalogue imports are prohibited.');
    check(provenance.scraping === false, 'Catalogue scraping is prohibited.');
  }
}

function validateBrands() {
  const byId = new Map();
  const canonicalNames = new Map();
  const searchKeys = new Map();
  const aliasCounts = new Map(aliasTypes.map((type) => [type, 0]));
  let aliasTotal = 0;
  let parentLinkCount = 0;

  check(Array.isArray(catalog.brands), 'catalog.brands must be an array.');
  if (!Array.isArray(catalog.brands)) {
    return { byId, aliasCounts, aliasTotal, parentLinkCount };
  }

  for (const [index, brand] of catalog.brands.entries()) {
    const path = `catalog.brands[${index}]`;
    if (
      !checkExactKeys(
        brand,
        ['id', 'canonicalName', 'aliases'],
        ['parentBrandId', 'originCountryCode'],
        path,
      )
    ) {
      continue;
    }

    check(typeof brand.id === 'string' && brandIdPattern.test(brand.id), `${path}.id is invalid.`);
    check(!byId.has(brand.id), `${path}.id duplicates ${brand.id}.`);
    if (typeof brand.id === 'string' && !byId.has(brand.id)) {
      byId.set(brand.id, brand);
    }

    check(
      typeof brand.canonicalName === 'string' &&
        brand.canonicalName.trim() === brand.canonicalName &&
        brand.canonicalName.length > 0 &&
        brand.canonicalName.length <= 120,
      `${path}.canonicalName must be a trimmed non-empty string of at most 120 characters.`,
    );
    if (typeof brand.canonicalName === 'string') {
      check(
        !canonicalNames.has(brand.canonicalName),
        `${path}.canonicalName duplicates ${brand.canonicalName}.`,
      );
      canonicalNames.set(brand.canonicalName, brand.id);
      registerSearchKey(searchKeys, normalizeSearchKey(brand.canonicalName), brand.id, path);
    }

    check(Array.isArray(brand.aliases), `${path}.aliases must be an array.`);
    const exactAliases = new Set();
    const normalizedAliases = new Map();
    if (Array.isArray(brand.aliases)) {
      for (const [aliasIndex, alias] of brand.aliases.entries()) {
        const aliasPath = `${path}.aliases[${aliasIndex}]`;
        if (!checkExactKeys(alias, ['type', 'value'], [], aliasPath)) {
          continue;
        }
        check(aliasTypes.includes(alias.type), `${aliasPath}.type is unsupported.`);
        check(
          typeof alias.value === 'string' &&
            alias.value.trim() === alias.value &&
            alias.value.length > 0 &&
            alias.value.length <= 120,
          `${aliasPath}.value must be a trimmed non-empty string of at most 120 characters.`,
        );
        const exactKey = `${alias.type}\u0000${alias.value}`;
        check(!exactAliases.has(exactKey), `${aliasPath} duplicates another typed alias.`);
        exactAliases.add(exactKey);
        if (aliasTypes.includes(alias.type)) {
          aliasCounts.set(alias.type, (aliasCounts.get(alias.type) ?? 0) + 1);
        }
        if (typeof alias.value === 'string') {
          const normalizedAlias = normalizeSearchKey(alias.value);
          const existingAliasPath = normalizedAliases.get(normalizedAlias);
          check(
            existingAliasPath === undefined,
            `${aliasPath} normalizes to the same key as ${existingAliasPath}: ${normalizedAlias}.`,
          );
          if (existingAliasPath === undefined) {
            normalizedAliases.set(normalizedAlias, aliasPath);
          }
          registerSearchKey(searchKeys, normalizedAlias, brand.id, aliasPath);
        }
        aliasTotal += 1;
      }
    }

    if (Object.hasOwn(brand, 'parentBrandId')) {
      check(
        typeof brand.parentBrandId === 'string' && brandIdPattern.test(brand.parentBrandId),
        `${path}.parentBrandId is invalid.`,
      );
      check(brand.parentBrandId !== brand.id, `${path}.parentBrandId cannot reference itself.`);
      parentLinkCount += 1;
    }
    if (Object.hasOwn(brand, 'originCountryCode')) {
      check(
        typeof brand.originCountryCode === 'string' && /^[A-Z]{2}$/u.test(brand.originCountryCode),
        `${path}.originCountryCode must be an ISO 3166-1 alpha-2 code.`,
      );
    }
  }

  for (const brand of byId.values()) {
    if (brand.parentBrandId) {
      check(
        byId.has(brand.parentBrandId),
        `${brand.id}.parentBrandId does not resolve: ${brand.parentBrandId}.`,
      );
    }
  }
  validateParentCycles(byId);

  return { byId, aliasCounts, aliasTotal, parentLinkCount };
}

function registerSearchKey(searchKeys, key, brandId, path) {
  if (!key) {
    return;
  }
  const existingBrandId = searchKeys.get(key);
  check(
    existingBrandId === undefined || existingBrandId === brandId,
    `${path} creates search-key collision with ${existingBrandId}: ${key}.`,
  );
  if (existingBrandId === undefined) {
    searchKeys.set(key, brandId);
  }
}

function validateParentCycles(byId) {
  for (const brand of byId.values()) {
    const seen = new Set([brand.id]);
    let parentId = brand.parentBrandId;
    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) {
        check(false, `Parent-brand cycle detected from ${brand.id} through ${parentId}.`);
        break;
      }
      seen.add(parentId);
      parentId = byId.get(parentId).parentBrandId;
    }
  }
}

function validateCollections(registry) {
  const results = {};
  const usage = new Map([...registry.byId.keys()].map((id) => [id, 0]));

  check(isRecord(catalog.collections), 'catalog.collections must be an object.');
  if (!isRecord(catalog.collections)) {
    return results;
  }

  const actualKeys = Object.keys(catalog.collections);
  check(
    arraysEqual(actualKeys, Object.keys(collectionContracts)),
    'catalog.collections must contain only men, women, unisex, niche, and arabic in canonical order.',
  );

  for (const [key, contract] of Object.entries(collectionContracts)) {
    const collection = catalog.collections[key];
    const path = `catalog.collections.${key}`;
    if (
      !checkExactKeys(
        collection,
        ['label', 'dimension', 'value', 'expectedBrandCount', 'brandIds'],
        [],
        path,
      )
    ) {
      results[key] = { actual: 0, expected: contract.count };
      continue;
    }

    check(collection.label === contract.label, `${path}.label must be ${contract.label}.`);
    check(
      collection.dimension === contract.dimension,
      `${path}.dimension must be ${contract.dimension}.`,
    );
    check(collection.value === contract.value, `${path}.value must be ${contract.value}.`);
    check(
      collection.expectedBrandCount === contract.count,
      `${path}.expectedBrandCount must be ${contract.count}.`,
    );
    check(Array.isArray(collection.brandIds), `${path}.brandIds must be an array.`);

    const ids = Array.isArray(collection.brandIds) ? collection.brandIds : [];
    results[key] = { actual: ids.length, expected: contract.count };
    check(ids.length === contract.count, `${path}.brandIds must contain exactly ${contract.count} IDs.`);
    check(new Set(ids).size === ids.length, `${path}.brandIds contains duplicate IDs.`);

    for (const [index, id] of ids.entries()) {
      check(
        typeof id === 'string' && brandIdPattern.test(id),
        `${path}.brandIds[${index}] is not a valid brand ID.`,
      );
      check(registry.byId.has(id), `${path}.brandIds[${index}] does not resolve: ${id}.`);
      if (usage.has(id)) {
        usage.set(id, usage.get(id) + 1);
      }
    }
  }

  for (const [id, count] of usage.entries()) {
    check(count > 0, `Registry brand ${id} is not present in any editorial collection.`);
  }

  const arabicIds = catalog.collections?.arabic?.brandIds;
  if (Array.isArray(arabicIds)) {
    for (const id of arabicIds) {
      const brand = registry.byId.get(id);
      check(
        brand?.originCountryCode === 'AE',
        `Arabic collection brand ${id} must preserve its AE origin metadata.`,
      );
    }
  }

  return results;
}

function validateOtherBrandPolicy() {
  const policy = catalog.otherBrandPolicy;
  if (
    !checkExactKeys(
      policy,
      [
        'enabled',
        'label',
        'minLength',
        'maxLength',
        'publication',
        'moderationState',
        'captureFields',
        'auditTrailRequired',
      ],
      [],
      'catalog.otherBrandPolicy',
    )
  ) {
    return;
  }

  check(policy.enabled === true, 'otherBrandPolicy.enabled must be true.');
  check(policy.label === 'Други', 'otherBrandPolicy.label must be Други.');
  check(
    Number.isInteger(policy.minLength) && Number.isInteger(policy.maxLength),
    'otherBrandPolicy length limits must be integers.',
  );
  check(
    policy.minLength >= 1 && policy.maxLength <= 200 && policy.minLength < policy.maxLength,
    'otherBrandPolicy length limits are invalid.',
  );
  check(policy.publication === 'immediate', 'Other-brand publication must be immediate.');
  check(
    policy.moderationState === 'pending_canonicalization',
    'Other-brand moderation state must be pending_canonicalization.',
  );
  check(
    arraysEqual(policy.captureFields, [
      'originalInput',
      'normalizedKey',
      'suggestedBrandId',
      'provenance',
      'auditTrail',
    ]),
    'otherBrandPolicy.captureFields is incomplete or out of order.',
  );
  check(policy.auditTrailRequired === true, 'Other-brand audit trail must be required.');
}
