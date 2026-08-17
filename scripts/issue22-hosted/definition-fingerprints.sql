with
schema_rows as (
  select
    n.nspname as sort_key,
    jsonb_build_object(
      'schema', n.nspname,
      'owner', pg_catalog.pg_get_userbyid(n.nspowner),
      'acl_is_null', n.nspacl is null,
      'acl', coalesce((
        select jsonb_agg(value order by value)
        from (select acl::text as value from unnest(coalesce(n.nspacl, '{}'::aclitem[])) acl) entries
      ), '[]'::jsonb)
    ) as definition
  from pg_catalog.pg_namespace n
  where n.nspname in ('public', 'private')
),
relation_rows as (
  select
    format('%I.%I', n.nspname, c.relname) as sort_key,
    jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'owner', pg_catalog.pg_get_userbyid(c.relowner),
      'persistence', c.relpersistence,
      'row_security', c.relrowsecurity,
      'force_row_security', c.relforcerowsecurity,
      'acl_is_null', c.relacl is null,
      'acl', coalesce((
        select jsonb_agg(value order by value)
        from (select acl::text as value from unnest(coalesce(c.relacl, '{}'::aclitem[])) acl) entries
      ), '[]'::jsonb),
      'view_definition', case when c.relkind in ('v', 'm') then pg_catalog.pg_get_viewdef(c.oid, true) else null end,
      'partition_bound', case when c.relpartbound is not null then pg_catalog.pg_get_expr(c.relpartbound, c.oid, true) else null end,
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', a.attnum,
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'collation', case when a.attcollation = 0 then null else format('%I.%I', cn.nspname, coll.collname) end,
          'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true),
          'acl_is_null', a.attacl is null,
          'acl', coalesce((
            select jsonb_agg(value order by value)
            from (select acl::text as value from unnest(coalesce(a.attacl, '{}'::aclitem[])) acl) entries
          ), '[]'::jsonb)
        ) order by a.attnum)
        from pg_catalog.pg_attribute a
        left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        left join pg_catalog.pg_collation coll on coll.oid = a.attcollation
        left join pg_catalog.pg_namespace cn on cn.oid = coll.collnamespace
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ), '[]'::jsonb),
      'constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'type', con.contype,
          'deferrable', con.condeferrable,
          'initially_deferred', con.condeferred,
          'validated', con.convalidated,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
        ) order by con.conname, con.oid)
        from pg_catalog.pg_constraint con
        where con.conrelid = c.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', ic.relname,
          'owner', pg_catalog.pg_get_userbyid(ic.relowner),
          'unique', i.indisunique,
          'primary', i.indisprimary,
          'valid', i.indisvalid,
          'ready', i.indisready,
          'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, true)
        ) order by ic.relname, i.indexrelid)
        from pg_catalog.pg_index i
        join pg_catalog.pg_class ic on ic.oid = i.indexrelid
        where i.indrelid = c.oid
      ), '[]'::jsonb)
    ) as definition
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where (n.nspname in ('public', 'private') or (n.nspname = 'storage' and c.relname = 'objects'))
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
type_rows as (
  select
    format('%I.%I', n.nspname, t.typname) as sort_key,
    jsonb_build_object(
      'schema', n.nspname,
      'name', t.typname,
      'kind', t.typtype,
      'owner', pg_catalog.pg_get_userbyid(t.typowner),
      'acl_is_null', t.typacl is null,
      'acl', coalesce((
        select jsonb_agg(value order by value)
        from (select acl::text as value from unnest(coalesce(t.typacl, '{}'::aclitem[])) acl) entries
      ), '[]'::jsonb),
      'enum_labels', coalesce((
        select jsonb_agg(e.enumlabel order by e.enumsortorder)
        from pg_catalog.pg_enum e where e.enumtypid = t.oid
      ), '[]'::jsonb),
      'domain_base', case when t.typtype = 'd' then pg_catalog.format_type(t.typbasetype, t.typtypmod) else null end,
      'domain_not_null', case when t.typtype = 'd' then t.typnotnull else null end,
      'domain_default', case when t.typtype = 'd' then t.typdefault else null end,
      'domain_constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'validated', con.convalidated,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
        ) order by con.conname, con.oid)
        from pg_catalog.pg_constraint con where con.contypid = t.oid
      ), '[]'::jsonb)
    ) as definition
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typtype in ('e', 'd')
),
function_rows as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as sort_key,
    jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'result', pg_catalog.pg_get_function_result(p.oid),
      'language', l.lanname,
      'kind', p.prokind,
      'volatility', p.provolatile,
      'strict', p.proisstrict,
      'security_definer', p.prosecdef,
      'leakproof', p.proleakproof,
      'parallel', p.proparallel,
      'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'acl_is_null', p.proacl is null,
      'configuration', coalesce((select jsonb_agg(value order by value) from unnest(coalesce(p.proconfig, '{}'::text[])) value), '[]'::jsonb),
      'acl', coalesce((
        select jsonb_agg(value order by value)
        from (select acl::text as value from unnest(coalesce(p.proacl, '{}'::aclitem[])) acl) entries
      ), '[]'::jsonb),
      'definition', pg_catalog.pg_get_functiondef(p.oid)
    ) as definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname in ('public', 'private')
),
policy_rows as (
  select
    format('%I.%I:%s', p.schemaname, p.tablename, p.policyname) as sort_key,
    jsonb_build_object(
      'schema', p.schemaname,
      'table', p.tablename,
      'name', p.policyname,
      'permissive', p.permissive,
      'roles', coalesce((select jsonb_agg(role order by role) from unnest(p.roles) role), '[]'::jsonb),
      'command', p.cmd,
      'using', p.qual,
      'check', p.with_check
    ) as definition
  from pg_catalog.pg_policies p
  where p.schemaname in ('public', 'private')
     or (p.schemaname = 'storage' and p.tablename = 'objects')
),
trigger_rows as (
  select
    format('%I.%I:%s', n.nspname, c.relname, t.tgname) as sort_key,
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'name', t.tgname,
      'enabled', t.tgenabled,
      'definition', pg_catalog.pg_get_triggerdef(t.oid, true)
    ) as definition
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public', 'private')
),
application_table_counts(table_name, row_count) as (
  select 'public.beta_auth_events', count(*)::bigint from public.beta_auth_events
  union all select 'public.beta_consent_events', count(*)::bigint from public.beta_consent_events
  union all select 'public.beta_invites', count(*)::bigint from public.beta_invites
  union all select 'public.beta_memberships', count(*)::bigint from public.beta_memberships
  union all select 'public.conversation_members', count(*)::bigint from public.conversation_members
  union all select 'public.conversations', count(*)::bigint from public.conversations
  union all select 'public.deal_confirmations', count(*)::bigint from public.deal_confirmations
  union all select 'public.deal_listing_locks', count(*)::bigint from public.deal_listing_locks
  union all select 'public.deals', count(*)::bigint from public.deals
  union all select 'public.entitlements', count(*)::bigint from public.entitlements
  union all select 'public.favorites', count(*)::bigint from public.favorites
  union all select 'public.fragrances', count(*)::bigint from public.fragrances
  union all select 'public.listing_authenticity_reviews', count(*)::bigint from public.listing_authenticity_reviews
  union all select 'public.listing_photos', count(*)::bigint from public.listing_photos
  union all select 'public.listings', count(*)::bigint from public.listings
  union all select 'public.merchant_applications', count(*)::bigint from public.merchant_applications
  union all select 'public.messages', count(*)::bigint from public.messages
  union all select 'public.moderation_audit', count(*)::bigint from public.moderation_audit
  union all select 'public.notification_email_deliveries', count(*)::bigint from public.notification_email_deliveries
  union all select 'public.notifications', count(*)::bigint from public.notifications
  union all select 'public.offers', count(*)::bigint from public.offers
  union all select 'public.payment_events', count(*)::bigint from public.payment_events
  union all select 'public.payment_refunds', count(*)::bigint from public.payment_refunds
  union all select 'public.payments', count(*)::bigint from public.payments
  union all select 'public.profile_comments', count(*)::bigint from public.profile_comments
  union all select 'public.profiles', count(*)::bigint from public.profiles
  union all select 'public.report_evidence_uploads', count(*)::bigint from public.report_evidence_uploads
  union all select 'public.reports', count(*)::bigint from public.reports
  union all select 'public.reviews', count(*)::bigint from public.reviews
  union all select 'public.saved_searches', count(*)::bigint from public.saved_searches
  union all select 'public.upload_cleanup_queue', count(*)::bigint from public.upload_cleanup_queue
  union all select 'public.upload_quarantine', count(*)::bigint from public.upload_quarantine
  union all select 'private.first_admin_bootstrap', count(*)::bigint from private.first_admin_bootstrap
  union all select 'private.first_admin_bootstrap_attempts', count(*)::bigint from private.first_admin_bootstrap_attempts
  union all select 'private.upload_cleanup_claim_requests', count(*)::bigint from private.upload_cleanup_claim_requests
),
fingerprint_payloads as (
  select
    jsonb_build_object(
      'schemas', coalesce((select jsonb_agg(definition order by sort_key) from schema_rows), '[]'::jsonb),
      'relations', coalesce((select jsonb_agg(definition order by sort_key) from relation_rows where definition ->> 'schema' in ('public', 'private')), '[]'::jsonb)
    ) as relations,
	coalesce((select jsonb_agg(definition order by sort_key) from relation_rows where definition ->> 'schema' = 'storage'), '[]'::jsonb) as storage_authorization,
    coalesce((select jsonb_agg(definition order by sort_key) from type_rows), '[]'::jsonb) as types,
    coalesce((select jsonb_agg(definition order by sort_key) from function_rows), '[]'::jsonb) as functions,
    coalesce((select jsonb_agg(definition order by sort_key) from policy_rows), '[]'::jsonb) as policies,
    coalesce((select jsonb_agg(definition order by sort_key) from trigger_rows), '[]'::jsonb) as triggers,
    jsonb_build_object(
      'brands', coalesce((
        select jsonb_agg(jsonb_build_object(
		  'registry_id', coalesce(row.provenance #>> '{editorialRegistry,registryId}', row.provenance ->> 'registryId'),
          'canonical_name', row.canonical_name::text,
          'slug', row.slug,
          'status', row.status,
          'normalized_key', row.normalized_key,
          'submitted_display_name', row.submitted_display_name,
		  'parent_registry_id', coalesce(parent.provenance #>> '{editorialRegistry,registryId}', parent.provenance ->> 'registryId'),
		  'suggested_registry_id', coalesce(suggested.provenance #>> '{editorialRegistry,registryId}', suggested.provenance ->> 'registryId'),
		  'merged_into_registry_id', coalesce(merged.provenance #>> '{editorialRegistry,registryId}', merged.provenance ->> 'registryId'),
		  'created_by_username', creator.username,
		  'canonicalized_by_username', canonicalizer.username,
          'stable_provenance', (row.provenance #- '{editorialRegistry,lastSyncRunId}') #- '{editorialRegistry,syncedAt}'
        ) order by row.normalized_key)
		from public.brands row
		left join public.brands parent on parent.id = row.parent_brand_id
		left join public.brands suggested on suggested.id = row.suggested_brand_id
		left join public.brands merged on merged.id = row.merged_into_brand_id
		left join public.profiles creator on creator.id = row.created_by
		left join public.profiles canonicalizer on canonicalizer.id = row.canonicalized_by
      ), '[]'::jsonb),
      'aliases', coalesce((
        select jsonb_agg(jsonb_build_object(
		  'registry_id', coalesce(brand.provenance #>> '{editorialRegistry,registryId}', brand.provenance ->> 'registryId'),
          'kind', row.kind,
          'alias', row.alias::text,
          'normalized_alias', row.normalized_alias,
          'stable_provenance', (row.provenance - 'lastSyncRunId') - 'syncedAt'
		) order by row.normalized_alias, coalesce(brand.provenance #>> '{editorialRegistry,registryId}', brand.provenance ->> 'registryId'))
        from public.brand_aliases row
        join public.brands brand on brand.id = row.brand_id
      ), '[]'::jsonb),
      'memberships', coalesce((
        select jsonb_agg(jsonb_build_object(
		  'registry_id', coalesce(brand.provenance #>> '{editorialRegistry,registryId}', brand.provenance ->> 'registryId'),
          'collection', row.collection,
          'display_order', row.display_order,
          'reviewed_at', row.reviewed_at,
          'stable_provenance', (row.provenance - 'lastSyncRunId') - 'syncedAt'
		) order by row.collection::text, row.display_order, coalesce(brand.provenance #>> '{editorialRegistry,registryId}', brand.provenance ->> 'registryId'))
        from public.brand_collection_memberships row
        join public.brands brand on brand.id = row.brand_id
      ), '[]'::jsonb),
      'legal_documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'document_code', row.document_code,
          'document_version', row.document_version,
          'required_for_access', row.required_for_access,
          'effective_at', row.effective_at,
          'retired_at', row.retired_at
        ) order by row.document_code, row.document_version)
		from public.beta_legal_documents row
	  ), '[]'::jsonb),
	  'sync_runs', coalesce((
		select jsonb_agg(definition order by definition::text)
		from (
		  select distinct jsonb_build_object(
			'catalog_id', row.catalog_id,
			'schema_version', row.schema_version,
			'source_catalog_version', row.source_catalog_version,
			'payload_sha256', row.payload_sha256,
			'payload', row.payload,
			'actor_role', row.actor_role,
			'actor_username', actor.username,
			'actor_present', row.actor_id is not null,
			'brand_count', row.brand_count,
			'alias_count', row.alias_count,
			'membership_count', row.membership_count
		  ) as definition
		  from public.catalog_sync_runs row
		  left join public.profiles actor on actor.id = row.actor_id
		) stable_runs
	  ), '[]'::jsonb)
    ) as catalog
)
select
  encode(extensions.digest(convert_to(relations::text, 'UTF8'), 'sha256'), 'hex') as relations_sha256,
	encode(extensions.digest(convert_to(storage_authorization::text, 'UTF8'), 'sha256'), 'hex') as storage_authorization_sha256,
  encode(extensions.digest(convert_to(types::text, 'UTF8'), 'sha256'), 'hex') as types_sha256,
  encode(extensions.digest(convert_to(functions::text, 'UTF8'), 'sha256'), 'hex') as functions_sha256,
  encode(extensions.digest(convert_to(policies::text, 'UTF8'), 'sha256'), 'hex') as policies_sha256,
  encode(extensions.digest(convert_to(triggers::text, 'UTF8'), 'sha256'), 'hex') as triggers_sha256,
  encode(extensions.digest(convert_to(catalog::text, 'UTF8'), 'sha256'), 'hex') as catalog_sha256,
  (select jsonb_agg(jsonb_build_object('table', table_name, 'rows', row_count) order by table_name) from application_table_counts) as application_table_counts
from fingerprint_payloads;
