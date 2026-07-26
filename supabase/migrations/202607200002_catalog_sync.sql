begin;

-- Editorial ownership is explicit. Existing rows are deliberately classified as
-- manual/legacy so a catalogue sync can never infer ownership and delete them.
alter table public.brand_aliases
  add column if not exists provenance jsonb not null default '{"source":"manual"}'::jsonb;

alter table public.brand_aliases
  drop constraint if exists brand_alias_provenance_object;
alter table public.brand_aliases
  add constraint brand_alias_provenance_object
  check (jsonb_typeof(provenance) = 'object');

alter table public.brand_collection_memberships
  add column if not exists provenance jsonb not null default '{"source":"manual"}'::jsonb;

alter table public.brand_collection_memberships
  drop constraint if exists brand_membership_provenance_object;
alter table public.brand_collection_memberships
  add constraint brand_membership_provenance_object
  check (jsonb_typeof(provenance) = 'object');

create table public.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  catalog_id text not null,
  schema_version integer not null check (schema_version > 0),
  source_catalog_version integer not null check (source_catalog_version > 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('admin', 'service_role')),
  brand_count integer not null check (brand_count > 0),
  alias_count integer not null check (alias_count >= 0),
  membership_count integer not null check (membership_count > 0),
  completed_at timestamptz not null default now()
);

create index catalog_sync_runs_catalog_idx
  on public.catalog_sync_runs (catalog_id, completed_at desc);

alter table public.catalog_sync_runs enable row level security;

create policy catalog_sync_runs_admin_read on public.catalog_sync_runs
for select to authenticated using (public.is_admin());

comment on table public.catalog_sync_runs is
  'Append-only snapshots for successful atomic editorial catalogue synchronizations.';
comment on column public.brand_aliases.provenance is
  'Ownership metadata. Only rows whose source is editorial_registry are reconciled by catalogue sync.';
comment on column public.brand_collection_memberships.provenance is
  'Ownership metadata. Manual/admin memberships are never deleted by catalogue sync.';

