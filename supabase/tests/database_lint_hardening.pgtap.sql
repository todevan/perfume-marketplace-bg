begin;

-- Hosted CLI tests connect through a temporary login role. Assume the linked
-- project's postgres role so test extensions are visible consistently.
set local role postgres;
create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(12);

select ok(
  to_regprocedure('public.sync_editorial_catalog(jsonb)') is not null,
  'editorial catalogue sync function still exists'
);
select ok(
  to_regprocedure('public.reject_listing_upload(uuid,text)') is not null,
  'upload rejection function still exists'
);

select is(
  strpos(
    pg_get_functiondef('public.sync_editorial_catalog(jsonb)'::regprocedure),
    'collection_index integer;'
  ),
  0,
  'catalogue sync no longer declares a shadowed loop variable'
);
select ok(
  strpos(
    pg_get_functiondef('public.sync_editorial_catalog(jsonb)'::regprocedure),
    'a.normalized_alias = normalized_alias_value'
  ) > 0,
  'catalogue sync uses the renamed variable in the alias comparison'
);
select ok(
  strpos(
    pg_get_functiondef('public.sync_editorial_catalog(jsonb)'::regprocedure),
    'normalized_alias_value'
  ) > 0,
  'catalogue sync uses a non-conflicting normalized alias variable'
);

select ok(
  strpos(
    pg_get_functiondef('public.reject_listing_upload(uuid,text)'::regprocedure),
    'coalesce(reject_listing_upload.rejection_code'
  ) > 0,
  'upload rejection validates the qualified parameter'
);
select ok(
  strpos(
    pg_get_functiondef('public.reject_listing_upload(uuid,text)'::regprocedure),
    'btrim(reject_listing_upload.rejection_code)'
  ) > 0,
  'upload rejection writes the qualified parameter'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reject_listing_upload(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reject_listing_upload(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.reject_listing_upload(uuid,text)',
    'execute'
  ),
  'upload rejection preserves its service-role-only execution contract'
);
select is(
  pg_get_function_arguments(
    'public.reject_listing_upload(uuid,text)'::regprocedure
  ),
  'target_upload_id uuid, rejection_code text',
  'upload rejection preserves its named RPC arguments'
);
select ok(
  coalesce((
    select p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
        where split_part(setting, '=', 1) = 'search_path'
          and btrim(split_part(setting, '=', 2), '"') = ''
      )
    from pg_proc p
    where p.oid = 'public.reject_listing_upload(uuid,text)'::regprocedure
  ), false),
  'upload rejection remains security-definer with an empty search path'
);

select is_empty(
  $lint$
    select format('%s:%s:%s', level, sqlstate, message)
    from plpgsql_check_function_tb(
      'public.sync_editorial_catalog(jsonb)'::regprocedure,
      fatal_errors := false,
      other_warnings := true,
      extra_warnings := true
    )
    where level in ('error', 'warning', 'warning extra')
  $lint$,
  'catalogue sync has no PL/pgSQL errors or warning-level findings'
);
select is_empty(
  $lint$
    select format('%s:%s:%s', level, sqlstate, message)
    from plpgsql_check_function_tb(
      'public.reject_listing_upload(uuid,text)'::regprocedure,
      fatal_errors := false,
      other_warnings := true,
      extra_warnings := true
    )
    where level in ('error', 'warning', 'warning extra')
  $lint$,
  'upload rejection has no PL/pgSQL errors or warning-level findings'
);

select * from finish();
rollback;
