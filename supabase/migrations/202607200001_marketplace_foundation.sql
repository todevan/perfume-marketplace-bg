begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create type public.account_kind as enum ('private', 'merchant');
create type public.platform_role as enum ('user', 'moderator', 'admin');
create type public.merchant_application_status as enum (
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn'
);
create type public.brand_status as enum ('canonical', 'pending_canonicalization', 'merged', 'rejected');
create type public.brand_alias_kind as enum (
  'alternate', 'common_misspelling', 'transliteration', 'previous_name', 'product_line', 'acronym', 'other'
);
create type public.brand_collection as enum ('men', 'women', 'unisex', 'niche', 'arabic');
create type public.audience as enum ('men', 'women', 'unisex');
create type public.segment as enum ('niche', 'arabic');
create type public.listing_kind as enum ('offer', 'wanted');
create type public.deal_mode as enum ('sale', 'swap', 'sale_or_swap');
create type public.product_format as enum ('retail_bottle', 'tester', 'official_sample');
create type public.concentration as enum ('EDT', 'EDP', 'PARFUM', 'EXTRAIT', 'EDC', 'OTHER_NOT_STATED');
create type public.listing_status as enum (
  'draft', 'active', 'reserved', 'paused', 'completed', 'expired', 'rejected', 'removed'
);
create type public.photo_role as enum (
  'product_full', 'bottle_bottom', 'batch_code', 'fill_level', 'box_front', 'box_bottom',
  'seal', 'manufacturer_label', 'manufacturer_markings', 'other'
);
create type public.offer_kind as enum ('cash', 'swap', 'cash_plus_swap');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'expired');
create type public.conversation_status as enum ('open', 'archived', 'blocked');
create type public.deal_status as enum ('pending_confirmation', 'completed', 'disputed', 'cancelled');
create type public.review_status as enum ('published', 'hidden', 'removed');
create type public.authenticity_review_status as enum (
  'pending', 'evidence_reviewed', 'insufficient_evidence', 'rejected'
);
create type public.report_target_type as enum (
  'profile', 'brand', 'listing', 'offer', 'conversation', 'message', 'deal', 'review', 'profile_comment'
);
create type public.report_status as enum ('open', 'investigating', 'resolved', 'dismissed');
create type public.moderation_action as enum (
  'report_assigned', 'report_resolved', 'content_hidden', 'content_restored', 'content_removed',
  'category_corrected', 'brand_merged', 'merchant_verified', 'merchant_rejected',
  'authenticity_reviewed', 'conversation_accessed', 'user_suspended', 'user_restored'
);
create type public.payment_provider as enum ('mypos', 'stripe');
create type public.payment_purpose as enum ('extra_listing', 'merchant_start', 'merchant_pro', 'boost');
create type public.payment_status as enum (
  'created', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded'
);
create type public.entitlement_kind as enum (
  'extra_listing_slot', 'merchant_start', 'merchant_pro', 'boost'
);
create type public.notification_kind as enum (
  'offer_received', 'offer_accepted', 'offer_declined', 'message_received', 'deal_confirmation_needed',
  'deal_completed', 'review_received', 'listing_expiring', 'listing_expired', 'report_updated',
  'merchant_application_updated', 'payment_updated'
);
create type public.notification_status as enum ('unread', 'read', 'archived');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.array_has_unique_items(items anyarray)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(items), 0) = (
    select count(distinct item) from unnest(items) as item
  );
$$;

create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.normalize_catalog_key(value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(extensions.unaccent(replace(value, '&', ' and '))),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique,
  city text,
  bio text check (char_length(bio) <= 1000),
  avatar_path text,
  account_kind public.account_kind not null default 'private',
  role public.platform_role not null default 'user',
  phone_verified_at timestamptz,
  merchant_verified_at timestamptz,
  is_suspended boolean not null default false,
  rating_average numeric(3,2) not null default 0 check (rating_average between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  completed_deals_count integer not null default 0 check (completed_deals_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint username_length check (char_length(username::text) between 3 and 40),
  constraint merchant_verified_shape check (
    merchant_verified_at is null or account_kind = 'merchant'
  )
);

create index profiles_city_idx on public.profiles (city) where city is not null;
create index profiles_merchant_idx on public.profiles (merchant_verified_at desc)
  where merchant_verified_at is not null and not is_suspended;

create or replace function public.is_staff(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id
      and p.role in ('moderator', 'admin')
      and not p.is_suspended
  );
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.role = 'admin' and not p.is_suspended
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if requested_username !~ '^[[:alnum:]_.-]{3,40}$' then
    requested_username := 'user_' || replace(substr(new.id::text, 1, 12), '-', '');
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username)
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
  insert into public.profiles (id, username)
  values (new.id, 'user_' || replace(new.id::text, '-', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  status public.merchant_application_status not null default 'draft',
  legal_name text not null check (char_length(legal_name) between 2 and 200),
  registration_number text not null check (char_length(registration_number) between 4 and 64),
  registered_address text not null check (char_length(registered_address) between 5 and 500),
  website_url text,
  document_paths jsonb not null default '[]'::jsonb,
  declaration_accepted_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewer_notes text check (char_length(reviewer_notes) <= 4000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_document_paths_array check (jsonb_typeof(document_paths) = 'array'),
  constraint merchant_submission_shape check (
    status = 'draft' or (declaration_accepted_at is not null and submitted_at is not null)
  ),
  constraint merchant_review_shape check (
    (status <> 'under_review' or reviewer_id is not null)
    and (
      status not in ('approved', 'rejected')
      or (reviewer_id is not null and reviewed_at is not null)
    )
  )
);

create unique index merchant_one_open_application_idx
  on public.merchant_applications (applicant_id)
  where status in ('draft', 'submitted', 'under_review');

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  canonical_name extensions.citext not null,
  slug text not null,
  status public.brand_status not null default 'canonical',
  normalized_key text not null,
  submitted_display_name text,
  parent_brand_id uuid references public.brands(id) on delete set null,
  suggested_brand_id uuid references public.brands(id) on delete set null,
  merged_into_brand_id uuid references public.brands(id) on delete set null,
  provenance jsonb not null default '{"source":"editorial"}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  canonicalized_by uuid references public.profiles(id) on delete set null,
  canonicalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_name_length check (char_length(canonical_name::text) between 2 and 80),
  constraint brand_key_length check (char_length(normalized_key) between 1 and 100),
  constraint brand_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint brand_provenance_object check (jsonb_typeof(provenance) = 'object'),
  constraint brand_pending_shape check (
    status <> 'pending_canonicalization'
    or (submitted_display_name is not null and created_by is not null)
  ),
  constraint brand_submitted_content check (
    submitted_display_name is null
    or submitted_display_name !~* '(https?://|www\\.|@)'
  ),
  constraint brand_merged_shape check (
    status <> 'merged' or merged_into_brand_id is not null
  ),
  constraint brand_not_merged_into_self check (merged_into_brand_id is distinct from id)
);

create unique index brands_canonical_key_idx on public.brands (normalized_key)
  where status = 'canonical';
create unique index brands_canonical_slug_idx on public.brands (slug)
  where status = 'canonical';
create index brands_name_trgm_idx on public.brands
  using gin ((canonical_name::text) extensions.gin_trgm_ops);
create index brands_normalized_trgm_idx on public.brands
  using gin (normalized_key extensions.gin_trgm_ops);
create index brands_pending_idx on public.brands (created_at)
  where status = 'pending_canonicalization';

create table public.brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind public.brand_alias_kind not null default 'alternate',
  alias extensions.citext not null,
  normalized_alias text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_alias_length check (char_length(alias::text) between 1 and 100),
  unique (brand_id, normalized_alias)
);

create index brand_aliases_search_idx on public.brand_aliases
  using gin (normalized_alias extensions.gin_trgm_ops);

create table public.brand_collection_memberships (
  brand_id uuid not null references public.brands(id) on delete cascade,
  collection public.brand_collection not null,
  display_order smallint not null check (display_order between 1 and 200),
  reviewed_at date not null default current_date,
  primary key (brand_id, collection),
  unique (collection, display_order)
);

create table public.fragrances (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  name extensions.citext not null,
  normalized_name text not null,
  audience public.audience not null,
  segments public.segment[] not null default '{}'::public.segment[],
  concentration public.concentration,
  concentration_label text check (char_length(concentration_label) <= 80),
  fragrantica_url text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_name_length check (char_length(name::text) between 2 and 160),
  constraint fragrance_segments_unique check (public.array_has_unique_items(segments)),
  constraint fragrance_fragrantica_url check (
    fragrantica_url is null or fragrantica_url ~ '^https://www\\.fragrantica\\.com/perfume/'
  ),
  unique nulls not distinct (brand_id, normalized_name, concentration)
);

create index fragrances_name_trgm_idx on public.fragrances
  using gin ((name::text) extensions.gin_trgm_ops);
create index fragrances_normalized_trgm_idx on public.fragrances
  using gin (normalized_name extensions.gin_trgm_ops);
create index fragrances_audience_idx on public.fragrances (audience) where is_active;
create index fragrances_segments_idx on public.fragrances using gin (segments);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  kind public.listing_kind not null,
  deal_mode public.deal_mode not null,
  product_format public.product_format,
  audience public.audience not null,
  segments public.segment[] not null default '{}'::public.segment[],
  brand_id uuid not null references public.brands(id) on delete restrict,
  fragrance_id uuid references public.fragrances(id) on delete set null,
  fragrance_name text not null check (char_length(fragrance_name) between 2 and 160),
  brand_input_text text,
  brand_normalized_key text,
  suggested_brand_id uuid references public.brands(id) on delete set null,
  catalog_provenance jsonb not null default '{"source":"seller"}'::jsonb,
  concentration public.concentration not null,
  concentration_label text check (char_length(concentration_label) <= 80),
  fragrantica_url text,
  title text not null check (char_length(title) between 4 and 180),
  description text not null default '' check (char_length(description) <= 5000),
  city text not null check (char_length(city) between 2 and 100),
  bottle_volume_ml numeric(5,1),
  remaining_ml numeric(5,1),
  is_sealed boolean not null default false,
  price_minor integer,
  estimated_value_minor integer,
  max_budget_minor integer,
  status public.listing_status not null default 'draft',
  activated_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_segments_unique check (public.array_has_unique_items(segments)),
  constraint listing_catalog_provenance_object check (jsonb_typeof(catalog_provenance) = 'object'),
  constraint listing_fragrantica_url check (
    fragrantica_url is null or fragrantica_url ~ '^https://www\\.fragrantica\\.com/perfume/'
  ),
  constraint listing_bottle_range check (
    bottle_volume_ml is null or bottle_volume_ml between 0.1 and 500.0
  ),
  constraint listing_remaining_range check (
    remaining_ml is null or (remaining_ml >= 0 and remaining_ml <= bottle_volume_ml)
  ),
  constraint listing_sealed_full check (
    not is_sealed or (remaining_ml is not null and remaining_ml = bottle_volume_ml)
  ),
  constraint listing_positive_prices check (
    (price_minor is null or price_minor > 0)
    and (estimated_value_minor is null or estimated_value_minor > 0)
    and (max_budget_minor is null or max_budget_minor > 0)
  ),
  constraint listing_physical_item_shape check (
    (kind = 'offer' and product_format is not null and bottle_volume_ml is not null and remaining_ml is not null)
    or kind = 'wanted'
  ),
  constraint listing_price_shape check (
    (kind = 'wanted' and price_minor is null and estimated_value_minor is null)
    or (
      kind = 'offer'
      and max_budget_minor is null
      and (
        (deal_mode in ('sale', 'sale_or_swap') and price_minor is not null)
        or (deal_mode = 'swap' and price_minor is null)
      )
    )
  ),
  constraint listing_active_not_empty check (
    status <> 'active' or kind = 'wanted' or remaining_ml > 0
  )
);

