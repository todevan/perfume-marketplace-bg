begin;

-- Keep the earlier migrations immutable. Rebuild the two affected functions
-- from PostgreSQL's canonical definitions and patch only source fragments that
-- are asserted to occur exactly once. Any unexpected upstream definition makes
-- this migration fail closed instead of silently changing unrelated behavior.
do $migration$
declare
  function_definition text;
  needles text[] := array[
    E'  collection_index integer;\n',
    E'  normalized_alias text;\n',
    'normalized_alias := public.normalize_catalog_key(alias_display);',
    'current_alias_keys := array_append(current_alias_keys, normalized_alias);',
    'and a.normalized_alias = normalized_alias;',
    E'          alias_display,\n          normalized_alias,\n          jsonb_build_object(',
    E'  occupied_brand_id uuid;\n',
    E'      select m.brand_id\n      into occupied_brand_id\n      from public.brand_collection_memberships m\n      where m.collection = collection_names[collection_index]::public.brand_collection\n        and m.display_order = member_order;'
  ];
  replacements text[] := array[
    '',
    E'  normalized_alias_value text;\n',
    'normalized_alias_value := public.normalize_catalog_key(alias_display);',
    'current_alias_keys := array_append(current_alias_keys, normalized_alias_value);',
    'and a.normalized_alias = normalized_alias_value;',
    E'          alias_display,\n          normalized_alias_value,\n          jsonb_build_object(',
    '',
    E'      perform 1\n      from public.brand_collection_memberships m\n      where m.collection = collection_names[collection_index]::public.brand_collection\n        and m.display_order = member_order;'
  ];
  occurrence_count integer;
begin
  select pg_get_functiondef(
    'public.sync_editorial_catalog(jsonb)'::regprocedure
  ) into function_definition;

  if function_definition is null then
    raise exception 'sync_editorial_catalog definition is missing';
  end if;

  for patch_index in 1..array_length(needles, 1) loop
    occurrence_count := (
      length(function_definition)
      - length(replace(function_definition, needles[patch_index], ''))
    ) / length(needles[patch_index]);
    if occurrence_count <> 1 then
      raise exception
        'expected source patch % exactly once, found %',
        patch_index,
        occurrence_count;
    end if;
    function_definition := replace(
      function_definition,
      needles[patch_index],
      replacements[patch_index]
    );
  end loop;

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  needle text;
  replacement text;
  occurrence_count integer;
begin
  select pg_get_functiondef(
    'public.reject_listing_upload(uuid,text)'::regprocedure
  ) into function_definition;

  if function_definition is null then
    raise exception 'reject_listing_upload definition is missing';
  end if;

  needle := $needle$btrim(coalesce(rejection_code, ''))$needle$;
  replacement :=
    $replacement$btrim(coalesce(reject_listing_upload.rejection_code, ''))$replacement$;
  occurrence_count := (
    length(function_definition) - length(replace(function_definition, needle, ''))
  ) / length(needle);
  if occurrence_count <> 1 then
    raise exception
      'expected one rejection-code validation reference, found %',
      occurrence_count;
  end if;
  function_definition := replace(function_definition, needle, replacement);

  needle := 'rejection_code = btrim(rejection_code)';
  replacement :=
    'rejection_code = btrim(reject_listing_upload.rejection_code)';
  occurrence_count := (
    length(function_definition) - length(replace(function_definition, needle, ''))
  ) / length(needle);
  if occurrence_count <> 1 then
    raise exception
      'expected one rejection-code update reference, found %',
      occurrence_count;
  end if;
  function_definition := replace(function_definition, needle, replacement);

  execute function_definition;
end;
$migration$;

alter function public.reject_listing_upload(uuid, text) security definer;
alter function public.reject_listing_upload(uuid, text) set search_path = '';
revoke execute on function public.reject_listing_upload(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_listing_upload(uuid, text)
  to service_role;

commit;
