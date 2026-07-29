begin;

-- Active marketplace terms cannot change in place. Owners must pause first, and
-- every pause/removal invalidates offers that were made against the old terms.
create or replace function public.protect_listing_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := false;
  material_change boolean := false;
begin
  if new.seller_id is distinct from old.seller_id then
    raise exception 'listing seller is immutable' using errcode = '23514';
  end if;

  if current_user = 'authenticated' and auth.uid() = old.seller_id then
    if new.completed_at is distinct from old.completed_at
       or new.activated_at is distinct from old.activated_at
       or new.expires_at is distinct from old.expires_at
    then
      raise exception 'server-managed listing timestamps cannot be changed directly'
        using errcode = '42501';
    end if;

    material_change :=
      (
        to_jsonb(new)
        - array['status', 'updated_at', 'activated_at', 'expires_at', 'completed_at']
      ) is distinct from (
        to_jsonb(old)
        - array['status', 'updated_at', 'activated_at', 'expires_at', 'completed_at']
      );

    if old.status = 'active' and material_change then
      raise exception 'pause the listing before changing marketplace terms'
        using errcode = '42501';
    end if;

    if old.status = 'reserved'
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at')
    then
      raise exception 'reserved listing terms are frozen until the deal is cancelled'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      allowed :=
        (old.status = 'draft' and new.status in ('active', 'removed'))
        or (old.status = 'active' and new.status in ('paused', 'removed'))
        or (old.status = 'paused' and new.status in ('active', 'removed'))
        or (old.status = 'expired' and new.status in ('active', 'removed'))
        or (old.status = 'rejected' and new.status in ('draft', 'removed'));
      if not allowed then
        raise exception 'listing status transition requires a server workflow'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.expire_offers_after_listing_terms_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and new.status in ('paused', 'expired', 'rejected', 'removed')
  then
    update public.offers
    set status = 'expired',
        responded_at = statement_timestamp()
    where status = 'pending'
      and (listing_id = new.id or offered_listing_id = new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists expire_offers_after_listing_terms_close on public.listings;
create trigger expire_offers_after_listing_terms_close
after update of status on public.listings
for each row execute function public.expire_offers_after_listing_terms_close();

revoke execute on function public.expire_offers_after_listing_terms_close()
  from public, anon, authenticated;

-- Wanted records never carry physical item state. NOT VALID preserves forward
-- deployability while enforcing the shape for all new/changed rows.
alter table public.listings
  drop constraint if exists listing_wanted_non_physical_shape;
alter table public.listings
  add constraint listing_wanted_non_physical_shape check (
    kind = 'offer'
    or (
      product_format is null
      and bottle_volume_ml is null
      and remaining_ml is null
      and is_sealed = false
    )
  ) not valid;
alter table public.listings
  validate constraint listing_wanted_non_physical_shape;

-- Suspended users may read already accepted legal records but cannot append new
-- marketplace consent events.
create or replace function public.accept_beta_consent(
  requested_document_code text,
  requested_document_version text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  result_timestamp timestamptz;
begin
  if requesting_user is null or not exists (
    select 1 from public.beta_memberships m
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = requesting_user
      and m.status in ('pending', 'active')
      and p.is_suspended = false
  ) then
    raise exception 'an unsuspended beta membership is required before accepting documents'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.beta_legal_documents d
    where d.document_code = requested_document_code
      and d.document_version = requested_document_version
      and d.effective_at <= statement_timestamp()
      and d.retired_at is null
  ) then
    raise exception 'document version is not current' using errcode = '23514';
  end if;

  insert into public.beta_consent_events (
    profile_id, document_code, document_version, accepted_at, source
  ) values (
    requesting_user, requested_document_code, requested_document_version,
    statement_timestamp(), 'web'
  )
  on conflict (profile_id, document_code, document_version) do nothing;

  select c.accepted_at into result_timestamp
  from public.beta_consent_events c
  where c.profile_id = requesting_user
    and c.document_code = requested_document_code
    and c.document_version = requested_document_version;
  return result_timestamp;
end;
$$;

-- Upload finalization and publication now serialize on the listing row.
-- Re-uploading a role replaces its prior finalized object, and the same
-- sanitized bytes cannot satisfy multiple evidence roles.
create or replace function public.finalize_listing_upload(
  target_upload_id uuid,
  final_storage_path text,
  actual_content_hash text,
  actual_mime_type text,
  actual_byte_size integer,
  actual_width_px integer,
  actual_height_px integer
)
returns public.listing_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_record public.upload_quarantine%rowtype;
  listing_record public.listings%rowtype;
  photo_record public.listing_photos%rowtype;
  expected_extension text;
  expected_path text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if actual_mime_type not in ('image/jpeg', 'image/webp', 'image/avif')
     or actual_content_hash !~ '^[a-f0-9]{64}$'
     or actual_byte_size not between 1 and 10485760
     or actual_width_px not between 1 and 10000
     or actual_height_px not between 1 and 10000
  then
    raise exception 'sanitized image metadata is invalid' using errcode = '22023';
  end if;

  select * into upload_record
  from public.upload_quarantine q
  where q.id = target_upload_id
  for update;
  if not found
     or upload_record.status <> 'processing'
     or upload_record.expires_at <= statement_timestamp()
  then
    raise exception 'claimed upload was not found or has expired' using errcode = 'P0002';
  end if;

  select * into listing_record
  from public.listings l
  where l.id = upload_record.listing_id
  for update;
  if not found
     or listing_record.seller_id <> upload_record.uploader_id
     or listing_record.kind <> 'offer'
     or listing_record.status not in ('draft', 'paused')
  then
    raise exception 'listing no longer accepts evidence uploads' using errcode = '42501';
  end if;

  expected_extension := case actual_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  expected_path := upload_record.uploader_id::text || '/'
    || upload_record.listing_id::text || '/' || upload_record.id::text
    || '.' || expected_extension;
  if final_storage_path is distinct from expected_path then
    raise exception 'final image path is not canonical' using errcode = '23514';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'listing-images' and o.name = expected_path
  ) then
    raise exception 'sanitized final object was not uploaded' using errcode = 'P0002';
  end if;

  delete from public.listing_photos lp
  where lp.listing_id = upload_record.listing_id
    and lp.role = upload_record.requested_role;

  if exists (
    select 1 from public.listing_photos lp
    where lp.listing_id = upload_record.listing_id
      and lp.content_hash = actual_content_hash
  ) then
    raise exception 'evidence photos must contain distinct image content'
      using errcode = '23505';
  end if;

  insert into public.listing_photos (
    listing_id, storage_path, role, content_hash, mime_type, byte_size,
    width_px, height_px, sanitized_at, source_upload_id, created_at
  ) values (
    upload_record.listing_id, expected_path, upload_record.requested_role,
    actual_content_hash, actual_mime_type, actual_byte_size,
    actual_width_px, actual_height_px, statement_timestamp(),
    upload_record.id, statement_timestamp()
  )
  returning * into photo_record;

  update public.upload_quarantine
  set status = 'finalized', final_storage_path = expected_path
  where id = upload_record.id;

  insert into public.upload_cleanup_queue (
    upload_id, bucket_id, storage_path, reason
  ) values (
    upload_record.id, upload_record.bucket_id,
    upload_record.quarantine_path, 'finalized_source_cleanup'
  ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;

  return photo_record;
end;
$$;

create or replace function public.validate_listing_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo_count integer;
  distinct_photo_count integer;
  active_count integer;
  listing_limit integer;
  photo_roles public.photo_role[];
begin
  if new.status <> 'active' then return new; end if;
  if not private.is_active_beta_user(new.seller_id) then
    raise exception 'active beta membership is required before listing activation'
      using errcode = '42501';
  end if;
  if not private.has_verified_phone(new.seller_id) then
    raise exception 'phone verification is required before listing activation'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.seller_id::text, 20260722)
  );
  if new.kind = 'offer' and coalesce(new.remaining_ml, 0) <= 0 then
    raise exception 'an active offer listing cannot be empty' using errcode = '23514';
  end if;

  if new.kind = 'offer' then
    select
      count(*),
      count(distinct lp.content_hash),
      coalesce(array_agg(distinct lp.role), '{}'::public.photo_role[])
    into photo_count, distinct_photo_count, photo_roles
    from public.listing_photos lp
    where lp.listing_id = new.id and lp.sanitized_at is not null;
    if photo_count < 4 or distinct_photo_count < 4 then
      raise exception 'at least four distinct finalized photos are required'
        using errcode = '23514';
    end if;

    if new.product_format = 'official_sample' then
      if not (photo_roles @> array[
        'product_full'::public.photo_role,
        'manufacturer_label'::public.photo_role,
        'manufacturer_markings'::public.photo_role,
        'seal'::public.photo_role
      ]) then
        raise exception 'official sample evidence photos are incomplete'
          using errcode = '23514';
      end if;
    elsif new.is_sealed then
      if not (photo_roles @> array[
        'box_front'::public.photo_role,
        'box_bottom'::public.photo_role,
        'batch_code'::public.photo_role,
        'seal'::public.photo_role
      ]) then
        raise exception 'sealed product evidence photos are incomplete'
          using errcode = '23514';
      end if;
    else
      if not (photo_roles @> array[
        'product_full'::public.photo_role,
        'bottle_bottom'::public.photo_role,
        'batch_code'::public.photo_role,
        'fill_level'::public.photo_role
      ]) then
        raise exception 'opened product evidence photos are incomplete'
          using errcode = '23514';
      end if;
    end if;
  end if;

  select count(*) into active_count
  from public.listings l
  where l.seller_id = new.seller_id
    and l.status in ('active', 'reserved')
    and l.id <> new.id;
  listing_limit := public.effective_listing_limit(new.seller_id);
  if active_count >= listing_limit then
    raise exception 'active listing quota reached' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or old.status <> 'active' or new.activated_at is null then
    new.activated_at := statement_timestamp();
    new.expires_at := statement_timestamp() + interval '60 days';
  elsif new.expires_at is null then
    new.expires_at := new.activated_at + interval '60 days';
  end if;
  return new;