create index listings_seller_status_idx on public.listings (seller_id, status, created_at desc);
create index listings_feed_idx on public.listings (status, activated_at desc)
  where status in ('active', 'reserved');
create index listings_filters_idx on public.listings (audience, deal_mode, product_format, status);
create index listings_segments_idx on public.listings using gin (segments);
create index listings_search_idx on public.listings using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(fragrance_name, '') || ' ' || coalesce(description, ''))
);
create index listings_name_trgm_idx on public.listings
  using gin (fragrance_name extensions.gin_trgm_ops);

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null unique,
  role public.photo_role not null,
  sort_order smallint not null default 0 check (sort_order between 0 and 50),
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text check (mime_type is null or mime_type in ('image/jpeg', 'image/webp', 'image/avif')),
  byte_size integer check (byte_size is null or byte_size between 1 and 10485760),
  width_px integer check (width_px is null or width_px between 1 and 10000),
  height_px integer check (height_px is null or height_px between 1 and 10000),
  sanitized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint listing_photo_sanitized_shape check (
    sanitized_at is null or (
      content_hash is not null and mime_type is not null and byte_size is not null
      and width_px is not null and height_px is not null
    )
  ),
  unique (listing_id, content_hash)
);

create index listing_photos_listing_idx on public.listing_photos (listing_id, sort_order);

create or replace function public.protect_listing_photo_processing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and (
      new.content_hash is not null or new.mime_type is not null or new.byte_size is not null
      or new.width_px is not null or new.height_px is not null or new.sanitized_at is not null
    ) then
      raise exception 'photo processing fields are server-managed' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.storage_path is distinct from old.storage_path
      or new.content_hash is distinct from old.content_hash
      or new.mime_type is distinct from old.mime_type
      or new.byte_size is distinct from old.byte_size
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.sanitized_at is distinct from old.sanitized_at
    ) then
      raise exception 'finalized photo identity is server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_listing_photo_processing
before insert or update on public.listing_photos
for each row execute function public.protect_listing_photo_processing();