create or replace function public.sync_editorial_catalog(catalog_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  requesting_role text := coalesce(auth.jwt() ->> 'role', '');
  audit_actor_role text;
  catalog_id text;
  schema_version integer;
  source_catalog_version integer;
  last_reviewed date;
  sync_run_id uuid := extensions.gen_random_uuid();
  synced_at timestamptz := clock_timestamp();
  brand_entry jsonb;
  alias_entry jsonb;
  collection_entry jsonb;
  registry_id text;
  parent_registry_id text;
  input_canonical_name text;
  input_canonical_slug text;
  input_normalized_name text;
  input_origin_country_code text;
  resolved_brand_id uuid;
  resolved_parent_id uuid;
  matched_brand_ids uuid[];
  registry_map jsonb := '{}'::jsonb;
  alias_display text;
  normalized_alias text;
  alias_kind public.brand_alias_kind;
  alias_id uuid;
  existing_alias_kind public.brand_alias_kind;
  existing_alias_provenance jsonb;
  current_alias_keys text[];
  collection_names text[] := array['men', 'women', 'unisex', 'niche', 'arabic'];
  collection_counts integer[] := array[80, 80, 80, 80, 15];
  collection_index integer;
  member_registry_id text;
  member_order integer;
  occupied_brand_id uuid;
  occupied_order smallint;
  input_brand_count integer;
  distinct_id_count integer;
  distinct_name_count integer;
  distinct_slug_count integer;
  input_alias_count integer;
  input_membership_count integer := 0;
  final_collection_count integer;
begin
  -- The service key is the normal deployment path. An authenticated request is
  -- accepted only after an explicit, live admin authorization check.
  if requesting_role = 'service_role' then
    audit_actor_role := 'service_role';
  elsif requesting_user is not null and public.is_admin(requesting_user) then
    audit_actor_role := 'admin';
  else
    raise exception 'catalogue synchronization requires service_role or an active admin'
      using errcode = '42501';
  end if;

  if catalog_payload is null or jsonb_typeof(catalog_payload) <> 'object' then
    raise exception 'catalogue payload must be a JSON object' using errcode = '22023';
  end if;

  if jsonb_typeof(catalog_payload -> 'metadata') is distinct from 'object'
     or jsonb_typeof(catalog_payload -> 'brands') is distinct from 'array'
     or jsonb_typeof(catalog_payload -> 'collections') is distinct from 'object'
  then
    raise exception 'catalogue payload is missing metadata, brands or collections'
      using errcode = '22023';
  end if;

  catalog_id := catalog_payload #>> '{metadata,catalogId}';
  if catalog_id is distinct from 'bg-beta-brand-registry' then
    raise exception 'unsupported catalogue id: %', coalesce(catalog_id, '<missing>')
      using errcode = '22023';
  end if;

  if coalesce(catalog_payload ->> 'schemaVersion', '') !~ '^[0-9]+$'
     or (catalog_payload ->> 'schemaVersion')::integer <> 2
  then
    raise exception 'catalogue schemaVersion must be 2' using errcode = '22023';
  end if;
  schema_version := (catalog_payload ->> 'schemaVersion')::integer;

  if coalesce(catalog_payload #>> '{metadata,provenance,sourceCatalogVersion}', '') !~ '^[0-9]+$' then
    raise exception 'metadata.provenance.sourceCatalogVersion must be a positive integer'
      using errcode = '22023';
  end if;
  source_catalog_version :=
    (catalog_payload #>> '{metadata,provenance,sourceCatalogVersion}')::integer;
  if source_catalog_version <= 0 then
    raise exception 'metadata.provenance.sourceCatalogVersion must be positive'
      using errcode = '22023';
  end if;

  begin
    last_reviewed := (catalog_payload #>> '{metadata,lastReviewed}')::date;
  exception when others then
    raise exception 'metadata.lastReviewed must be an ISO date' using errcode = '22007';
  end;
  if last_reviewed is null then
    raise exception 'metadata.lastReviewed must be an ISO date' using errcode = '22007';
  end if;

  -- Serializes catalogue writers without blocking unrelated marketplace writes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog-sync:' || catalog_id, 0)
  );

  select
    count(*),
    count(distinct item ->> 'id'),
    count(distinct public.normalize_catalog_key(item ->> 'canonicalName')),
    count(distinct substring(item ->> 'id' from 7))
  into input_brand_count, distinct_id_count, distinct_name_count, distinct_slug_count
  from jsonb_array_elements(catalog_payload -> 'brands') as input(item);

  if input_brand_count = 0 then
    raise exception 'catalogue must contain at least one brand' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'id') is distinct from 'string'
       or jsonb_typeof(item -> 'canonicalName') is distinct from 'string'
       or jsonb_typeof(item -> 'aliases') is distinct from 'array'
       or (item ->> 'id') !~ '^brand-[a-z0-9]+(?:-[a-z0-9]+)*$'
       or char_length(item ->> 'canonicalName') not between 2 and 80
       or btrim(item ->> 'canonicalName') <> (item ->> 'canonicalName')
       or public.normalize_catalog_key(item ->> 'canonicalName') = ''
       or (
         item ? 'originCountryCode'
         and item -> 'originCountryCode' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'originCountryCode') <> 'string'
           or (item ->> 'originCountryCode') !~ '^[A-Z]{2}$'
         )
       )
  ) then
    raise exception 'one or more catalogue brands have an invalid shape'
      using errcode = '22023';
  end if;

  if input_brand_count <> distinct_id_count
     or input_brand_count <> distinct_name_count
     or input_brand_count <> distinct_slug_count
  then
    raise exception 'brand ids, normalized canonical names and derived slugs must be unique'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
    where item ? 'parentBrandId'
      and item -> 'parentBrandId' <> 'null'::jsonb
      and (
        jsonb_typeof(item -> 'parentBrandId') <> 'string'
        or item ->> 'parentBrandId' = item ->> 'id'
        or not exists (
          select 1
          from jsonb_array_elements(catalog_payload -> 'brands') as parent(parent_item)
          where parent_item ->> 'id' = item ->> 'parentBrandId'
        )
      )
  ) then
    raise exception 'a parentBrandId is invalid, self-referential or missing from the registry'
      using errcode = '23503';
  end if;

  if exists (
    with recursive edges(child_id, parent_id) as (
      select item ->> 'id', item ->> 'parentBrandId'
      from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
      where item ? 'parentBrandId' and item -> 'parentBrandId' <> 'null'::jsonb
    ),
    parent_walk(start_id, current_id, visited, has_cycle) as (
      select child_id, parent_id, array[child_id, parent_id], child_id = parent_id
      from edges
      union all
      select
        parent_walk.start_id,
        edges.parent_id,
        parent_walk.visited || edges.parent_id,
        edges.parent_id = any(parent_walk.visited)
      from parent_walk
      join edges on edges.child_id = parent_walk.current_id
      where not parent_walk.has_cycle
    )
    select 1 from parent_walk where has_cycle
  ) then
    raise exception 'parentBrandId relationships must form an acyclic hierarchy'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(catalog_payload -> 'brands') as brand(item)
    cross join lateral jsonb_array_elements(item -> 'aliases') as aliases(alias_item)
    where jsonb_typeof(alias_item) <> 'object'
       or jsonb_typeof(alias_item -> 'type') is distinct from 'string'
       or jsonb_typeof(alias_item -> 'value') is distinct from 'string'
       or alias_item ->> 'type' not in (
         'searchAlias', 'formerName', 'misspelling', 'transliteration', 'productLine'
       )
       or char_length(alias_item ->> 'value') not between 1 and 100
       or btrim(alias_item ->> 'value') <> alias_item ->> 'value'
       or public.normalize_catalog_key(alias_item ->> 'value') = ''
  ) then
    raise exception 'one or more brand aliases have an invalid value or type'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(catalog_payload -> 'brands') as brand(item)
    cross join lateral jsonb_array_elements(item -> 'aliases') as aliases(alias_item)
    group by item ->> 'id', public.normalize_catalog_key(alias_item ->> 'value')
    having count(*) > 1
  ) then
    raise exception 'normalized aliases must be unique within each brand'
      using errcode = '23505';
  end if;

  select count(*) into final_collection_count
  from jsonb_object_keys(catalog_payload -> 'collections');
  if final_collection_count <> 5 or exists (
    select 1
    from jsonb_object_keys(catalog_payload -> 'collections') as keys(key)
    where key <> all (collection_names)
  ) then
    raise exception 'collections must contain exactly men, women, unisex, niche and arabic'
      using errcode = '22023';
  end if;

  for collection_index in 1..array_length(collection_names, 1) loop
    collection_entry := catalog_payload -> 'collections' -> collection_names[collection_index];
    if jsonb_typeof(collection_entry) is distinct from 'object'
       or jsonb_typeof(collection_entry -> 'brandIds') is distinct from 'array'
       or coalesce(collection_entry ->> 'expectedBrandCount', '') !~ '^[0-9]+$'
       or (collection_entry ->> 'expectedBrandCount')::integer <> collection_counts[collection_index]
       or collection_entry ->> 'value' is distinct from collection_names[collection_index]
       or jsonb_array_length(collection_entry -> 'brandIds') <> collection_counts[collection_index]
    then
      raise exception 'collection % must declare exactly % members',
        collection_names[collection_index], collection_counts[collection_index]
        using errcode = '22023';
    end if;

    if (
      select count(distinct member_id)
      from jsonb_array_elements_text(collection_entry -> 'brandIds') as members(member_id)
    ) <> collection_counts[collection_index] then
      raise exception 'collection % contains duplicate brand ids', collection_names[collection_index]
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(collection_entry -> 'brandIds') as members(member_id)
      where not exists (
        select 1
        from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
        where item ->> 'id' = member_id
      )
    ) then
      raise exception 'collection % references a brand outside the registry',
        collection_names[collection_index] using errcode = '23503';
    end if;

    input_membership_count := input_membership_count + collection_counts[collection_index];
  end loop;

  select count(*) into input_alias_count
  from jsonb_array_elements(catalog_payload -> 'brands') as brand(item)
  cross join lateral jsonb_array_elements(item -> 'aliases') as aliases(alias_item);

  -- Pass 1: resolve a stable database id and synchronize canonical fields. A
  -- pre-existing canonical row may be adopted by exact slug/name match, while
  -- ambiguous matches fail instead of merging unrelated admin data.
  for brand_entry in
    select item from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
  loop
    registry_id := brand_entry ->> 'id';
    input_canonical_name := brand_entry ->> 'canonicalName';
    input_canonical_slug := substring(registry_id from 7);
    input_normalized_name := public.normalize_catalog_key(input_canonical_name);
    input_origin_country_code := brand_entry ->> 'originCountryCode';

    select array_agg(b.id order by b.id::text)
    into matched_brand_ids
    from public.brands b
    where b.status = 'canonical'
      and (
        (
          b.provenance #>> '{editorialRegistry,catalogId}' = catalog_id
          and b.provenance #>> '{editorialRegistry,registryId}' = registry_id
        )
        or (
          b.provenance ->> 'source' = 'editorial_registry'
          and b.provenance ->> 'catalogId' = catalog_id
          and b.provenance ->> 'registryId' = registry_id
        )
      );

    if coalesce(cardinality(matched_brand_ids), 0) > 1 then
      raise exception 'registry id % is attached to multiple canonical brands', registry_id
        using errcode = '23505';
    end if;

    resolved_brand_id := matched_brand_ids[1];
    if resolved_brand_id is null then
      select array_agg(b.id order by b.id::text)
      into matched_brand_ids
      from public.brands b
      where b.status = 'canonical'
        and (b.slug = input_canonical_slug or b.normalized_key = input_normalized_name);

      if coalesce(cardinality(matched_brand_ids), 0) > 1 then
        raise exception 'brand % collides with different canonical slug/name rows', registry_id
          using errcode = '23505';
      end if;
      resolved_brand_id := matched_brand_ids[1];
    end if;

    if resolved_brand_id is null then
      insert into public.brands (
        canonical_name,
        slug,
        status,
        normalized_key,
        provenance
      ) values (
        input_canonical_name,
        input_canonical_slug,
        'canonical',
        input_normalized_name,
        jsonb_build_object(
          'source', 'editorial_registry',
          'registryId', registry_id,
          'registryVersion', schema_version,
          'editorialRegistry', jsonb_build_object(
            'catalogId', catalog_id,
            'registryId', registry_id,
            'schemaVersion', schema_version,
            'sourceCatalogVersion', source_catalog_version,
            'originCountryCode', input_origin_country_code,
            'parentBrandId', brand_entry ->> 'parentBrandId',
            'active', true,
            'lastSyncRunId', sync_run_id,
            'syncedAt', synced_at
          )
        )
      ) returning id into resolved_brand_id;
    else
      update public.brands b
      set canonical_name = input_canonical_name,
          slug = input_canonical_slug,
          status = 'canonical',
          normalized_key = input_normalized_name,
          provenance = b.provenance || jsonb_build_object(
            'editorialRegistry', jsonb_build_object(
              'catalogId', catalog_id,
              'registryId', registry_id,
              'schemaVersion', schema_version,
              'sourceCatalogVersion', source_catalog_version,
              'originCountryCode', input_origin_country_code,
              'parentBrandId', brand_entry ->> 'parentBrandId',
              'active', true,
              'lastSyncRunId', sync_run_id,
              'syncedAt', synced_at
            )
          )
      where b.id = resolved_brand_id;
    end if;

    registry_map := registry_map || jsonb_build_object(registry_id, resolved_brand_id::text);
  end loop;

  -- Pass 2: all parent ids are now resolvable. The registry is authoritative for
  -- parent links of registry members; unrelated brands are untouched.
  for brand_entry in
    select item from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
  loop
    registry_id := brand_entry ->> 'id';
    parent_registry_id := brand_entry ->> 'parentBrandId';
    resolved_brand_id := (registry_map ->> registry_id)::uuid;
    resolved_parent_id := case
      when parent_registry_id is null then null
      else (registry_map ->> parent_registry_id)::uuid
    end;

    update public.brands
    set parent_brand_id = resolved_parent_id
    where id = resolved_brand_id;
  end loop;

  -- Reconcile typed aliases one brand at a time. An editorial row is updated or
  -- removed; a matching manual/admin row is preserved and must already have the
  -- same semantic type.
  for brand_entry in
    select item from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
  loop
    registry_id := brand_entry ->> 'id';
    resolved_brand_id := (registry_map ->> registry_id)::uuid;
    current_alias_keys := array[]::text[];

    for alias_entry in
      select item from jsonb_array_elements(brand_entry -> 'aliases') as aliases(item)
    loop
      alias_display := alias_entry ->> 'value';
      normalized_alias := public.normalize_catalog_key(alias_display);
      current_alias_keys := array_append(current_alias_keys, normalized_alias);
      alias_kind := case alias_entry ->> 'type'
        when 'searchAlias' then 'alternate'::public.brand_alias_kind
        when 'formerName' then 'previous_name'::public.brand_alias_kind
        when 'misspelling' then 'common_misspelling'::public.brand_alias_kind
        when 'transliteration' then 'transliteration'::public.brand_alias_kind
        when 'productLine' then 'product_line'::public.brand_alias_kind
      end;

      select a.id, a.kind, a.provenance
      into alias_id, existing_alias_kind, existing_alias_provenance
      from public.brand_aliases a
      where a.brand_id = resolved_brand_id
        and a.normalized_alias = normalized_alias;

      if found then
        if existing_alias_provenance ->> 'source' = 'editorial_registry'
           and existing_alias_provenance ->> 'catalogId' = catalog_id
        then
          update public.brand_aliases
          set alias = alias_display,
              kind = alias_kind,
              provenance = jsonb_build_object(
                'source', 'editorial_registry',
                'catalogId', catalog_id,
                'registryId', registry_id,
                'schemaVersion', schema_version,
                'sourceCatalogVersion', source_catalog_version,
                'aliasType', alias_entry ->> 'type',
                'lastSyncRunId', sync_run_id,
                'syncedAt', synced_at
              )
          where id = alias_id;
        elsif existing_alias_kind is distinct from alias_kind then
          raise exception 'manual alias % for % conflicts with editorial type %',
            alias_display, registry_id, alias_entry ->> 'type'
            using errcode = '23505';
        end if;
      else
        insert into public.brand_aliases (
          brand_id,
          kind,
          alias,
          normalized_alias,
          provenance
        ) values (
          resolved_brand_id,
          alias_kind,
          alias_display,
          normalized_alias,
          jsonb_build_object(
            'source', 'editorial_registry',
            'catalogId', catalog_id,
            'registryId', registry_id,
            'schemaVersion', schema_version,
            'sourceCatalogVersion', source_catalog_version,
            'aliasType', alias_entry ->> 'type',
            'lastSyncRunId', sync_run_id,
            'syncedAt', synced_at
          )
        );
      end if;
    end loop;

    delete from public.brand_aliases a
    where a.brand_id = resolved_brand_id
      and a.provenance ->> 'source' = 'editorial_registry'
      and a.provenance ->> 'catalogId' = catalog_id
      and not (a.normalized_alias = any(current_alias_keys));
  end loop;

  -- Remove aliases owned by this editorial catalogue from brands retired from
  -- the registry. The brand row itself remains intact for listings and history.
  delete from public.brand_aliases a
  using public.brands b
  where a.brand_id = b.id
    and a.provenance ->> 'source' = 'editorial_registry'
    and a.provenance ->> 'catalogId' = catalog_id
    and not exists (
      select 1
      from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
      where item ->> 'id' = coalesce(
        b.provenance #>> '{editorialRegistry,registryId}',
        b.provenance ->> 'registryId'
      )
    );

  -- Mark retired registry brands instead of deleting or rejecting them. This
  -- keeps foreign keys, seller listings and previous moderation decisions valid.
  update public.brands b
  set parent_brand_id = null,
      provenance = b.provenance || jsonb_build_object(
        'editorialRegistry',
        coalesce(b.provenance -> 'editorialRegistry', '{}'::jsonb) || jsonb_build_object(
          'catalogId', catalog_id,
          'active', false,
          'retiredAt', synced_at,
          'lastSyncRunId', sync_run_id
        )
      )
  where (
      b.provenance #>> '{editorialRegistry,catalogId}' = catalog_id
      or (
        b.provenance ->> 'source' = 'editorial_registry'
        and b.provenance ->> 'catalogId' = catalog_id
        and b.provenance ? 'registryId'
      )
    )
    and not exists (
      select 1
      from jsonb_array_elements(catalog_payload -> 'brands') as input(item)
      where item ->> 'id' = coalesce(
        b.provenance #>> '{editorialRegistry,registryId}',
        b.provenance ->> 'registryId'
      )
    );

  -- Memberships have no independent identity. Delete only rows explicitly owned
  -- by this catalogue, rebuild its exact order, then verify the resulting public
  -- shelves are exactly 80/80/80/80/15. Manual conflicts fail the transaction.
  for collection_index in 1..array_length(collection_names, 1) loop
    delete from public.brand_collection_memberships m
    where m.collection = collection_names[collection_index]::public.brand_collection
      and m.provenance ->> 'source' = 'editorial_registry'
      and m.provenance ->> 'catalogId' = catalog_id;

    collection_entry := catalog_payload -> 'collections' -> collection_names[collection_index];
    for member_registry_id, member_order in
      select member_id, ordinality::integer
      from jsonb_array_elements_text(collection_entry -> 'brandIds')
        with ordinality as members(member_id, ordinality)
    loop
      resolved_brand_id := (registry_map ->> member_registry_id)::uuid;

      select m.display_order
      into occupied_order
      from public.brand_collection_memberships m
      where m.brand_id = resolved_brand_id
        and m.collection = collection_names[collection_index]::public.brand_collection;

      if found then
        if occupied_order <> member_order then
          raise exception 'manual membership for % in % occupies order %, expected %',
            member_registry_id, collection_names[collection_index], occupied_order, member_order
            using errcode = '23505';
        end if;
        continue;
      end if;

      select m.brand_id
      into occupied_brand_id
      from public.brand_collection_memberships m
      where m.collection = collection_names[collection_index]::public.brand_collection
        and m.display_order = member_order;

      if found then
        raise exception 'manual membership occupies % position %',
          collection_names[collection_index], member_order using errcode = '23505';
      end if;

      insert into public.brand_collection_memberships (
        brand_id,
        collection,
        display_order,
        reviewed_at,
        provenance
      ) values (
        resolved_brand_id,
        collection_names[collection_index]::public.brand_collection,
        member_order,
        last_reviewed,
        jsonb_build_object(
          'source', 'editorial_registry',
          'catalogId', catalog_id,
          'registryId', member_registry_id,
          'schemaVersion', schema_version,
          'sourceCatalogVersion', source_catalog_version,
          'lastSyncRunId', sync_run_id,
          'syncedAt', synced_at
        )
      );
    end loop;

    select count(*) into final_collection_count
    from public.brand_collection_memberships m
    where m.collection = collection_names[collection_index]::public.brand_collection;

    if final_collection_count <> collection_counts[collection_index] then
      raise exception 'final collection % has % rows; exactly % are required',
        collection_names[collection_index], final_collection_count,
        collection_counts[collection_index] using errcode = '23505';
    end if;
  end loop;

  insert into public.catalog_sync_runs (
    id,
    catalog_id,
    schema_version,
    source_catalog_version,
    payload_sha256,
    payload,
    actor_id,
    actor_role,
    brand_count,
    alias_count,
    membership_count,
    completed_at
  ) values (
    sync_run_id,
    catalog_id,
    schema_version,
    source_catalog_version,
    encode(extensions.digest(pg_catalog.convert_to(catalog_payload::text, 'UTF8'), 'sha256'), 'hex'),
    catalog_payload,
    requesting_user,
    audit_actor_role,
    input_brand_count,
    input_alias_count,
    input_membership_count,
    synced_at
  );

  return jsonb_build_object(
    'syncRunId', sync_run_id,
    'catalogId', catalog_id,
    'schemaVersion', schema_version,
    'brands', input_brand_count,
    'aliases', input_alias_count,
    'memberships', input_membership_count,
    'completedAt', synced_at
  );
end;
$$;

comment on function public.sync_editorial_catalog(jsonb) is
  'Validates and atomically reconciles the provenance-owned Bulgarian editorial brand catalogue.';

revoke all on public.catalog_sync_runs from public, anon, authenticated;
grant select on public.catalog_sync_runs to authenticated;
grant select on public.catalog_sync_runs to service_role;

revoke execute on function public.sync_editorial_catalog(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_editorial_catalog(jsonb) to service_role;
grant execute on function public.sync_editorial_catalog(jsonb) to authenticated;

commit;