end;
$$;

-- Prune detached cleanup request tokens during subsequent scheduler claims.
create or replace function public.prune_upload_cleanup_claim_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.upload_cleanup_claim_requests r
  where r.request_id in (
    select candidate.request_id
    from private.upload_cleanup_claim_requests candidate
    where candidate.first_claimed_at < statement_timestamp() - interval '24 hours'
      and not exists (
        select 1 from public.upload_cleanup_queue q
        where q.worker_request_id = candidate.request_id
          and q.processed_at is null
      )
    order by candidate.first_claimed_at
    limit 500
  );
  return null;
end;
$$;

drop trigger if exists prune_upload_cleanup_claim_requests
  on private.upload_cleanup_claim_requests;
create trigger prune_upload_cleanup_claim_requests
before insert on private.upload_cleanup_claim_requests
for each statement execute function public.prune_upload_cleanup_claim_requests();

revoke execute on function public.prune_upload_cleanup_claim_requests()
  from public, anon, authenticated, service_role;

-- Canonical, sort-aware listing search. The v2 name avoids overloading the
-- deployed RPC while clients migrate to the new cursor contract.
create or replace function public.search_listings_v2(
  search_query text default null,
  filter_audience public.audience default null,
  filter_segments public.segment[] default null,
  filter_deal_mode public.deal_mode default null,
  filter_city text default null,
  filter_kind public.listing_kind default null,
  filter_product_format public.product_format default null,
  filter_brand_id uuid default null,
  filter_fragrance_id uuid default null,
  min_price_minor integer default null,
  max_price_minor integer default null,
  sort_mode text default 'newest',
  page_size integer default 24,
  cursor_activated_at timestamptz default null,
  cursor_price_minor integer default null,
  cursor_id uuid default null
)
returns table (
  listing_id uuid,
  slug text,
  activated_at timestamptz,
  sort_price_minor integer,
  relevance real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if sort_mode not in ('newest', 'price_asc', 'price_desc') then
    raise exception 'unsupported listing sort mode' using errcode = '22023';
  end if;
  if sort_mode = 'newest' then
    if (cursor_activated_at is null) <> (cursor_id is null)
       or cursor_price_minor is not null
    then
      raise exception 'newest cursor is incomplete' using errcode = '22023';
    end if;
  else
    if (cursor_price_minor is null) <> (cursor_id is null)
       or cursor_activated_at is not null
    then
      raise exception 'price cursor is incomplete' using errcode = '22023';
    end if;
  end if;

  return query
  with params as (
    select public.normalize_catalog_key(coalesce(search_query, '')) as q
  ), matches as (
    select
      l.id,
      l.slug,
      l.activated_at,
      case
        when sort_mode = 'price_asc'
          then coalesce(l.price_minor, l.max_budget_minor, l.estimated_value_minor, 2147483647)
        when sort_mode = 'price_desc'
          then coalesce(l.price_minor, l.max_budget_minor, l.estimated_value_minor, -1)
        else coalesce(l.price_minor, l.max_budget_minor, l.estimated_value_minor)
      end as effective_price,
      (case when p.q = '' then 0.0 else greatest(
        ts_rank(
          to_tsvector(
            'simple',
            coalesce(l.title, '') || ' ' || coalesce(l.fragrance_name, '')
              || ' ' || coalesce(l.description, '')
          ),
          websearch_to_tsquery('simple', p.q)
        ),
        extensions.similarity(public.normalize_catalog_key(l.title), p.q),
        extensions.similarity(public.normalize_catalog_key(l.fragrance_name), p.q)
      ) end)::real as search_relevance
    from public.listings l
    cross join params p
    where public.is_active_beta_user()
      and private.is_active_beta_user(l.seller_id)
      and l.status = 'active'
      and l.expires_at > now()
      and (filter_audience is null or l.audience = filter_audience)
      and (
        filter_segments is null
        or cardinality(filter_segments) = 0
        or l.segments @> filter_segments
      )
      and (filter_deal_mode is null or l.deal_mode = filter_deal_mode)
      and (
        filter_city is null
        or public.normalize_catalog_key(l.city) = public.normalize_catalog_key(filter_city)
      )
      and (filter_kind is null or l.kind = filter_kind)
      and (filter_product_format is null or l.product_format = filter_product_format)
      and (filter_brand_id is null or l.brand_id = filter_brand_id)
      and (filter_fragrance_id is null or l.fragrance_id = filter_fragrance_id)
      and (
        min_price_minor is null
        or coalesce(l.price_minor, l.max_budget_minor, l.estimated_value_minor) >= min_price_minor
      )
      and (
        max_price_minor is null
        or coalesce(l.price_minor, l.max_budget_minor, l.estimated_value_minor) <= max_price_minor
      )
      and (
        p.q = ''
        or to_tsvector(
          'simple',
          coalesce(l.title, '') || ' ' || coalesce(l.fragrance_name, '')
            || ' ' || coalesce(l.description, '')
        ) @@ websearch_to_tsquery('simple', p.q)
        or extensions.similarity(public.normalize_catalog_key(l.title), p.q) >= 0.18
        or extensions.similarity(public.normalize_catalog_key(l.fragrance_name), p.q) >= 0.18
      )
  )
  select
    m.id,
    m.slug,
    m.activated_at,
    m.effective_price,
    m.search_relevance
  from matches m
  where
    (
      sort_mode = 'newest'
      and (
        cursor_activated_at is null
        or (m.activated_at, m.id) < (cursor_activated_at, cursor_id)
      )
    )
    or (
      sort_mode = 'price_asc'
      and (
        cursor_price_minor is null
        or (m.effective_price, m.id) > (cursor_price_minor, cursor_id)
      )
    )
    or (
      sort_mode = 'price_desc'
      and (
        cursor_price_minor is null
        or (m.effective_price, m.id) < (cursor_price_minor, cursor_id)
      )
    )
  order by
    case when sort_mode = 'newest' then m.activated_at end desc,
    case when sort_mode = 'price_asc' then m.effective_price end asc,
    case when sort_mode = 'price_desc' then m.effective_price end desc,
    case when sort_mode = 'price_asc' then m.id end asc,
    case when sort_mode in ('newest', 'price_desc') then m.id end desc
  limit greatest(1, least(coalesce(page_size, 24), 60));
end;
$$;

revoke execute on function public.search_listings_v2(
  text, public.audience, public.segment[], public.deal_mode, text,
  public.listing_kind, public.product_format, uuid, uuid,
  integer, integer, text, integer, timestamptz, integer, uuid
) from public, anon;
grant execute on function public.search_listings_v2(
  text, public.audience, public.segment[], public.deal_mode, text,
  public.listing_kind, public.product_format, uuid, uuid,
  integer, integer, text, integer, timestamptz, integer, uuid
) to authenticated;
revoke execute on function public.search_listings(
  text, public.audience, public.segment[], public.deal_mode, text,
  integer, integer, integer, timestamptz, uuid
) from authenticated;

-- Catalogue search is paginated in the database so offsets above the old
-- 50-row RPC cap remain traversable.
create or replace function public.search_catalog_v2(
  search_query text,
  page_size integer default 20,
  page_offset integer default 0
)
returns table (
  entity_type text,
  id uuid,
  brand_id uuid,
  label text,
  slug text,
  secondary_label text,
  relevance real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.normalize_catalog_key(coalesce(search_query, '')) as q
  ), candidates as (
    select
      'brand'::text as entity_type,
      b.id,
      b.id as brand_id,
      b.canonical_name::text as label,
      b.slug,
      null::text as secondary_label,
      (case
        when b.normalized_key = p.q then 1.0
        when b.normalized_key like p.q || '%' then 0.92
        else extensions.similarity(b.normalized_key, p.q)
      end)::real as relevance
    from public.brands b
    cross join params p
    where public.is_active_beta_user()
      and p.q <> ''
      and b.status = 'canonical'
      and (
        b.normalized_key like p.q || '%'
        or extensions.similarity(b.normalized_key, p.q) >= 0.18
      )

    union all

    select
      'brand'::text,
      b.id,
      b.id,
      b.canonical_name::text,
      b.slug,
      a.alias::text,
      (case
        when a.normalized_alias = p.q then 0.98
        when a.normalized_alias like p.q || '%' then 0.90
        else extensions.similarity(a.normalized_alias, p.q) * 0.9
      end)::real
    from public.brand_aliases a
    join public.brands b on b.id = a.brand_id and b.status = 'canonical'
    cross join params p
    where public.is_active_beta_user()
      and p.q <> ''
      and (
        a.normalized_alias like p.q || '%'
        or extensions.similarity(a.normalized_alias, p.q) >= 0.18
      )

    union all

    select
      'fragrance'::text,
      f.id,
      f.brand_id,
      f.name::text,
      f.slug,
      b.canonical_name::text,
      (case
        when f.normalized_name = p.q then 1.0
        when f.normalized_name like p.q || '%' then 0.93
        else extensions.similarity(f.normalized_name, p.q)
      end)::real
    from public.fragrances f
    join public.brands b on b.id = f.brand_id and b.status = 'canonical'
    cross join params p
    where public.is_active_beta_user()
      and p.q <> ''
      and f.is_active
      and (
        f.normalized_name like p.q || '%'
        or extensions.similarity(f.normalized_name, p.q) >= 0.18
      )
  ), ranked as (
    select c.*,
      row_number() over (
        partition by c.entity_type, c.id
        order by c.relevance desc, c.secondary_label nulls last
      ) as duplicate_rank
    from candidates c
  )
  select
    r.entity_type, r.id, r.brand_id, r.label, r.slug,
    r.secondary_label, r.relevance
  from ranked r
  where r.duplicate_rank = 1
  order by r.relevance desc, r.label, r.id
  offset greatest(0, coalesce(page_offset, 0))
  limit greatest(1, least(coalesce(page_size, 20), 50));
$$;

revoke execute on function public.search_catalog_v2(text, integer, integer)
  from public, anon;
grant execute on function public.search_catalog_v2(text, integer, integer)
  to authenticated;
revoke execute on function public.search_catalog(text, integer)
  from authenticated;

create or replace function public.latest_messages_for_conversations(
  target_conversation_ids uuid[]
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  reply_to_id uuid,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (m.conversation_id)
    m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id,
    m.created_at, m.edited_at, m.deleted_at
  from public.messages m
  where m.conversation_id = any(coalesce(target_conversation_ids, '{}'::uuid[]))
  order by m.conversation_id, m.created_at desc, m.id desc;
$$;

revoke execute on function public.latest_messages_for_conversations(uuid[])
  from public, anon;
grant execute on function public.latest_messages_for_conversations(uuid[])
  to authenticated;

create or replace function public.list_received_offers(
  page_size integer default 25,
  page_offset integer default 0,
  filter_status public.offer_status default null
)
returns setof public.offers
language sql
stable
security invoker
set search_path = ''
as $$
  select o.*
  from public.offers o
  join public.listings l on l.id = o.listing_id
  where public.is_active_beta_user()
    and l.seller_id = auth.uid()
    and (filter_status is null or o.status = filter_status)
  order by o.created_at desc, o.id desc
  offset greatest(0, coalesce(page_offset, 0))
  limit greatest(1, least(coalesce(page_size, 25), 51));
$$;

revoke execute on function public.list_received_offers(integer, integer, public.offer_status)
  from public, anon;
grant execute on function public.list_received_offers(integer, integer, public.offer_status)
  to authenticated;

-- Only the application server may place validated evidence in the finalized
-- bucket. Authenticated clients submit files through the report action.
drop policy if exists marketplace_report_evidence_create on storage.objects;

create or replace function public.validate_report_evidence_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  evidence_path text;
begin
  if jsonb_array_length(new.evidence_paths) > 12 then
    raise exception 'too many report evidence objects' using errcode = '23514';
  end if;
  for evidence_path in
    select jsonb_array_elements_text(new.evidence_paths)
  loop
    if evidence_path !~ (
      '^' || auth.uid()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '[.](jpg|png|webp|pdf)$'
    ) or not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'report-evidence'
        and o.name = evidence_path
    ) then
      raise exception 'report evidence is not a finalized owned object'
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_report_evidence_ownership on public.reports;
create trigger validate_report_evidence_ownership
before insert on public.reports
for each row execute function public.validate_report_evidence_ownership();

drop policy if exists marketplace_report_evidence_delete on storage.objects;
create policy marketplace_report_evidence_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'report-evidence'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
  and not exists (
    select 1
    from public.reports r,
      lateral jsonb_array_elements_text(r.evidence_paths) evidence(path)
    where evidence.path = name
  )
);