create table public.listing_authenticity_reviews (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.authenticity_review_status not null default 'pending',
  public_note text check (char_length(public_note) <= 500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authenticity_review_result_shape check (
    (status = 'pending' and reviewed_at is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

create table public.favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, listing_id)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  filters jsonb not null default '{}'::jsonb,
  notifications_enabled boolean not null default false,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_search_filters_object check (jsonb_typeof(filters) = 'object')
);

create index saved_searches_profile_idx on public.saved_searches (profile_id, created_at desc);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  offerer_id uuid not null references public.profiles(id) on delete cascade,
  kind public.offer_kind not null,
  cash_amount_minor integer,
  offered_listing_id uuid references public.listings(id) on delete set null,
  message text check (char_length(message) <= 1000),
  status public.offer_status not null default 'pending',
  expires_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_cash_positive check (cash_amount_minor is null or cash_amount_minor > 0),
  constraint offer_value_shape check (
    (kind = 'cash' and cash_amount_minor is not null and offered_listing_id is null)
    or (kind = 'swap' and cash_amount_minor is null and offered_listing_id is not null)
    or (kind = 'cash_plus_swap' and cash_amount_minor is not null and offered_listing_id is not null)
  )
);

create index offers_listing_idx on public.offers (listing_id, status, created_at desc);
create index offers_offerer_idx on public.offers (offerer_id, status, created_at desc);
create unique index offers_one_pending_shape_idx
  on public.offers (listing_id, offerer_id, kind, coalesce(offered_listing_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  accepted_offer_id uuid not null unique references public.offers(id) on delete restrict,
  status public.conversation_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted_at timestamptz,
  blocked_at timestamptz,
  primary key (conversation_id, profile_id)
);

create index conversation_members_profile_idx
  on public.conversation_members (profile_id, joined_at desc);

create or replace function public.protect_conversation_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.profile_id is distinct from old.profile_id
     or new.joined_at is distinct from old.joined_at
  then
    raise exception 'conversation membership identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_conversation_membership_identity
before update on public.conversation_members
for each row execute function public.protect_conversation_membership_identity();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  reply_to_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  offered_listing_id uuid references public.listings(id) on delete restrict,
  accepted_offer_id uuid not null unique references public.offers(id) on delete restrict,
  party_a_id uuid not null references public.profiles(id) on delete restrict,
  party_b_id uuid not null references public.profiles(id) on delete restrict,
  status public.deal_status not null default 'pending_confirmation',
  completed_at timestamptz,
  disputed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancellation_reason text check (char_length(cancellation_reason) between 2 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_distinct_parties check (party_a_id <> party_b_id),
  constraint deal_distinct_listings check (offered_listing_id is null or offered_listing_id <> listing_id),
  constraint deal_completed_shape check (
    (status = 'completed' and completed_at is not null) or status <> 'completed'
  ),
  constraint deal_cancelled_shape check (
    (
      status = 'cancelled' and cancelled_at is not null and cancelled_by is not null
      and cancellation_reason is not null
    )
    or status <> 'cancelled'
  )
);

create index deals_party_a_idx on public.deals (party_a_id, status, created_at desc);
create index deals_party_b_idx on public.deals (party_b_id, status, created_at desc);
create unique index deals_live_listing_idx on public.deals (listing_id)
  where status <> 'cancelled';
create unique index deals_live_offered_listing_idx on public.deals (offered_listing_id)
  where offered_listing_id is not null and status <> 'cancelled';

create table public.deal_listing_locks (
  listing_id uuid primary key references public.listings(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete cascade,
  item_role text not null check (item_role in ('target', 'offered')),
  created_at timestamptz not null default now(),
  unique (deal_id, item_role)
);

create or replace function public.sync_deal_listing_locks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'cancelled' then
    insert into public.deal_listing_locks (listing_id, deal_id, item_role)
    values (new.listing_id, new.id, 'target');
    if new.offered_listing_id is not null then
      insert into public.deal_listing_locks (listing_id, deal_id, item_role)
      values (new.offered_listing_id, new.id, 'offered');
    end if;
  elsif old.status <> 'cancelled' and new.status = 'cancelled' then
    delete from public.deal_listing_locks where deal_id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_deal_listing_locks
after insert or update of status on public.deals
for each row execute function public.sync_deal_listing_locks();

create or replace function public.protect_deal_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.listing_id is distinct from old.listing_id
     or new.offered_listing_id is distinct from old.offered_listing_id
     or new.accepted_offer_id is distinct from old.accepted_offer_id
     or new.party_a_id is distinct from old.party_a_id
     or new.party_b_id is distinct from old.party_b_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'deal identity is immutable' using errcode = '23514';
  end if;

  if old.status in ('completed', 'cancelled')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at')
  then
    raise exception 'completed and cancelled deals are immutable' using errcode = '23514';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'pending_confirmation' and new.status in ('completed', 'disputed', 'cancelled'))
    or (old.status = 'disputed' and new.status in ('pending_confirmation', 'cancelled'))
  ) then
    raise exception 'invalid or terminal deal status transition' using errcode = '23514';
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.completed_at is distinct from old.completed_at then
    raise exception 'completed timestamp is server-managed' using errcode = '42501';
  end if;
  if new.status = 'disputed' then
    new.disputed_at := coalesce(new.disputed_at, now());
  elsif new.disputed_at is distinct from old.disputed_at then
    raise exception 'dispute timestamp is server-managed' using errcode = '42501';
  end if;
  if new.status <> 'cancelled' and (
    new.cancelled_at is distinct from old.cancelled_at
    or new.cancelled_by is distinct from old.cancelled_by
    or new.cancellation_reason is distinct from old.cancellation_reason
  ) then
    raise exception 'cancellation fields require the cancellation workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_deal_state
before update on public.deals
for each row execute function public.protect_deal_state();

create table public.deal_confirmations (
  deal_id uuid not null references public.deals(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (deal_id, profile_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  reviewee_id uuid not null references public.profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  body text check (char_length(body) <= 2000),
  status public.review_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_not_self check (reviewer_id <> reviewee_id),
  unique (deal_id, reviewer_id)
);

create index reviews_reviewee_idx on public.reviews (reviewee_id, status, created_at desc);

create table public.profile_comments (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  status public.review_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_comment_not_self check (author_id <> profile_id)
);

create index profile_comments_profile_idx
  on public.profile_comments (profile_id, status, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type public.report_target_type not null,
  target_id uuid not null,
  reason_code text not null check (char_length(reason_code) between 2 and 80),
  details text check (char_length(details) <= 4000),
  evidence_paths jsonb not null default '[]'::jsonb,
  status public.report_status not null default 'open',
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution_code text,
  resolution_notes text check (char_length(resolution_notes) <= 4000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_evidence_array check (jsonb_typeof(evidence_paths) = 'array'),
  constraint report_assignment_shape check (
    status <> 'investigating' or assigned_to is not null
  ),
  constraint report_resolution_shape check (
    (status in ('resolved', 'dismissed')) = (resolved_at is not null)
  )
);

create index reports_queue_idx on public.reports (status, created_at)
  where status in ('open', 'investigating');
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_target_idx on public.reports (target_type, target_id, created_at desc);

create table public.moderation_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  report_id uuid references public.reports(id) on delete set null,
  action public.moderation_action not null,
  target_type public.report_target_type not null,
  target_id uuid not null,
  rationale text not null check (char_length(rationale) between 2 and 4000),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index moderation_audit_target_idx
  on public.moderation_audit (target_type, target_id, created_at desc);
create index moderation_audit_actor_idx on public.moderation_audit (actor_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  provider public.payment_provider not null,
  purpose public.payment_purpose not null,
  external_payment_id text,
  external_event_id text,
  idempotency_key text not null unique,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status public.payment_status not null default 'created',
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (provider, external_payment_id),
  unique (provider, external_event_id)
);

create index payments_profile_idx on public.payments (profile_id, created_at desc);
create index payments_pending_idx on public.payments (status, created_at)
  where status in ('created', 'pending');

create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid references public.payments(id) on delete restrict,
  provider public.payment_provider not null,
  external_event_id text not null,
  external_payment_id text,
  event_type text not null check (char_length(event_type) between 2 and 100),
  signature_verified boolean not null,
  processing_result text not null check (
    processing_result in ('accepted', 'duplicate', 'rejected', 'ignored')
  ),
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint payment_event_payload_object check (jsonb_typeof(payload) = 'object'),
  unique (provider, external_event_id)
);

create index payment_events_payment_idx
  on public.payment_events (payment_id, received_at desc);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider public.payment_provider not null,
  provider_refund_id text,
  idempotency_key text not null unique,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'created' check (
    status in ('created', 'pending', 'succeeded', 'failed', 'cancelled')
  ),
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_refund_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint payment_refund_completion_shape check (
    (status = 'succeeded') = (completed_at is not null)
  ),
  unique (provider, provider_refund_id)
);

create index payment_refunds_payment_idx
  on public.payment_refunds (payment_id, created_at desc);

create or replace function public.protect_payment_event_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment events are append-only' using errcode = '42501';
end;
$$;

create trigger protect_payment_event_append_only
before update or delete on public.payment_events
for each row execute function public.protect_payment_event_append_only();

create or replace function public.validate_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_payment public.payments%rowtype;
  reserved_total bigint;
begin
  if tg_op = 'UPDATE' and (
    new.payment_id is distinct from old.payment_id
    or new.provider is distinct from old.provider
    or new.idempotency_key is distinct from old.idempotency_key
    or new.amount_minor is distinct from old.amount_minor
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'refund identity and amount are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'succeeded' and new.status <> 'succeeded' then
    raise exception 'a succeeded refund is terminal' using errcode = '23514';
  end if;

  select * into target_payment
  from public.payments
  where id = new.payment_id
  for update;
  if not found
     or target_payment.provider <> new.provider
     or target_payment.currency <> new.currency
     or target_payment.status not in ('paid', 'partially_refunded', 'refunded')
  then
    raise exception 'refund does not match a paid payment' using errcode = '23514';
  end if;

  select coalesce(sum(pr.amount_minor), 0)
  into reserved_total
  from public.payment_refunds pr
  where pr.payment_id = new.payment_id
    and pr.id <> new.id
    and pr.status in ('created', 'pending', 'succeeded');
  if new.status in ('created', 'pending', 'succeeded')
     and reserved_total + new.amount_minor > target_payment.amount_minor
  then
    raise exception 'refund total exceeds the original payment' using errcode = '23514';
  end if;

  if new.status = 'succeeded' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger validate_payment_refund
before insert or update on public.payment_refunds
for each row execute function public.validate_payment_refund();

create or replace function public.apply_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  refunded_total bigint;
  payment_total integer;
begin
  if new.status <> 'succeeded' or (tg_op = 'UPDATE' and old.status = 'succeeded') then
    return new;
  end if;
  select coalesce(sum(amount_minor), 0)
  into refunded_total
  from public.payment_refunds
  where payment_id = new.payment_id and status = 'succeeded';
  select amount_minor into payment_total from public.payments where id = new.payment_id;
  update public.payments
  set status = case
        when refunded_total >= payment_total then 'refunded'::public.payment_status
        else 'partially_refunded'::public.payment_status
      end,
      refunded_at = case when refunded_total >= payment_total then now() else refunded_at end
  where id = new.payment_id;
  return new;
end;
$$;

create trigger apply_payment_refund
after insert or update of status on public.payment_refunds
for each row execute function public.apply_payment_refund();

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind public.entitlement_kind not null,
  quantity integer not null default 1 check (quantity > 0),
  source_payment_id uuid references public.payments(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint entitlement_window check (expires_at is null or expires_at > starts_at),
  constraint entitlement_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint entitlement_boost_shape check (
    (kind = 'boost' and listing_id is not null) or (kind <> 'boost' and listing_id is null)
  )
);

create index entitlements_active_idx on public.entitlements (profile_id, kind, expires_at)
  where revoked_at is null;
create unique index entitlement_one_active_plan_idx on public.entitlements (profile_id)
  where kind in ('merchant_start', 'merchant_pro') and revoked_at is null;

create or replace function public.replace_current_merchant_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('merchant_start', 'merchant_pro') then
    update public.entitlements
    set revoked_at = now(),
        metadata = metadata || jsonb_build_object(
          'supersededAt', now(),
          'supersededByPaymentId', new.source_payment_id
        )
    where profile_id = new.profile_id
      and kind in ('merchant_start', 'merchant_pro')
      and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger replace_current_merchant_plan
before insert on public.entitlements
for each row execute function public.replace_current_merchant_plan();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind public.notification_kind not null,
  status public.notification_status not null default 'unread',
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  action_url text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_data_object check (jsonb_typeof(data) = 'object')
);

create index notifications_inbox_idx on public.notifications (profile_id, status, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger merchant_applications_set_updated_at before update on public.merchant_applications
for each row execute function public.set_updated_at();
create trigger brands_set_updated_at before update on public.brands
for each row execute function public.set_updated_at();
create trigger fragrances_set_updated_at before update on public.fragrances
for each row execute function public.set_updated_at();
create trigger listings_set_updated_at before update on public.listings
for each row execute function public.set_updated_at();
create trigger saved_searches_set_updated_at before update on public.saved_searches
for each row execute function public.set_updated_at();
create trigger listing_authenticity_reviews_set_updated_at
before update on public.listing_authenticity_reviews
for each row execute function public.set_updated_at();
create trigger offers_set_updated_at before update on public.offers
for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.set_updated_at();
create trigger deals_set_updated_at before update on public.deals
for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews
for each row execute function public.set_updated_at();
create trigger profile_comments_set_updated_at before update on public.profile_comments
for each row execute function public.set_updated_at();
create trigger reports_set_updated_at before update on public.reports
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();
create trigger payment_refunds_set_updated_at before update on public.payment_refunds
for each row execute function public.set_updated_at();

create or replace function public.normalize_brand_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_key := public.normalize_catalog_key(new.canonical_name::text);
  return new;
end;
$$;

create trigger normalize_brand_fields
before insert or update of canonical_name on public.brands
for each row execute function public.normalize_brand_fields();

create or replace function public.normalize_brand_alias_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_alias := public.normalize_catalog_key(new.alias::text);
  return new;
end;
$$;

create trigger normalize_brand_alias_fields
before insert or update of alias on public.brand_aliases
for each row execute function public.normalize_brand_alias_fields();

create or replace function public.normalize_fragrance_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_name := public.normalize_catalog_key(new.name::text);
  return new;
end;
$$;

create trigger normalize_fragrance_fields
before insert or update of name on public.fragrances
for each row execute function public.normalize_fragrance_fields();

create or replace function public.normalize_listing_brand_input()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_input_text is not null then
    new.brand_normalized_key := public.normalize_catalog_key(new.brand_input_text);
  else
    new.brand_normalized_key := null;
  end if;
  return new;
end;
$$;

create trigger normalize_listing_brand_input
before insert or update of brand_input_text on public.listings
for each row execute function public.normalize_listing_brand_input();

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and pg_trigger_depth() <= 1
     and (
       new.account_kind is distinct from old.account_kind
       or new.role is distinct from old.role
       or new.phone_verified_at is distinct from old.phone_verified_at
       or new.merchant_verified_at is distinct from old.merchant_verified_at
       or new.is_suspended is distinct from old.is_suspended
       or new.rating_average is distinct from old.rating_average
       or new.rating_count is distinct from old.rating_count
       or new.completed_deals_count is distinct from old.completed_deals_count
       or new.created_at is distinct from old.created_at
       or new.last_seen_at is distinct from old.last_seen_at
     )
  then
    raise exception 'privileged profile fields cannot be changed by this user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileged_fields
before update on public.profiles
for each row execute function public.protect_profile_privileged_fields();

create or replace function public.protect_merchant_review_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() = old.applicant_id then
    if new.reviewer_id is distinct from old.reviewer_id
       or new.reviewer_notes is distinct from old.reviewer_notes
       or new.reviewed_at is distinct from old.reviewed_at
       or new.status in ('under_review', 'approved', 'rejected')
    then
      raise exception 'merchant review fields require staff access' using errcode = '42501';
    end if;
    if (old.status = 'draft' and new.status not in ('draft', 'submitted', 'withdrawn'))
       or (old.status = 'submitted' and new.status not in ('submitted', 'withdrawn'))
       or old.status not in ('draft', 'submitted')
    then
      raise exception 'invalid merchant application transition' using errcode = '23514';
    end if;
  end if;
  if new.applicant_id is distinct from old.applicant_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'merchant application identity is immutable' using errcode = '23514';
  end if;
  if current_user = 'authenticated' and public.is_staff()
     and auth.uid() <> old.applicant_id
  then
    if new.legal_name is distinct from old.legal_name
       or new.registration_number is distinct from old.registration_number
       or new.registered_address is distinct from old.registered_address
       or new.website_url is distinct from old.website_url
       or new.document_paths is distinct from old.document_paths
       or new.declaration_accepted_at is distinct from old.declaration_accepted_at
       or new.submitted_at is distinct from old.submitted_at
    then
      raise exception 'staff may review but not rewrite applicant-submitted data'
        using errcode = '42501';
    end if;
    if new.reviewer_id is distinct from old.reviewer_id
       and new.reviewer_id is distinct from auth.uid()
       and not public.is_admin()
    then
      raise exception 'moderators may only assign the application to themselves'
        using errcode = '42501';
    end if;

    if old.status = 'submitted' and new.status = 'under_review' then
      new.reviewer_id := auth.uid();
      new.reviewed_at := null;
    elsif old.status = 'under_review' and new.status in ('approved', 'rejected') then
      if old.reviewer_id is distinct from auth.uid() and not public.is_admin() then
        raise exception 'only the assigned reviewer may close this application'
          using errcode = '42501';
      end if;
      new.reviewer_id := coalesce(old.reviewer_id, auth.uid());
      new.reviewed_at := now();
    elsif new.status is distinct from old.status then
      raise exception 'invalid staff merchant application transition'
        using errcode = '23514';
    elsif old.status in ('under_review', 'approved', 'rejected')
          and old.reviewer_id is distinct from auth.uid()
          and not public.is_admin()
    then
      raise exception 'application belongs to another reviewer'
        using errcode = '42501';
    end if;
  end if;
  if current_user = 'authenticated'
     and auth.uid() = old.applicant_id
     and new.status in ('under_review', 'approved', 'rejected')
  then
    raise exception 'staff cannot review their own merchant application'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_merchant_review_fields
before update on public.merchant_applications
for each row execute function public.protect_merchant_review_fields();

create or replace function public.apply_merchant_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name public.moderation_action;
begin
  if new.status is not distinct from old.status
     or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  if not public.is_staff() then
    raise exception 'merchant review requires staff access' using errcode = '42501';
  end if;

  if new.status = 'approved' then
    update public.profiles
    set account_kind = 'merchant', merchant_verified_at = coalesce(merchant_verified_at, now())
    where id = new.applicant_id;
    action_name := 'merchant_verified';
  else
    action_name := 'merchant_rejected';
  end if;

  insert into public.moderation_audit (
    actor_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), action_name, 'profile', new.applicant_id,
    coalesce(nullif(trim(new.reviewer_notes), ''), 'Merchant application reviewed.'),
    to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

create trigger apply_merchant_review
after update on public.merchant_applications
for each row execute function public.apply_merchant_review();

create or replace function public.require_brand_merge_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and old.status = 'pending_canonicalization'
     and new.status = 'merged'
  then
    raise exception 'use canonicalize_brand so the merge is audited' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger require_brand_merge_workflow
before update on public.brands
for each row execute function public.require_brand_merge_workflow();

create or replace function public.protect_listing_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := false;
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

create trigger protect_listing_state
before update on public.listings
for each row execute function public.protect_listing_state();

create or replace function public.effective_listing_limit(target_profile_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_limit integer;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'authentication required' using errcode = '42501';
    end if;
  elsif target_profile_id <> auth.uid() and not public.is_staff() then
    raise exception 'listing limit is private to the profile' using errcode = '42501';
  end if;

  with active_entitlements as (
    select kind, quantity
    from public.entitlements
    where profile_id = target_profile_id
      and revoked_at is null
      and starts_at <= now()
      and (expires_at is null or expires_at > now())
  ), plan_limit as (
    select case
      when bool_or(kind = 'merchant_pro') then 200
      when bool_or(kind = 'merchant_start') then 50
      else 10
    end as base_limit
    from active_entitlements
  )
  select coalesce((select base_limit from plan_limit), 10)
    + coalesce((
      select sum(quantity)::integer
      from active_entitlements
      where kind = 'extra_listing_slot'
    ), 0)
  into result_limit;

  return result_limit;
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
  active_count integer;
  listing_limit integer;
  verified_at timestamptz;
  photo_roles public.photo_role[];
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.seller_id::text, 20260720)
  );

  select p.phone_verified_at into verified_at
  from public.profiles p where p.id = new.seller_id and not p.is_suspended
  for update;
  if verified_at is null then
    raise exception 'phone verification is required before listing activation'
      using errcode = '23514';
  end if;

  if new.kind = 'offer' and coalesce(new.remaining_ml, 0) <= 0 then
    raise exception 'an active offer listing cannot be empty' using errcode = '23514';
  end if;

  if new.kind = 'offer' then
    select count(*), coalesce(array_agg(distinct lp.role), '{}'::public.photo_role[])
      into photo_count, photo_roles
    from public.listing_photos lp
    where lp.listing_id = new.id and lp.sanitized_at is not null;
    if photo_count < 4 then
      raise exception 'at least four distinct photos are required' using errcode = '23514';
    end if;

    if new.product_format = 'official_sample' then
      if not (photo_roles @> array[
        'product_full'::public.photo_role,
        'manufacturer_label'::public.photo_role,
        'manufacturer_markings'::public.photo_role
      ]) then
        raise exception 'official sample evidence photos are incomplete' using errcode = '23514';
      end if;
    elsif new.is_sealed then
      if not (photo_roles @> array[
        'box_front'::public.photo_role,
        'box_bottom'::public.photo_role,
        'batch_code'::public.photo_role,
        'seal'::public.photo_role
      ]) then
        raise exception 'sealed product evidence photos are incomplete' using errcode = '23514';
      end if;
    else
      if not (photo_roles @> array[
        'product_full'::public.photo_role,
        'bottle_bottom'::public.photo_role,
        'batch_code'::public.photo_role,
        'fill_level'::public.photo_role
      ]) then
        raise exception 'opened product evidence photos are incomplete' using errcode = '23514';
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
    new.activated_at := now();
    new.expires_at := now() + interval '60 days';
  elsif new.expires_at is null then
    new.expires_at := new.activated_at + interval '60 days';
  end if;
  return new;
end;
$$;

create trigger validate_listing_activation
before insert or update on public.listings
for each row execute function public.validate_listing_activation();

create or replace function public.validate_offer_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.listings%rowtype;
  swap_item public.listings%rowtype;
  phone_verified timestamptz;
begin
  if tg_op = 'UPDATE' then
    if row(
         new.listing_id, new.offerer_id, new.kind, new.cash_amount_minor,
         new.offered_listing_id, new.expires_at
       )
       is distinct from
       row(
         old.listing_id, old.offerer_id, old.kind, old.cash_amount_minor,
         old.offered_listing_id, old.expires_at
       )
    then
      raise exception 'offer terms are immutable; withdraw and create a new offer'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.status <> 'pending' then
    raise exception 'new offers must be pending' using errcode = '23514';
  end if;
  new.expires_at := coalesce(new.expires_at, now() + interval '7 days');
  if new.expires_at <= now() or new.expires_at > now() + interval '30 days' then
    raise exception 'offer expiry must be within the next 30 days' using errcode = '23514';
  end if;

  select * into target from public.listings where id = new.listing_id;
  if not found
     or target.status <> 'active'
     or target.expires_at is null
     or target.expires_at <= now()
  then
    raise exception 'offers require an active listing' using errcode = '23514';
  end if;
  if target.seller_id = new.offerer_id then
    raise exception 'self offers are not allowed' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = target.seller_id and not p.is_suspended
  ) then
    raise exception 'offers are unavailable for this seller' using errcode = '42501';
  end if;
  if (target.deal_mode = 'sale' and new.kind <> 'cash')
     or (target.deal_mode = 'swap' and new.kind <> 'swap') then
    raise exception 'offer kind is incompatible with listing deal mode' using errcode = '23514';
  end if;

  select phone_verified_at into phone_verified
  from public.profiles where id = new.offerer_id and not is_suspended;
  if phone_verified is null then
    raise exception 'phone verification is required before making an offer' using errcode = '23514';
  end if;

  if new.offered_listing_id is not null then
    select * into swap_item from public.listings where id = new.offered_listing_id;
    if not found
       or swap_item.seller_id <> new.offerer_id
       or swap_item.status <> 'active'
       or swap_item.expires_at is null
       or swap_item.expires_at <= now()
       or swap_item.kind <> 'offer'
       or swap_item.deal_mode not in ('swap', 'sale_or_swap')
       or coalesce(swap_item.remaining_ml, 0) <= 0
    then
      raise exception 'swap item must be an active listing owned by the offerer' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_offer_write
before insert or update on public.offers
for each row execute function public.validate_offer_write();

create or replace function public.validate_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.status = 'open'
  ) then
    raise exception 'messages require an open conversation' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.conversation_id = new.conversation_id
      and cm.profile_id = new.sender_id
      and cm.blocked_at is null
      and not p.is_suspended
  ) then
    raise exception 'sender is not an active conversation member' using errcode = '42501';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply target belongs to another conversation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_message_write
before insert or update on public.messages
for each row execute function public.validate_message_write();

create or replace function public.protect_message_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.created_at is distinct from old.created_at then
    raise exception 'message identity fields are immutable' using errcode = '23514';
  end if;
  if new.body is distinct from old.body and new.edited_at is null then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger protect_message_identity
before update on public.messages
for each row execute function public.protect_message_identity();

create or replace function public.accept_offer(target_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_offer public.offers%rowtype;
  selected_listing public.listings%rowtype;
  swap_listing public.listings%rowtype;
  conversation_id uuid;
  deal_id uuid;
begin
  select * into selected_offer from public.offers where id = target_offer_id;
  if not found then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;

  perform l.id
  from public.listings l
  where l.id in (selected_offer.listing_id, selected_offer.offered_listing_id)
  order by l.id
  for update;

  select * into selected_offer from public.offers where id = target_offer_id for update;
  if not found
     or selected_offer.status <> 'pending'
     or selected_offer.expires_at is null
     or selected_offer.expires_at <= now()
  then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;

  select * into selected_listing from public.listings
  where id = selected_offer.listing_id;
  if selected_listing.seller_id <> auth.uid() then
    raise exception 'only the seller can accept this offer' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles seller
    join public.profiles offerer on offerer.id = selected_offer.offerer_id
    where seller.id = selected_listing.seller_id
      and not seller.is_suspended
      and not offerer.is_suspended
  ) then
    raise exception 'both offer participants must be active' using errcode = '42501';
  end if;
  if selected_listing.status <> 'active'
     or selected_listing.expires_at is null
     or selected_listing.expires_at <= now()
  then
    raise exception 'listing is no longer active' using errcode = '23514';
  end if;
  if (selected_listing.deal_mode = 'sale' and selected_offer.kind <> 'cash')
     or (selected_listing.deal_mode = 'swap' and selected_offer.kind <> 'swap')
  then
    raise exception 'offer is no longer compatible with the listing terms'
      using errcode = '23514';
  end if;

  if selected_offer.offered_listing_id is not null then
    select * into swap_listing from public.listings
    where id = selected_offer.offered_listing_id;
    if not found
       or swap_listing.seller_id <> selected_offer.offerer_id
       or swap_listing.status <> 'active'
       or swap_listing.expires_at is null
       or swap_listing.expires_at <= now()
       or swap_listing.kind <> 'offer'
       or swap_listing.deal_mode not in ('swap', 'sale_or_swap')
       or coalesce(swap_listing.remaining_ml, 0) <= 0
    then
      raise exception 'offered swap listing is no longer available' using errcode = '23514';
    end if;
  end if;

  update public.offers
  set status = 'accepted', responded_at = now()
  where id = selected_offer.id;
  update public.offers
  set status = 'declined', responded_at = now()
  where listing_id = selected_listing.id and id <> selected_offer.id and status = 'pending';
  update public.offers
  set status = 'expired', responded_at = now()
  where id <> selected_offer.id
    and status = 'pending'
    and (
      listing_id in (selected_listing.id, selected_offer.offered_listing_id)
      or offered_listing_id in (selected_listing.id, selected_offer.offered_listing_id)
    );
  update public.listings
  set status = 'reserved'
  where id in (selected_listing.id, selected_offer.offered_listing_id);

  insert into public.conversations (listing_id, accepted_offer_id)
  values (selected_listing.id, selected_offer.id)
  returning id into conversation_id;
  insert into public.conversation_members (conversation_id, profile_id)
  values
    (conversation_id, selected_listing.seller_id),
    (conversation_id, selected_offer.offerer_id);

  insert into public.deals (
    listing_id, offered_listing_id, accepted_offer_id, party_a_id, party_b_id
  )
  values (
    selected_listing.id,
    selected_offer.offered_listing_id,
    selected_offer.id,
    selected_listing.seller_id,
    selected_offer.offerer_id
  ) returning id into deal_id;

  insert into public.notifications (profile_id, kind, title, body, action_url, data)
  values (
    selected_offer.offerer_id,
    'offer_accepted',
    'Офертата ви е приета',
    'Продължете уточняването в личния чат.',
    '/messages/' || conversation_id::text,
    jsonb_build_object('offerId', selected_offer.id, 'listingId', selected_listing.id, 'dealId', deal_id)
  );
  return deal_id;