revoke execute on function public.validate_report_evidence_ownership()
  from public, anon, authenticated, service_role;

-- The mail worker receives the canonical notification fields in the same call
-- that claims delivery. Webhook fields are never an authority for recipients
-- or message content.
create or replace function public.claim_notification_email_delivery_v2(
  target_notification_id uuid,
  worker_request_id text
)
returns table (
  status public.notification_email_delivery_status,
  claimed_worker_request_id text,
  provider_message_id text,
  profile_id uuid,
  kind text,
  title text,
  body text,
  action_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_email_deliveries%rowtype;
  notification public.notifications%rowtype;
begin
  delivery := public.claim_notification_email_delivery(
    target_notification_id,
    worker_request_id
  );
  select * into notification
  from public.notifications n
  where n.id = target_notification_id;
  if not found then
    raise exception 'canonical notification was not found' using errcode = 'P0002';
  end if;

  return query select
    delivery.status,
    delivery.worker_request_id,
    delivery.provider_message_id,
    notification.profile_id,
    notification.kind::text,
    notification.title,
    notification.body,
    notification.action_url;
end;
$$;

revoke execute on function public.claim_notification_email_delivery_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_notification_email_delivery_v2(uuid, text)
  to service_role;

-- A decision audit event closes its report in the same transaction. Access-only,
-- assignment, and already-generated resolution events are deliberately ignored.
create or replace function public.close_report_after_decision_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolution text;
begin
  if new.report_id is null
     or new.action in ('report_assigned', 'report_resolved', 'conversation_accessed')
  then
    return new;
  end if;

  resolution := case new.action
    when 'content_hidden' then 'content_hidden'
    when 'content_removed' then 'content_removed'
    when 'content_restored' then 'no_violation'
    when 'category_corrected' then 'content_corrected'
    when 'user_suspended' then 'user_suspended'
    when 'user_restored' then 'user_restored'
    when 'authenticity_reviewed' then 'authenticity_reviewed'
    when 'brand_merged' then 'brand_merged'
    else null
  end;
  if resolution is null then return new; end if;

  update public.reports
  set status = 'resolved',
      resolution_code = resolution,
      resolution_notes = new.rationale
  where id = new.report_id
    and status = 'investigating';
  if not found then
    raise exception 'moderation decision could not close its report'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists close_report_after_decision_audit
  on public.moderation_audit;
create trigger close_report_after_decision_audit
after insert on public.moderation_audit
for each row execute function public.close_report_after_decision_audit();

revoke execute on function public.close_report_after_decision_audit()
  from public, anon, authenticated, service_role;

create or replace function public.resolve_conversation_report(
  report_case_id uuid,
  decision text,
  moderation_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  target_message public.messages%rowtype;
  target_conversation public.conversations%rowtype;
  target_conversation_id uuid;
  audit_action public.moderation_action;
  audit_target_type public.report_target_type;
  audit_target_id uuid;
  before_data jsonb;
  after_data jsonb;
begin
  if not public.is_staff() then
    raise exception 'active staff access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;

  select * into target_report
  from public.reports r
  where r.id = report_case_id
  for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type not in ('conversation', 'message')
     or (
       target_report.assigned_to is distinct from auth.uid()
       and not public.is_admin()
     )
  then
    raise exception 'an assigned active conversation report is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.moderation_audit a
    where a.report_id = target_report.id
      and a.action = 'conversation_accessed'
      and a.actor_id = auth.uid()
  ) then
    raise exception 'inspect the report-bound conversation before deciding'
      using errcode = '42501';
  end if;

  if target_report.target_type = 'message' then
    select * into target_message
    from public.messages m
    where m.id = target_report.target_id
    for update;
    if not found then raise exception 'reported message not found' using errcode = 'P0002'; end if;
    target_conversation_id := target_message.conversation_id;
    if decision = 'remove' then
      before_data := to_jsonb(target_message);
      update public.messages
      set deleted_at = statement_timestamp()
      where id = target_message.id
      returning * into target_message;
      after_data := to_jsonb(target_message);
      audit_action := 'content_removed';
    elsif decision = 'keep' then
      before_data := to_jsonb(target_message);
      after_data := before_data;
      audit_action := 'content_restored';
    else
      raise exception 'unsupported message decision' using errcode = '22023';
    end if;
    audit_target_type := 'message';
    audit_target_id := target_message.id;
  else
    target_conversation_id := target_report.target_id;
    select * into target_conversation
    from public.conversations c
    where c.id = target_conversation_id
    for update;
    if not found then
      raise exception 'reported conversation not found' using errcode = 'P0002';
    end if;
    before_data := to_jsonb(target_conversation);
    if decision = 'block' then
      update public.conversations
      set status = 'blocked'
      where id = target_conversation_id
      returning * into target_conversation;
      after_data := to_jsonb(target_conversation);
      audit_action := 'content_hidden';
    elsif decision = 'keep' then
      after_data := before_data;
      audit_action := 'content_restored';
    else
      raise exception 'unsupported conversation decision' using errcode = '22023';
    end if;
    audit_target_type := 'conversation';
    audit_target_id := target_conversation_id;
  end if;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, audit_target_type,
    audit_target_id, btrim(moderation_rationale), before_data, after_data
  );

  return jsonb_build_object(
    'reportId', target_report.id,
    'conversationId', target_conversation_id,
    'decision', decision
  );
end;
$$;

revoke execute on function public.resolve_conversation_report(uuid, text, text)
  from public, anon;
grant execute on function public.resolve_conversation_report(uuid, text, text)
  to authenticated;

create or replace function public.get_hosted_runtime_inventory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scheduled_jobs jsonb := '[]'::jsonb;
  realtime_tables jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('cron.job') is not null then
    execute $inventory$
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', jobname,
            'schedule', schedule,
            'command', command,
            'active', active
          )
          order by jobname
        ),
        '[]'::jsonb
      )
      from cron.job
      where jobname in (
        'perfume-beta-expiry-notifications',
        'perfume-beta-maintenance'
      )
    $inventory$ into scheduled_jobs;
  end if;

  select coalesce(jsonb_agg(p.tablename order by p.tablename), '[]'::jsonb)
  into realtime_tables
  from pg_catalog.pg_publication_tables p
  where p.pubname = 'supabase_realtime'
    and p.schemaname = 'public'
    and p.tablename in (
      'beta_memberships', 'deal_confirmations', 'listing_photos', 'listings',
      'offers', 'reports', 'upload_quarantine'
    );

  return jsonb_build_object(
    'scheduledJobs', scheduled_jobs,
    'realtimeTables', realtime_tables
  );
end;
$$;

revoke execute on function public.get_hosted_runtime_inventory()
  from public, anon, authenticated;
grant execute on function public.get_hosted_runtime_inventory()
  to service_role;

commit;