end;
$$;

create or replace function public.cancel_deal(
  target_deal_id uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
begin
  if char_length(trim(coalesce(reason, ''))) < 2 then
    raise exception 'cancellation reason is required' using errcode = '23514';
  end if;

  select * into target_deal
  from public.deals
  where id = target_deal_id
  for update;
  if not found
     or target_deal.status <> 'pending_confirmation'
     or auth.uid() is null
     or auth.uid() not in (target_deal.party_a_id, target_deal.party_b_id)
  then
    raise exception 'pending deal is not available to this participant' using errcode = '42501';
  end if;

  perform l.id
  from public.listings l
  where l.id in (target_deal.listing_id, target_deal.offered_listing_id)
  order by l.id
  for update;

  delete from public.deal_confirmations where deal_id = target_deal.id;
  update public.deals
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = trim(reason)
  where id = target_deal.id;

  update public.listings
  set status = 'paused'
  where id in (target_deal.listing_id, target_deal.offered_listing_id)
    and status = 'reserved';

  update public.conversations
  set status = 'archived'
  where accepted_offer_id = target_deal.accepted_offer_id;
end;
$$;

create or replace function public.decline_offer(target_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_offer public.offers%rowtype;
  seller_id uuid;
begin
  select * into selected_offer from public.offers where id = target_offer_id for update;
  select l.seller_id into seller_id from public.listings l where l.id = selected_offer.listing_id;
  if selected_offer.status <> 'pending' or seller_id <> auth.uid() then
    raise exception 'pending offer not available to this seller' using errcode = '42501';
  end if;
  update public.offers set status = 'declined', responded_at = now() where id = target_offer_id;
end;
$$;

create or replace function public.validate_deal_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
begin
  select * into target_deal from public.deals where id = new.deal_id for update;
  if target_deal.status <> 'pending_confirmation' then
    raise exception 'deal is not awaiting confirmation' using errcode = '23514';
  end if;
  if new.profile_id not in (target_deal.party_a_id, target_deal.party_b_id) then
    raise exception 'profile is not a deal participant' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id in (target_deal.party_a_id, target_deal.party_b_id)
      and p.is_suspended
  ) then
    raise exception 'suspended participants cannot confirm a deal' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> new.profile_id then
    raise exception 'cannot confirm a deal for another user' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger validate_deal_confirmation
before insert on public.deal_confirmations
for each row execute function public.validate_deal_confirmation();

create or replace function public.complete_mutually_confirmed_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
begin
  select * into target_deal from public.deals where id = new.deal_id for update;
  if exists (
    select 1 from public.deal_confirmations where deal_id = new.deal_id and profile_id = target_deal.party_a_id
  ) and exists (
    select 1 from public.deal_confirmations where deal_id = new.deal_id and profile_id = target_deal.party_b_id
  ) then
    update public.deals set status = 'completed', completed_at = now() where id = new.deal_id;
    update public.listings
    set status = 'completed', completed_at = now()
    where id in (target_deal.listing_id, target_deal.offered_listing_id);
    update public.profiles
      set completed_deals_count = completed_deals_count + 1
      where id in (target_deal.party_a_id, target_deal.party_b_id);
    insert into public.notifications (profile_id, kind, title, body, data)
    values
      (target_deal.party_a_id, 'deal_completed', 'Сделката е потвърдена', 'Вече можете да оставите отзив.', jsonb_build_object('dealId', new.deal_id)),
      (target_deal.party_b_id, 'deal_completed', 'Сделката е потвърдена', 'Вече можете да оставите отзив.', jsonb_build_object('dealId', new.deal_id));
  end if;
  return new;
end;
$$;

create trigger complete_mutually_confirmed_deal
after insert on public.deal_confirmations
for each row execute function public.complete_mutually_confirmed_deal();

create or replace function public.validate_review_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
begin
  select * into target_deal from public.deals where id = new.deal_id;
  if not found or target_deal.status <> 'completed' then
    raise exception 'reviews require a mutually confirmed deal' using errcode = '23514';
  end if;
  if new.reviewer_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewee_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewer_id = new.reviewee_id then
    raise exception 'review parties do not match the deal' using errcode = '23514';
  end if;
  if auth.uid() is not null and auth.uid() <> new.reviewer_id and not public.is_staff() then
    raise exception 'cannot author a review for another profile' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.deal_id is distinct from old.deal_id
    or new.reviewer_id is distinct from old.reviewer_id
    or new.reviewee_id is distinct from old.reviewee_id
  ) then
    raise exception 'review identity fields are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_review_write
before insert or update on public.reviews
for each row execute function public.validate_review_write();

create or replace function public.protect_review_moderation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and public.is_staff()
     and auth.uid() is distinct from old.reviewer_id
     and (
       new.deal_id is distinct from old.deal_id
       or new.reviewer_id is distinct from old.reviewer_id
       or new.reviewee_id is distinct from old.reviewee_id
       or new.rating is distinct from old.rating
       or new.body is distinct from old.body
       or new.created_at is distinct from old.created_at
     )
  then
    raise exception 'moderators may only change review visibility status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_review_moderation
before update on public.reviews
for each row execute function public.protect_review_moderation();

create or replace function public.protect_profile_comment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_id is distinct from old.author_id
     or new.profile_id is distinct from old.profile_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'profile comment identity is immutable' using errcode = '23514';
  end if;
  if current_user = 'authenticated'
     and public.is_staff()
     and auth.uid() is distinct from old.author_id
     and new.body is distinct from old.body
  then
    raise exception 'moderators may only change comment visibility status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_comment_update
before update on public.profile_comments
for each row execute function public.protect_profile_comment_update();

create or replace function public.refresh_profile_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_profile uuid;
begin
  affected_profile := coalesce(new.reviewee_id, old.reviewee_id);
  update public.profiles p
  set rating_average = coalesce(stats.average_rating, 0),
      rating_count = coalesce(stats.review_count, 0)
  from (
    select round(avg(r.rating)::numeric, 2) as average_rating, count(*)::integer as review_count
    from public.reviews r
    where r.reviewee_id = affected_profile and r.status = 'published'
  ) stats
  where p.id = affected_profile;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger refresh_profile_rating
after insert or update or delete on public.reviews
for each row execute function public.refresh_profile_rating();

create or replace function public.protect_notification_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    new.profile_id is distinct from old.profile_id
    or new.kind is distinct from old.kind
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.action_url is distinct from old.action_url
    or new.data is distinct from old.data
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only notification read state can be changed' using errcode = '42501';
  end if;
  if new.status = 'read' and old.status <> 'read' and new.read_at is null then
    new.read_at := now();
  end if;
  return new;
end;
$$;

create trigger protect_notification_content
before update on public.notifications
for each row execute function public.protect_notification_content();

create or replace function public.validate_report_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  if new.reporter_id <> auth.uid() then
    raise exception 'cannot create a report for another profile' using errcode = '42501';
  end if;
  if new.status <> 'open'
     or new.assigned_to is not null
     or new.resolution_code is not null
     or new.resolution_notes is not null
     or new.resolved_at is not null
  then
    raise exception 'report workflow fields are server-managed' using errcode = '42501';
  end if;

  case new.target_type
    when 'profile' then
      select exists (select 1 from public.profiles p where p.id = new.target_id)
        into allowed;
    when 'brand' then
      select exists (select 1 from public.brands b where b.id = new.target_id)
        into allowed;
    when 'listing' then
      select exists (select 1 from public.listings l where l.id = new.target_id)
        into allowed;
    when 'offer' then
      select exists (
        select 1 from public.offers o
        join public.listings l on l.id = o.listing_id
        where o.id = new.target_id
          and (o.offerer_id = new.reporter_id or l.seller_id = new.reporter_id)
      ) into allowed;
    when 'conversation' then
      select exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = new.target_id
          and cm.profile_id = new.reporter_id
          and cm.blocked_at is null
      ) into allowed;
    when 'message' then
      select exists (
        select 1 from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
        where m.id = new.target_id and cm.profile_id = new.reporter_id
      ) into allowed;
    when 'deal' then
      select exists (
        select 1 from public.deals d where d.id = new.target_id
          and new.reporter_id in (d.party_a_id, d.party_b_id)
      ) into allowed;
    when 'review' then
      select exists (select 1 from public.reviews r where r.id = new.target_id)
        into allowed;
    when 'profile_comment' then
      select exists (select 1 from public.profile_comments pc where pc.id = new.target_id)
        into allowed;
  end case;

  if not coalesce(allowed, false) then
    raise exception 'report target is missing or not accessible to reporter' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger validate_report_insert
before insert on public.reports
for each row execute function public.validate_report_insert();

create or replace function public.protect_report_case()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason_code is distinct from old.reason_code
     or new.details is distinct from old.details
     or new.evidence_paths is distinct from old.evidence_paths
     or new.created_at is distinct from old.created_at
  then
    raise exception 'report identity and submitted evidence are immutable'
      using errcode = '42501';
  end if;

  if auth.uid() is not null and not public.is_staff() then
    raise exception 'staff access required for report workflow changes'
      using errcode = '42501';
  end if;
  if new.assigned_to is not null and not public.is_staff(new.assigned_to) then
    raise exception 'reports can only be assigned to active staff'
      using errcode = '23514';
  end if;

  if auth.uid() is not null and not public.is_admin() then
    if old.assigned_to is not null and old.assigned_to <> auth.uid() then
      raise exception 'report is assigned to another moderator' using errcode = '42501';
    end if;
    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is distinct from auth.uid()
    then
      raise exception 'moderators may only assign an open report to themselves'
        using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'open' and new.status = 'investigating')
      or (old.status = 'investigating' and new.status in ('open', 'resolved', 'dismissed'))
      or (old.status in ('resolved', 'dismissed') and new.status = 'open' and public.is_admin())
    ) then
      raise exception 'invalid report status transition' using errcode = '23514';
    end if;
  end if;

  if new.status in ('resolved', 'dismissed')
     and new.assigned_to is distinct from old.assigned_to
  then
    raise exception 'assign the report before closing it so both actions are audited'
      using errcode = '23514';
  end if;

  if new.status = 'investigating' and new.assigned_to is null then
    raise exception 'investigating reports require an assigned moderator'
      using errcode = '23514';
  end if;
  if new.status in ('resolved', 'dismissed') then
    if char_length(trim(coalesce(new.resolution_code, ''))) < 2 then
      raise exception 'closed reports require a resolution code' using errcode = '23514';
    end if;
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_at := null;
    new.resolution_code := null;
    new.resolution_notes := null;
    if new.status = 'open' then
      new.assigned_to := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_report_case
before update on public.reports
for each row execute function public.protect_report_case();

create or replace function public.is_conversation_member(
  target_conversation_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.profile_id = target_profile_id
      and cm.blocked_at is null
  ) and (target_profile_id = auth.uid() or public.is_staff());
$$;

create or replace function public.moderator_read_messages(
  report_case_id uuid,
  before_timestamp timestamptz default now(),
  page_size integer default 50
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  target_conversation_id uuid;
begin
  select * into target_report from public.reports where reports.id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or not public.is_staff()
     or (target_report.assigned_to is distinct from auth.uid() and not public.is_admin())
  then
    raise exception 'an assigned active report case is required' using errcode = '42501';
  end if;

  if target_report.target_type = 'conversation' then
    target_conversation_id := target_report.target_id;
  elsif target_report.target_type = 'message' then
    select m.conversation_id into target_conversation_id
    from public.messages m where m.id = target_report.target_id;
  else
    raise exception 'report does not authorize conversation access' using errcode = '42501';
  end if;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale
  ) values (
    auth.uid(), target_report.id, 'conversation_accessed', 'conversation',
    target_conversation_id, 'Conversation messages accessed for assigned report investigation.'
  );

  return query
  select m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id,
         m.created_at, m.edited_at, m.deleted_at
  from public.messages m
  where m.conversation_id = target_conversation_id
    and m.created_at < coalesce(before_timestamp, now())
  order by m.created_at desc, m.id desc
  limit greatest(1, least(coalesce(page_size, 50), 200));
end;
$$;

create or replace function public.canonicalize_brand(
  pending_brand_id uuid,
  canonical_brand_id uuid,
  rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_brand public.brands%rowtype;
  canonical_brand public.brands%rowtype;
begin
  if not public.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if char_length(trim(rationale)) < 2 then
    raise exception 'moderation rationale is required' using errcode = '23514';
  end if;

  select * into pending_brand from public.brands where id = pending_brand_id for update;
  select * into canonical_brand from public.brands where id = canonical_brand_id;
  if pending_brand.status <> 'pending_canonicalization' or canonical_brand.status <> 'canonical' then
    raise exception 'expected pending and canonical brand records' using errcode = '23514';
  end if;

  update public.listings
  set brand_id = canonical_brand.id,
      suggested_brand_id = canonical_brand.id,
      catalog_provenance = catalog_provenance || jsonb_build_object(
        'canonicalizedFrom', pending_brand.id,
        'canonicalizedAt', now(),
        'canonicalizedBy', auth.uid()
      )
  where brand_id = pending_brand.id;

  update public.brands
  set status = 'merged', merged_into_brand_id = canonical_brand.id,
      canonicalized_by = auth.uid(), canonicalized_at = now()
  where id = pending_brand.id;

  insert into public.moderation_audit (
    actor_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), 'brand_merged', 'brand', pending_brand.id, rationale,
    to_jsonb(pending_brand),
    jsonb_build_object('status', 'merged', 'mergedIntoBrandId', canonical_brand.id)
  );
end;
$$;

create or replace function public.review_listing_authenticity(
  target_listing_id uuid,
  review_result public.authenticity_review_status,
  review_public_note text,
  review_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_review public.listing_authenticity_reviews%rowtype;
  updated_review public.listing_authenticity_reviews%rowtype;
begin
  if not public.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  if review_result = 'pending' then
    raise exception 'review result must be final' using errcode = '23514';
  end if;
  if char_length(trim(review_rationale)) < 2 then
    raise exception 'moderation rationale is required' using errcode = '23514';
  end if;

  select * into previous_review
  from public.listing_authenticity_reviews
  where listing_id = target_listing_id for update;
  if not found then
    raise exception 'authenticity review request not found' using errcode = 'P0002';
  end if;

  update public.listing_authenticity_reviews
  set status = review_result,
      public_note = nullif(trim(review_public_note), ''),
      reviewed_at = now()
  where listing_id = target_listing_id
  returning * into updated_review;

  insert into public.moderation_audit (
    actor_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), 'authenticity_reviewed', 'listing', target_listing_id, review_rationale,
    to_jsonb(previous_review), to_jsonb(updated_review)
  );
end;
$$;

create or replace function public.audit_report_state_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action public.moderation_action;
  audit_rationale text;
begin
  if auth.uid() is null or not public.is_staff() then return new; end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    audit_action := 'report_assigned';
    audit_rationale := coalesce(nullif(trim(new.resolution_notes), ''), 'Report assigned for investigation.');
  elsif new.status is distinct from old.status and new.status in ('resolved', 'dismissed') then
    audit_action := 'report_resolved';
    audit_rationale := coalesce(nullif(trim(new.resolution_notes), ''), 'Report closed by moderator.');
  else
    return new;
  end if;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), new.id, audit_action, new.target_type, new.target_id, audit_rationale,
    to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

create trigger audit_report_state_change
after update on public.reports
for each row execute function public.audit_report_state_change();

create or replace function public.moderate_listing(
  report_case_id uuid,
  target_listing_id uuid,
  moderation_rationale text,
  corrected_audience public.audience default null,
  corrected_segments public.segment[] default null,
  moderated_status public.listing_status default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  previous_listing public.listings%rowtype;
  updated_listing public.listings%rowtype;
  audit_action public.moderation_action;
  changes_category boolean := corrected_audience is not null or corrected_segments is not null;
  changes_status boolean := moderated_status is not null;
begin
  if not public.is_staff() then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required' using errcode = '23514';
  end if;
  if changes_category = changes_status then
    raise exception 'change either categories or moderation status in one audited action'
      using errcode = '23514';
  end if;

  select * into target_report from public.reports
  where id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'listing'
     or target_report.target_id <> target_listing_id
     or (target_report.assigned_to is distinct from auth.uid() and not public.is_admin())
  then
    raise exception 'an assigned active listing report is required' using errcode = '42501';
  end if;

  select * into previous_listing from public.listings
  where id = target_listing_id for update;
  if not found then
    raise exception 'listing not found' using errcode = 'P0002';
  end if;

  if changes_category then
    if corrected_segments is not null and not public.array_has_unique_items(corrected_segments) then
      raise exception 'listing segments must be unique' using errcode = '23514';
    end if;
    update public.listings
    set audience = coalesce(corrected_audience, audience),
        segments = coalesce(corrected_segments, segments)
    where id = target_listing_id
    returning * into updated_listing;
    audit_action := 'category_corrected';
  else
    if moderated_status not in ('active', 'paused', 'rejected', 'removed') then
      raise exception 'unsupported moderation status' using errcode = '23514';
    end if;
    update public.listings set status = moderated_status
    where id = target_listing_id
    returning * into updated_listing;
    audit_action := case moderated_status
      when 'active' then 'content_restored'::public.moderation_action
      when 'paused' then 'content_hidden'::public.moderation_action
      else 'content_removed'::public.moderation_action
    end;
  end if;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, 'listing', target_listing_id,
    trim(moderation_rationale), to_jsonb(previous_listing), to_jsonb(updated_listing)
  );
end;
$$;

create or replace function public.moderate_profile(
  report_case_id uuid,
  target_profile_id uuid,
  suspend_profile boolean,
  moderation_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  previous_profile public.profiles%rowtype;
  updated_profile public.profiles%rowtype;
  audit_action public.moderation_action;
begin
  if not public.is_staff() then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required' using errcode = '23514';
  end if;
  if target_profile_id = auth.uid() then
    raise exception 'moderators cannot act on their own profile' using errcode = '42501';
  end if;

  select * into target_report from public.reports
  where id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'profile'
     or target_report.target_id <> target_profile_id
     or (target_report.assigned_to is distinct from auth.uid() and not public.is_admin())
  then
    raise exception 'an assigned active profile report is required' using errcode = '42501';
  end if;

  select * into previous_profile from public.profiles
  where id = target_profile_id for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if previous_profile.role in ('moderator', 'admin') and not public.is_admin() then
    raise exception 'only an administrator may moderate staff accounts'
      using errcode = '42501';
  end if;

  update public.profiles
  set is_suspended = suspend_profile
  where id = target_profile_id
  returning * into updated_profile;

  if suspend_profile then
    update public.listings
    set status = 'paused'
    where seller_id = target_profile_id and status = 'active';

    update public.offers o
    set status = 'expired', responded_at = now()
    where o.status = 'pending'
      and (
        o.offerer_id = target_profile_id
        or o.listing_id in (
          select l.id from public.listings l where l.seller_id = target_profile_id
        )
        or o.offered_listing_id in (
          select l.id from public.listings l where l.seller_id = target_profile_id
        )
      );

    update public.deals
    set status = 'disputed'
    where status = 'pending_confirmation'
      and target_profile_id in (party_a_id, party_b_id);

    update public.conversations c
    set status = 'blocked'
    where exists (
      select 1 from public.deals d
      where d.accepted_offer_id = c.accepted_offer_id
        and target_profile_id in (d.party_a_id, d.party_b_id)
    );

    update public.conversation_members
    set blocked_at = coalesce(blocked_at, now())
    where profile_id = target_profile_id;
  end if;

  audit_action := case
    when suspend_profile then 'user_suspended'::public.moderation_action
    else 'user_restored'::public.moderation_action
  end;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale, before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, 'profile', target_profile_id,
    trim(moderation_rationale), to_jsonb(previous_profile), to_jsonb(updated_profile)
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.merchant_applications enable row level security;
alter table public.brands enable row level security;
alter table public.brand_aliases enable row level security;
alter table public.brand_collection_memberships enable row level security;
alter table public.fragrances enable row level security;
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.listing_authenticity_reviews enable row level security;
alter table public.favorites enable row level security;
alter table public.saved_searches enable row level security;
alter table public.offers enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.deals enable row level security;
alter table public.deal_listing_locks enable row level security;
alter table public.deal_confirmations enable row level security;
alter table public.reviews enable row level security;
alter table public.profile_comments enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_audit enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.entitlements enable row level security;
alter table public.notifications enable row level security;

create policy profiles_public_read on public.profiles
for select using (not is_suspended or id = auth.uid() or public.is_staff());
create policy profiles_own_update on public.profiles
for update to authenticated
using (id = auth.uid() and not is_suspended)
with check (id = auth.uid());
create policy merchant_applicant_read on public.merchant_applications
for select to authenticated using (applicant_id = auth.uid() or public.is_staff());
create policy merchant_applicant_create on public.merchant_applications
for insert to authenticated with check (
  applicant_id = auth.uid()
  and status in ('draft', 'submitted')
  and reviewer_id is null
  and reviewer_notes is null
  and reviewed_at is null
);
create policy merchant_applicant_update on public.merchant_applications
for update to authenticated
using (applicant_id = auth.uid() and status in ('draft', 'submitted'))
with check (applicant_id = auth.uid() and status in ('draft', 'submitted', 'withdrawn'));
create policy merchant_staff_review on public.merchant_applications
for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy brands_public_read on public.brands
for select using (status <> 'rejected');
create policy brands_pending_create on public.brands
for insert to authenticated with check (
  created_by = auth.uid()
  and status = 'pending_canonicalization'
  and provenance ->> 'source' = 'seller'
  and merged_into_brand_id is null
  and canonicalized_by is null
  and canonicalized_at is null
);
create policy brands_admin_manage on public.brands
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy aliases_public_read on public.brand_aliases
for select using (exists (
  select 1 from public.brands b where b.id = brand_id and b.status = 'canonical'
));
create policy aliases_admin_manage on public.brand_aliases
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy collection_memberships_public_read on public.brand_collection_memberships
for select using (true);
create policy collection_memberships_admin_manage on public.brand_collection_memberships
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy fragrances_public_read on public.fragrances
for select using (is_active or created_by = auth.uid() or public.is_staff());
create policy fragrances_admin_manage on public.fragrances
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy listings_public_read on public.listings
for select using (
  (
    status in ('active', 'reserved', 'completed')
    and exists (
      select 1 from public.profiles seller
      where seller.id = listings.seller_id and not seller.is_suspended
    )
  )
  or seller_id = auth.uid()
  or public.is_staff()
  or exists (
    select 1 from public.deals d
    where (d.listing_id = listings.id or d.offered_listing_id = listings.id)
      and auth.uid() in (d.party_a_id, d.party_b_id)
  )
);
create policy listings_owner_create on public.listings
for insert to authenticated with check (
  seller_id = auth.uid()
  and status = 'draft'
  and activated_at is null
  and expires_at is null
  and completed_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and not p.is_suspended
  )
);
create policy listings_owner_update on public.listings
for update to authenticated
using (seller_id = auth.uid() and status not in ('completed', 'removed'))
with check (seller_id = auth.uid());
create policy listings_owner_delete_draft on public.listings
for delete to authenticated using (seller_id = auth.uid() and status = 'draft');
create policy listing_photos_visible_read on public.listing_photos
for select using (exists (
  select 1 from public.listings l
  where l.id = listing_id
    and (
      (l.status in ('active', 'reserved', 'completed') and listing_photos.sanitized_at is not null)
      or l.seller_id = auth.uid()
      or public.is_staff()
    )
));
create policy listing_photos_owner_delete on public.listing_photos
for delete to authenticated using (exists (
  select 1 from public.listings l
  where l.id = listing_id and l.seller_id = auth.uid() and l.status in ('draft', 'paused')
));

create policy authenticity_reviews_visible_read on public.listing_authenticity_reviews
for select using (
  requested_by = auth.uid()
  or public.is_staff()
  or exists (
    select 1 from public.listings l
    where l.id = listing_id and l.status in ('active', 'reserved', 'completed')
  )
);
create policy authenticity_reviews_owner_request on public.listing_authenticity_reviews
for insert to authenticated with check (
  requested_by = auth.uid()
  and status = 'pending'
  and public_note is null
  and reviewed_at is null
  and exists (
    select 1 from public.listings l
    where l.id = listing_id and l.seller_id = auth.uid() and l.kind = 'offer'
  )
);

create policy favorites_owner_all on public.favorites
for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy saved_searches_owner_all on public.saved_searches
for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy offers_participant_read on public.offers
for select to authenticated using (
  offerer_id = auth.uid()
  or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  or public.is_staff()
);
create policy offers_offerer_create on public.offers
for insert to authenticated with check (offerer_id = auth.uid() and status = 'pending');
create policy offers_offerer_withdraw on public.offers
for update to authenticated
using (offerer_id = auth.uid() and status = 'pending')
with check (offerer_id = auth.uid() and status = 'withdrawn');

create policy conversations_members_read on public.conversations
for select to authenticated using (public.is_conversation_member(id));
create policy conversation_members_self_read on public.conversation_members
for select to authenticated using (
  public.is_conversation_member(conversation_id) and profile_id = auth.uid()
);
create policy conversation_members_self_update on public.conversation_members
for update to authenticated
using (profile_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (profile_id = auth.uid());
create policy messages_members_read on public.messages
for select to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_members_create on public.messages
for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.status = 'open'
  )
);
create policy messages_sender_edit on public.messages
for update to authenticated
using (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.status = 'open'
  )
)
with check (sender_id = auth.uid());

create policy deals_participant_read on public.deals
for select to authenticated using (
  party_a_id = auth.uid() or party_b_id = auth.uid() or public.is_staff()
);
create policy deal_confirmations_participant_read on public.deal_confirmations
for select to authenticated using (exists (
  select 1 from public.deals d
  where d.id = deal_id and (d.party_a_id = auth.uid() or d.party_b_id = auth.uid() or public.is_staff())
));
create policy deal_confirmations_self_create on public.deal_confirmations
for insert to authenticated with check (profile_id = auth.uid());

create policy reviews_public_read on public.reviews
for select using (status = 'published' or reviewer_id = auth.uid() or reviewee_id = auth.uid() or public.is_staff());
create policy reviews_reviewer_create on public.reviews
for insert to authenticated with check (
  reviewer_id = auth.uid() and status = 'published'
);
create policy reviews_reviewer_edit on public.reviews
for update to authenticated
using (reviewer_id = auth.uid() and status = 'published')
with check (reviewer_id = auth.uid() and status = 'published');
create policy reviews_staff_moderate on public.reviews
for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy profile_comments_public_read on public.profile_comments
for select using (status = 'published' or author_id = auth.uid() or public.is_staff());
create policy profile_comments_author_create on public.profile_comments
for insert to authenticated with check (author_id = auth.uid() and status = 'published');
create policy profile_comments_author_edit on public.profile_comments
for update to authenticated
using (author_id = auth.uid() and status = 'published')
with check (author_id = auth.uid() and status = 'published');
create policy profile_comments_staff_moderate on public.profile_comments
for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy reports_reporter_read on public.reports
for select to authenticated using (
  reporter_id = auth.uid()
  or (public.is_staff() and (assigned_to = auth.uid() or public.is_admin()))
);
create policy reports_reporter_create on public.reports
for insert to authenticated with check (
  reporter_id = auth.uid()
  and status = 'open'
  and assigned_to is null
  and resolution_code is null
  and resolution_notes is null
  and resolved_at is null
);
create policy reports_staff_queue_read on public.reports
for select to authenticated using (public.is_staff());
create policy reports_staff_update on public.reports
for update to authenticated
using (
  public.is_admin()
  or assigned_to = auth.uid()
  or (status = 'open' and assigned_to is null)
)
with check (public.is_admin() or assigned_to = auth.uid());
create policy moderation_audit_staff_read on public.moderation_audit
for select to authenticated using (public.is_staff());

create policy payments_owner_read on public.payments
for select to authenticated using (profile_id = auth.uid() or public.is_staff());
create policy payment_events_staff_read on public.payment_events
for select to authenticated using (public.is_staff());
create policy payment_refunds_owner_read on public.payment_refunds
for select to authenticated using (exists (
  select 1 from public.payments p
  where p.id = payment_id and (p.profile_id = auth.uid() or public.is_staff())
));
create policy entitlements_owner_read on public.entitlements
for select to authenticated using (profile_id = auth.uid() or public.is_staff());
create policy notifications_owner_read on public.notifications
for select to authenticated using (profile_id = auth.uid());
create policy notifications_owner_update on public.notifications
for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy notifications_owner_delete on public.notifications
for delete to authenticated using (profile_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'listing-images', 'listing-images', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  ),
  (
    'merchant-documents', 'merchant-documents', false, 15728640,
    array['image/jpeg', 'image/png', 'application/pdf']
  ),
  (
    'report-evidence', 'report-evidence', false, 15728640,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy marketplace_listing_images_read on storage.objects
for select using (
  bucket_id = 'listing-images'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
  and exists (
    select 1 from public.listings l
    where l.id = public.safe_uuid(split_part(name, '/', 2))
      and (
        l.seller_id = auth.uid()
        or public.is_staff()
        or (
          l.status in ('active', 'reserved', 'completed')
          and exists (
            select 1 from public.listing_photos lp
            where lp.listing_id = l.id
              and lp.storage_path = name
              and lp.sanitized_at is not null
          )
        )
      )
  )
);
create policy marketplace_listing_images_create on storage.objects
for insert to authenticated with check (
  bucket_id = 'listing-images'
  and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
  and exists (
    select 1 from public.listings l
    where l.id = public.safe_uuid(split_part(name, '/', 2))
      and l.seller_id = auth.uid()
      and l.status in ('draft', 'paused')
  )
);
create policy marketplace_listing_images_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'listing-images'
  and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
  and exists (
    select 1 from public.listings l
    where l.id = public.safe_uuid(split_part(name, '/', 2))
      and l.seller_id = auth.uid()
      and l.status in ('draft', 'paused')
  )
  and not exists (
    select 1 from public.listing_photos lp
    where lp.storage_path = name and lp.sanitized_at is not null
  )
);

create policy marketplace_merchant_documents_create on storage.objects
for insert to authenticated with check (
  bucket_id = 'merchant-documents' and split_part(name, '/', 1) = auth.uid()::text
);
create policy marketplace_merchant_documents_read on storage.objects
for select to authenticated using (
  bucket_id = 'merchant-documents'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_staff())
);
create policy marketplace_merchant_documents_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'merchant-documents' and split_part(name, '/', 1) = auth.uid()::text
);

create policy marketplace_report_evidence_create on storage.objects
for insert to authenticated with check (
  bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text
);
create policy marketplace_report_evidence_read on storage.objects
for select to authenticated using (
  bucket_id = 'report-evidence'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_staff())
);

alter table public.conversations replica identity full;
alter table public.conversation_members replica identity full;
alter table public.messages replica identity full;
alter table public.deals replica identity full;
alter table public.notifications replica identity full;

do $$
declare
  realtime_table text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach realtime_table in array array[
      'conversations', 'conversation_members', 'messages', 'deals', 'notifications'
    ]
    loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = realtime_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          realtime_table
        );
      end if;
    end loop;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select on
  public.profiles,
  public.brands,
  public.brand_aliases,
  public.brand_collection_memberships,
  public.fragrances,
  public.listings,
  public.listing_photos,
  public.listing_authenticity_reviews,
  public.reviews,
  public.profile_comments
to anon, authenticated;

grant select on
  public.payment_events,
  public.payment_refunds
to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.merchant_applications,
  public.brands,
  public.brand_aliases,
  public.brand_collection_memberships,
  public.fragrances,
  public.listings,
  public.listing_photos,
  public.listing_authenticity_reviews,
  public.favorites,
  public.saved_searches,
  public.offers,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.deals,
  public.deal_confirmations,
  public.reviews,
  public.profile_comments,
  public.reports,
  public.moderation_audit,
  public.payments,
  public.entitlements,
  public.notifications
to authenticated;

grant usage, select on all sequences in schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
revoke update, delete, truncate on public.payment_events from service_role;
revoke delete, truncate on public.payment_refunds from service_role;
revoke insert, update, delete, truncate on public.deal_listing_locks from service_role;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.normalize_brand_fields() from public, anon, authenticated;
revoke execute on function public.normalize_brand_alias_fields() from public, anon, authenticated;
revoke execute on function public.normalize_fragrance_fields() from public, anon, authenticated;
revoke execute on function public.normalize_listing_brand_input() from public, anon, authenticated;
revoke execute on function public.protect_profile_privileged_fields() from public, anon, authenticated;
revoke execute on function public.protect_merchant_review_fields() from public, anon, authenticated;
revoke execute on function public.apply_merchant_review() from public, anon, authenticated;
revoke execute on function public.require_brand_merge_workflow() from public, anon, authenticated;
revoke execute on function public.protect_listing_photo_processing() from public, anon, authenticated;
revoke execute on function public.protect_conversation_membership_identity() from public, anon, authenticated;
revoke execute on function public.sync_deal_listing_locks() from public, anon, authenticated;
revoke execute on function public.protect_deal_state() from public, anon, authenticated;
revoke execute on function public.protect_listing_state() from public, anon, authenticated;
revoke execute on function public.validate_listing_activation() from public, anon, authenticated;
revoke execute on function public.validate_offer_write() from public, anon, authenticated;
revoke execute on function public.validate_message_write() from public, anon, authenticated;
revoke execute on function public.protect_message_identity() from public, anon, authenticated;
revoke execute on function public.validate_deal_confirmation() from public, anon, authenticated;
revoke execute on function public.complete_mutually_confirmed_deal() from public, anon, authenticated;
revoke execute on function public.validate_review_write() from public, anon, authenticated;
revoke execute on function public.protect_review_moderation() from public, anon, authenticated;
revoke execute on function public.protect_profile_comment_update() from public, anon, authenticated;
revoke execute on function public.refresh_profile_rating() from public, anon, authenticated;
revoke execute on function public.protect_payment_event_append_only() from public, anon, authenticated;
revoke execute on function public.validate_payment_refund() from public, anon, authenticated;
revoke execute on function public.apply_payment_refund() from public, anon, authenticated;
revoke execute on function public.replace_current_merchant_plan() from public, anon, authenticated;
revoke execute on function public.protect_notification_content() from public, anon, authenticated;
revoke execute on function public.validate_report_insert() from public, anon, authenticated;
revoke execute on function public.protect_report_case() from public, anon, authenticated;
revoke execute on function public.audit_report_state_change() from public, anon, authenticated;
revoke execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) from public, anon, authenticated;
revoke execute on function public.moderate_profile(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.effective_listing_limit(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.cancel_deal(uuid, text) from public, anon;
revoke execute on function public.decline_offer(uuid) from public, anon;
revoke execute on function public.moderator_read_messages(uuid, timestamptz, integer) from public, anon;
revoke execute on function public.canonicalize_brand(uuid, uuid, text) from public, anon;
revoke execute on function public.review_listing_authenticity(uuid, public.authenticity_review_status, text, text) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.cancel_deal(uuid, text) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;
grant execute on function public.moderator_read_messages(uuid, timestamptz, integer) to authenticated;
grant execute on function public.canonicalize_brand(uuid, uuid, text) to authenticated;
grant execute on function public.review_listing_authenticity(uuid, public.authenticity_review_status, text, text) to authenticated;
grant execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) to authenticated;
grant execute on function public.moderate_profile(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.effective_listing_limit(uuid) to authenticated, service_role;

commit;
