begin;

create or replace function public.slugify_marketplace(value text)
returns text
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  result text := lower(btrim(value));
begin
  result := replace(result, 'щ', 'sht');
  result := replace(result, 'ш', 'sh');
  result := replace(result, 'ч', 'ch');
  result := replace(result, 'ц', 'ts');
  result := replace(result, 'ж', 'zh');
  result := replace(result, 'ю', 'yu');
  result := replace(result, 'я', 'ya');
  result := replace(result, 'й', 'y');
  result := replace(result, 'а', 'a');
  result := replace(result, 'б', 'b');
  result := replace(result, 'в', 'v');
  result := replace(result, 'г', 'g');
  result := replace(result, 'д', 'd');
  result := replace(result, 'е', 'e');
  result := replace(result, 'з', 'z');
  result := replace(result, 'и', 'i');
  result := replace(result, 'к', 'k');
  result := replace(result, 'л', 'l');
  result := replace(result, 'м', 'm');
  result := replace(result, 'н', 'n');
  result := replace(result, 'о', 'o');
  result := replace(result, 'п', 'p');
  result := replace(result, 'р', 'r');
  result := replace(result, 'с', 's');
  result := replace(result, 'т', 't');
  result := replace(result, 'у', 'u');
  result := replace(result, 'ф', 'f');
  result := replace(result, 'х', 'h');
  result := replace(result, 'ъ', 'a');
  result := replace(result, 'ь', 'y');
  result := lower(extensions.unaccent(result));
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  result := btrim(result, '-');
  return coalesce(nullif(result, ''), 'item');
end;
$$;

alter table public.fragrances add column slug text;
alter table public.listings add column slug text;

update public.fragrances f
set slug = public.slugify_marketplace(
  coalesce((select b.slug from public.brands b where b.id = f.brand_id), '')
  || ' ' || f.name::text
  || ' ' || coalesce(f.concentration::text, f.concentration_label, '')
) || '-' || left(replace(f.id::text, '-', ''), 10)
where slug is null;

update public.listings l
set slug = public.slugify_marketplace(l.title)
  || '-' || left(replace(l.id::text, '-', ''), 10)
where slug is null;

alter table public.fragrances alter column slug set not null;
alter table public.listings alter column slug set not null;

alter table public.fragrances
  add constraint fragrance_slug_shape check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 220
  );
alter table public.listings
  add constraint listing_slug_shape check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 220
  );

create unique index fragrances_slug_idx on public.fragrances (slug);
create unique index listings_slug_idx on public.listings (slug);
create index listings_title_trgm_idx on public.listings
  using gin (title extensions.gin_trgm_ops);

create or replace function public.assign_fragrance_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  brand_slug text;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'fragrance slug is server-managed and immutable'
        using errcode = '42501';
    end if;
    return new;
  end if;
  select b.slug into brand_slug from public.brands b where b.id = new.brand_id;
  new.slug := public.slugify_marketplace(
    coalesce(brand_slug, '') || ' ' || new.name::text || ' '
    || coalesce(new.concentration::text, new.concentration_label, '')
  ) || '-' || left(replace(new.id::text, '-', ''), 10);
  return new;
end;
$$;

create trigger assign_fragrance_slug
before insert or update of slug on public.fragrances
for each row execute function public.assign_fragrance_slug();

create or replace function public.assign_listing_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'listing slug is server-managed and immutable'
        using errcode = '42501';
    end if;
    return new;
  end if;
  new.slug := public.slugify_marketplace(new.title)
    || '-' || left(replace(new.id::text, '-', ''), 10);
  return new;
end;
$$;

create trigger assign_listing_slug
before insert or update of slug on public.listings
for each row execute function public.assign_listing_slug();

create or replace function public.search_catalog(
  search_query text,
  page_size integer default 20
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
        partition by c.entity_type, c.id order by c.relevance desc, c.secondary_label nulls last
      ) as duplicate_rank
    from candidates c
  )
  select
    r.entity_type, r.id, r.brand_id, r.label, r.slug,
    r.secondary_label, r.relevance
  from ranked r
  where r.duplicate_rank = 1
  order by r.relevance desc, r.label, r.id
  limit greatest(1, least(coalesce(page_size, 20), 50));
$$;

create or replace function public.search_listings(
  search_query text default null,
  filter_audience public.audience default null,
  filter_segments public.segment[] default null,
  filter_deal_mode public.deal_mode default null,
  filter_city text default null,
  min_price_minor integer default null,
  max_price_minor integer default null,
  page_size integer default 24,
  cursor_activated_at timestamptz default null,
  cursor_id uuid default null
)
returns table (
  listing_id uuid,
  slug text,
  activated_at timestamptz,
  relevance real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.normalize_catalog_key(coalesce(search_query, '')) as q
  ), matches as (
    select
      l.id as listing_id,
      l.slug,
      l.activated_at,
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
      ) end)::real as relevance
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
      and (
        cursor_activated_at is null
        or l.activated_at < cursor_activated_at
        or (
          l.activated_at = cursor_activated_at
          and (cursor_id is null or l.id < cursor_id)
        )
      )
  )
  select m.listing_id, m.slug, m.activated_at, m.relevance
  from matches m
  order by m.activated_at desc, m.listing_id desc
  limit greatest(1, least(coalesce(page_size, 24), 60));
$$;

-- Notification events are durable and de-duplicated at their domain event
-- boundary. Users can mark them read/archive them, but cannot rewrite event
-- identity or delete the email-delivery audit record behind them.
alter table public.notifications add column dedupe_key text;
alter table public.notifications
  add constraint notification_dedupe_key_shape check (
    dedupe_key is null or char_length(dedupe_key) between 8 and 240
  );
create unique index notifications_dedupe_key_idx
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

drop policy if exists notifications_owner_delete on public.notifications;
revoke delete on public.notifications from authenticated;

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
    or new.dedupe_key is distinct from old.dedupe_key
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'only notification read state can be changed'
      using errcode = '42501';
  end if;
  if new.status = 'read' and old.status <> 'read' and new.read_at is null then
    new.read_at := statement_timestamp();
  end if;
  return new;
end;
$$;

create type public.notification_email_delivery_status as enum (
  'pending', 'processing', 'sent', 'failed'
);

create table public.notification_email_deliveries (
  notification_id uuid primary key
    references public.notifications(id) on delete restrict,
  status public.notification_email_delivery_status not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 100),
  worker_request_id text,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  constraint notification_email_worker_request_shape check (
    worker_request_id is null
    or char_length(btrim(worker_request_id)) between 8 and 200
  ),
  constraint notification_email_provider_id_shape check (
    provider_message_id is null
    or char_length(btrim(provider_message_id)) between 2 and 200
  ),
  constraint notification_email_error_code_shape check (
    last_error_code is null
    or (
      char_length(last_error_code) between 2 and 80
      and last_error_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  constraint notification_email_delivery_state_shape check (
    (
      status = 'pending'
      and attempts = 0
      and worker_request_id is null
      and claimed_at is null
      and last_attempt_at is null
      and provider_message_id is null
      and last_error_code is null
      and sent_at is null
      and failed_at is null
    )
    or (
      status = 'processing'
      and attempts > 0
      and worker_request_id is not null
      and claimed_at is not null
      and last_attempt_at is not null
      and provider_message_id is null
      and last_error_code is null
      and sent_at is null
      and failed_at is null
    )
    or (
      status = 'sent'
      and attempts > 0
      and worker_request_id is not null
      and claimed_at is not null
      and last_attempt_at is not null
      and provider_message_id is not null
      and last_error_code is null
      and sent_at is not null
      and failed_at is null
    )
    or (
      status = 'failed'
      and attempts > 0
      and worker_request_id is not null
      and claimed_at is not null
      and last_attempt_at is not null
      and provider_message_id is null
      and last_error_code is not null
      and sent_at is null
      and failed_at is not null
    )
  )
);

create unique index notification_email_provider_message_idx
  on public.notification_email_deliveries (provider_message_id)
  where provider_message_id is not null;
create index notification_email_delivery_queue_idx
  on public.notification_email_deliveries (status, updated_at, notification_id)
  where status in ('pending', 'failed', 'processing');

-- The foundation accept_offer implementation predates the query-string
-- conversation route. Keep that internal RPC intact, while normalizing both
-- historical and future accepted-offer notification links at the boundary.
update public.notifications
set action_url = '/messages?conversation=' || substr(action_url, 11)
where kind = 'offer_accepted'
  and action_url ~ '^/messages/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$';

create or replace function public.normalize_notification_action_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'offer_accepted'
     and new.action_url ~ '^/messages/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
  then
    new.action_url := '/messages?conversation=' || substr(new.action_url, 11);
  end if;
  return new;
end;
$$;

revoke execute on function public.normalize_notification_action_url()
  from public, anon, authenticated, service_role;

create trigger normalize_notification_action_url
before insert or update of action_url on public.notifications
for each row execute function public.normalize_notification_action_url();

create or replace function public.queue_notification_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_email_deliveries (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;

create trigger queue_notification_email_delivery
after insert on public.notifications
for each row execute function public.queue_notification_email_delivery();

create or replace function public.notify_offer_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_listing public.listings%rowtype;
begin
  select * into target_listing from public.listings l where l.id = new.listing_id;
  if not found or target_listing.seller_id = new.offerer_id then return new; end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    target_listing.seller_id, 'offer_received', 'Нова оферта',
    'Получихте нова оферта за обявата си.',
    '/listing/' || target_listing.slug,
    jsonb_build_object('offerId', new.id, 'listingId', new.listing_id),
    'offer_received:' || new.id::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_offer_received
after insert on public.offers
for each row execute function public.notify_offer_received();

create or replace function public.notify_message_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  )
  select
    cm.profile_id, 'message_received'::public.notification_kind,
    'Ново съобщение', 'Получихте ново лично съобщение.',
    '/messages?conversation=' || new.conversation_id::text,
    jsonb_build_object(
      'messageId', new.id, 'conversationId', new.conversation_id
    ),
    'message_received:' || new.id::text || ':' || cm.profile_id::text
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.profile_id <> new.sender_id
    and cm.blocked_at is null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_message_received
after insert on public.messages
for each row execute function public.notify_message_received();

create or replace function public.notify_deal_confirmation_needed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
  recipient_id uuid;
begin
  select * into target_deal from public.deals d where d.id = new.deal_id;
  if not found then return new; end if;
  recipient_id := case
    when new.profile_id = target_deal.party_a_id then target_deal.party_b_id
    when new.profile_id = target_deal.party_b_id then target_deal.party_a_id
    else null
  end;
  if recipient_id is null or exists (
    select 1 from public.deal_confirmations dc
    where dc.deal_id = new.deal_id and dc.profile_id = recipient_id
  ) then
    return new;
  end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    recipient_id, 'deal_confirmation_needed', 'Потвърждение на сделка',
    'Другата страна потвърди сделката. Потвърдете и вие.',
    '/deals?highlight=' || new.deal_id::text,
    jsonb_build_object('dealId', new.deal_id, 'confirmedBy', new.profile_id),
    'deal_confirmation_needed:' || new.deal_id::text || ':'
      || new.profile_id::text || ':' || new.confirmed_at::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_deal_confirmation_needed
after insert on public.deal_confirmations
for each row execute function public.notify_deal_confirmation_needed();

create or replace function public.notify_review_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'published' or new.reviewee_id = new.reviewer_id then return new; end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    new.reviewee_id, 'review_received', 'Нов отзив',
    'Получихте нов отзив след завършена сделка.',
    '/deals?highlight=' || new.deal_id::text,
    jsonb_build_object('reviewId', new.id, 'dealId', new.deal_id),
    'review_received:' || new.id::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_review_received
after insert on public.reviews
for each row execute function public.notify_review_received();

create or replace function public.notify_report_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  )
  select
    p.id, 'report_updated'::public.notification_kind,
    'Нов сигнал', 'В модераторската опашка има нов сигнал.',
    '/admin?case=' || new.id::text,
    jsonb_build_object(
      'reportId', new.id, 'targetType', new.target_type,
      'targetId', new.target_id
    ),
    'report_created:' || new.id::text || ':' || p.id::text
  from public.profiles p
  where p.role in ('moderator', 'admin')
    and p.id <> new.reporter_id
    and private.is_active_beta_user(p.id)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_report_created
after insert on public.reports
for each row execute function public.notify_report_created();

create or replace function public.notify_report_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     or new.status not in ('investigating', 'resolved', 'dismissed')
     or new.reporter_id is not distinct from auth.uid()
  then
    return new;
  end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    new.reporter_id, 'report_updated', 'Промяна по сигнал',
    'Статусът на вашия сигнал беше променен.',
    '/notifications',
    jsonb_build_object('reportId', new.id, 'status', new.status),
    'report_updated:' || new.id::text || ':' || new.status::text || ':'
      || new.updated_at::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_report_updated
after update of status on public.reports
for each row execute function public.notify_report_updated();

create or replace function public.notify_merchant_application_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'submitted'
     or (tg_op = 'UPDATE' and new.status is not distinct from old.status)
  then
    return new;
  end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  )
  select
    p.id, 'merchant_application_updated'::public.notification_kind,
    'Нова заявка за търговец', 'Получена е заявка за проверка.',
    '/admin',
    jsonb_build_object('applicationId', new.id, 'status', new.status),
    'merchant_submitted:' || new.id::text || ':' || p.id::text
  from public.profiles p
  where p.role in ('moderator', 'admin')
    and p.id <> new.applicant_id
    and private.is_active_beta_user(p.id)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_merchant_application_staff
after insert or update of status on public.merchant_applications
for each row execute function public.notify_merchant_application_staff();

create or replace function public.notify_merchant_application_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     or new.status not in ('under_review', 'approved', 'rejected')
     or new.applicant_id is not distinct from auth.uid()
  then
    return new;
  end if;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    new.applicant_id, 'merchant_application_updated',
    'Промяна по заявката за търговец',
    'Статусът на вашата заявка за търговец беше променен.',
    '/merchant-application',
    jsonb_build_object('applicationId', new.id, 'status', new.status),
    'merchant_updated:' || new.id::text || ':' || new.status::text || ':'
      || new.updated_at::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

create trigger notify_merchant_application_owner
after update of status on public.merchant_applications
for each row execute function public.notify_merchant_application_owner();

create or replace function public.claim_notification_email_delivery(
  target_notification_id uuid,
  worker_request_id text
)
returns public.notification_email_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_email_deliveries%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce($2, ''))) not between 8 and 200 then
    raise exception 'worker request id is invalid' using errcode = '22023';
  end if;
  select * into delivery
  from public.notification_email_deliveries d
  where d.notification_id = target_notification_id
  for update;
  if not found then
    raise exception 'notification email delivery was not found'
      using errcode = 'P0002';
  end if;
  if delivery.status = 'sent'
     or (
       delivery.status = 'processing'
       and delivery.worker_request_id = btrim($2)
     )
  then
    return delivery;
  end if;
  if delivery.status = 'processing'
     and delivery.claimed_at > statement_timestamp() - interval '15 minutes'
  then
    raise exception 'notification email delivery is already claimed'
      using errcode = '55P03';
  end if;
  update public.notification_email_deliveries
  set status = 'processing',
      attempts = attempts + 1,
      worker_request_id = btrim($2),
      last_error_code = null,
      claimed_at = statement_timestamp(),
      last_attempt_at = statement_timestamp(),
      sent_at = null,
      failed_at = null,
      updated_at = statement_timestamp()
  where notification_id = target_notification_id
  returning * into delivery;
  return delivery;
end;
$$;

create or replace function public.mark_notification_email_sent(
  target_notification_id uuid,
  worker_request_id text,
  provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_email_deliveries%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce($3, ''))) not between 2 and 200 then
    raise exception 'provider message id is invalid' using errcode = '22023';
  end if;
  select * into delivery
  from public.notification_email_deliveries d
  where d.notification_id = target_notification_id
  for update;
  if not found then
    raise exception 'notification email delivery was not found'
      using errcode = 'P0002';
  end if;
  if delivery.status = 'sent' then
    if delivery.provider_message_id = btrim($3) then return; end if;
    raise exception 'notification was sent with a different provider id'
      using errcode = '23514';
  end if;
  if delivery.status <> 'processing'
     or delivery.worker_request_id <> btrim($2)
  then
    raise exception 'matching email delivery claim required'
      using errcode = '42501';
  end if;
  update public.notification_email_deliveries
  set status = 'sent',
      provider_message_id = btrim($3),
      last_error_code = null,
      sent_at = statement_timestamp(),
      failed_at = null,
      updated_at = statement_timestamp()
  where notification_id = target_notification_id;
end;
$$;

create or replace function public.mark_notification_email_failed(
  target_notification_id uuid,
  worker_request_id text,
  error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_email_deliveries%rowtype;
  normalized_error text := btrim(coalesce(error_code, ''));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(normalized_error) not between 2 and 80
     or normalized_error !~ '^[A-Za-z0-9_.:-]+$'
  then
    raise exception 'email error code is invalid' using errcode = '22023';
  end if;
  select * into delivery
  from public.notification_email_deliveries d
  where d.notification_id = target_notification_id
  for update;
  if not found then
    raise exception 'notification email delivery was not found'
      using errcode = 'P0002';
  end if;
  if delivery.status = 'failed'
     and delivery.worker_request_id = btrim($2)
     and delivery.last_error_code = normalized_error
  then
    return;
  end if;
  if delivery.status <> 'processing'
     or delivery.worker_request_id <> btrim($2)
  then
    raise exception 'matching email delivery claim required'
      using errcode = '42501';
  end if;
  update public.notification_email_deliveries
  set status = 'failed',
      provider_message_id = null,
      last_error_code = normalized_error,
      sent_at = null,
      failed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where notification_id = target_notification_id;
end;
$$;

-- Storage objects live outside PostgreSQL, so cleanup workers need an explicit
-- lease instead of racing over the service-readable queue.  A consumed request
-- token is retained separately so retrying the same claim is idempotent and can
-- never acquire unrelated work after its original lease was reclaimed.
alter table public.upload_cleanup_queue
  add column worker_request_id text,
  add column claimed_at timestamptz,
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column dead_lettered_at timestamptz,
  add constraint upload_cleanup_worker_request_shape check (
    worker_request_id is null
    or (
      char_length(worker_request_id) between 8 and 200
      and worker_request_id = btrim(worker_request_id)
    )
  ),
  add constraint upload_cleanup_attempts_shape check (attempts between 0 and 8),
  add constraint upload_cleanup_lease_shape check (
    claimed_at is null
    or (
      worker_request_id is not null
      and processed_at is null
      and dead_lettered_at is null
    )
  ),
  add constraint upload_cleanup_terminal_shape check (
    processed_at is null or dead_lettered_at is null
  );

create index upload_cleanup_queue_claim_idx
  on public.upload_cleanup_queue (next_attempt_at, created_at, id)
  where processed_at is null and dead_lettered_at is null;

create table private.upload_cleanup_claim_requests (
  worker_request_id text primary key check (
    char_length(worker_request_id) between 8 and 200
    and worker_request_id = btrim(worker_request_id)
  ),
  first_claimed_at timestamptz not null default now()
);

create or replace function public.claim_upload_cleanup(
  target_limit integer,
  worker_request_id text
)
returns table (
  queue_id bigint,
  bucket_id text,
  storage_path text,
  reason text,
  attempts integer,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := greatest(1, least(coalesce($1, 25), 100));
  normalized_request_id text := btrim(coalesce($2, ''));
  is_new_request boolean := false;
  lease_time timestamptz := statement_timestamp();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if $1 is null or $1 not between 1 and 100
     or char_length(normalized_request_id) not between 8 and 200
  then
    raise exception 'cleanup claim arguments are invalid' using errcode = '22023';
  end if;

  insert into private.upload_cleanup_claim_requests (worker_request_id)
  values (normalized_request_id)
  on conflict on constraint upload_cleanup_claim_requests_pkey do nothing
  returning true into is_new_request;

  if not coalesce(is_new_request, false) then
    return query
    with refreshed as (
      update public.upload_cleanup_queue as q
      set claimed_at = lease_time
      where q.worker_request_id = normalized_request_id
        and q.claimed_at is not null
        and q.processed_at is null
        and q.dead_lettered_at is null
      returning
        q.id, q.bucket_id, q.storage_path, q.reason, q.attempts, q.claimed_at
    )
    select r.id, r.bucket_id, r.storage_path, r.reason, r.attempts, r.claimed_at
    from refreshed as r
    order by r.id;
    return;
  end if;

  -- An abandoned final attempt becomes terminal on the next polling pass.
  update public.upload_cleanup_queue as q
  set claimed_at = null,
      dead_lettered_at = lease_time,
      processing_error = coalesce(q.processing_error, 'LEASE_EXHAUSTED')
  where q.processed_at is null
    and q.dead_lettered_at is null
    and q.attempts >= 8
    and q.claimed_at <= lease_time - interval '5 minutes';

  return query
  with candidates as (
    select q.id
    from public.upload_cleanup_queue as q
    where q.processed_at is null
      and q.dead_lettered_at is null
      and q.attempts < 8
      and q.next_attempt_at <= lease_time
      and (
        q.claimed_at is null
        or q.claimed_at <= lease_time - interval '5 minutes'
      )
    order by q.next_attempt_at, q.created_at, q.id
    for update skip locked
    limit bounded_limit
  ), claimed as (
    update public.upload_cleanup_queue as q
    set worker_request_id = normalized_request_id,
        claimed_at = lease_time,
        attempts = q.attempts + 1
    from candidates as c
    where q.id = c.id
    returning
      q.id, q.bucket_id, q.storage_path, q.reason, q.attempts, q.claimed_at
  )
  select c.id, c.bucket_id, c.storage_path, c.reason, c.attempts, c.claimed_at
  from claimed as c
  order by c.id;
end;
$$;

create or replace function public.complete_upload_cleanup(
  target_queue_id bigint,
  worker_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_record public.upload_cleanup_queue%rowtype;
  normalized_request_id text := btrim(coalesce($2, ''));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into cleanup_record
  from public.upload_cleanup_queue as q
  where q.id = $1
  for update;
  if not found then
    raise exception 'cleanup job was not found' using errcode = 'P0002';
  end if;
  if cleanup_record.processed_at is not null then
    if cleanup_record.worker_request_id = normalized_request_id then return; end if;
    raise exception 'cleanup job was completed by another claim'
      using errcode = '42501';
  end if;
  if cleanup_record.dead_lettered_at is not null
     or cleanup_record.claimed_at is null
     or cleanup_record.worker_request_id <> normalized_request_id
  then
    raise exception 'matching cleanup lease required' using errcode = '42501';
  end if;
  update public.upload_cleanup_queue
  set processed_at = statement_timestamp(),
      processing_error = null,
      claimed_at = null
  where id = $1;
end;
$$;

create or replace function public.fail_upload_cleanup(
  target_queue_id bigint,
  worker_request_id text,
  error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_record public.upload_cleanup_queue%rowtype;
  normalized_request_id text := btrim(coalesce($2, ''));
  normalized_error text := upper(btrim(coalesce($3, '')));
  failed_at timestamptz := statement_timestamp();
  retry_delay interval;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(normalized_error) not between 2 and 120
     or normalized_error !~ '^[A-Z0-9_.:-]+$'
  then
    raise exception 'cleanup error code is invalid' using errcode = '22023';
  end if;
  select * into cleanup_record
  from public.upload_cleanup_queue as q
  where q.id = $1
  for update;
  if not found then
    raise exception 'cleanup job was not found' using errcode = 'P0002';
  end if;
  if cleanup_record.processed_at is not null then
    raise exception 'completed cleanup jobs cannot fail' using errcode = '23514';
  end if;
  if cleanup_record.worker_request_id <> normalized_request_id then
    raise exception 'matching cleanup lease required' using errcode = '42501';
  end if;
  if cleanup_record.claimed_at is null then
    -- The same failure callback may be safely retried after releasing the lease.
    return;
  end if;
  if cleanup_record.dead_lettered_at is not null then
    raise exception 'dead-lettered cleanup jobs cannot fail again'
      using errcode = '23514';
  end if;

  retry_delay := case
    when cleanup_record.attempts <= 1 then interval '30 seconds'
    when cleanup_record.attempts = 2 then interval '1 minute'
    when cleanup_record.attempts = 3 then interval '2 minutes'
    when cleanup_record.attempts = 4 then interval '5 minutes'
    when cleanup_record.attempts = 5 then interval '10 minutes'
    when cleanup_record.attempts = 6 then interval '20 minutes'
    when cleanup_record.attempts = 7 then interval '40 minutes'
    else interval '1 hour'
  end;

  update public.upload_cleanup_queue
  set processing_error = normalized_error,
      claimed_at = null,
      next_attempt_at = failed_at + retry_delay,
      dead_lettered_at = case
        when cleanup_record.attempts >= 8 then failed_at
        else null
      end
  where id = $1;
end;
$$;

create or replace function private.run_beta_maintenance(max_rows integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_rows integer := greatest(1, least(coalesce(max_rows, 500), 5000));
  invite_count integer := 0;
  membership_count integer := 0;
  upload_count integer := 0;
  listing_count integer := 0;
  offer_count integer := 0;
begin
  with candidates as (
    select i.id from public.beta_invites i
    where i.status = 'pending' and i.expires_at <= statement_timestamp()
    order by i.expires_at, i.id
    for update skip locked
    limit bounded_rows
  )
  update public.beta_invites i
  set status = 'expired'
  from candidates c where i.id = c.id;
  get diagnostics invite_count = row_count;

  with candidates as (
    select m.profile_id from public.beta_memberships m
    where m.status in ('active', 'suspended')
      and m.expires_at is not null
      and m.expires_at <= statement_timestamp()
    order by m.expires_at, m.profile_id
    for update skip locked
    limit bounded_rows
  )
  update public.beta_memberships m
  set status = 'expired'
  from candidates c where m.profile_id = c.profile_id;
  get diagnostics membership_count = row_count;

  with candidates as (
    select q.id from public.upload_quarantine q
    where q.status in ('pending', 'processing')
      and q.expires_at <= statement_timestamp()
    order by q.expires_at, q.id
    for update skip locked
    limit bounded_rows
  ), expired_uploads as (
    update public.upload_quarantine q
    set status = 'expired', rejection_code = 'quarantine_expired'
    from candidates c where q.id = c.id
    returning q.id, q.bucket_id, q.quarantine_path
  ), queued as (
    insert into public.upload_cleanup_queue (
      upload_id, bucket_id, storage_path, reason
    )
    select e.id, e.bucket_id, e.quarantine_path, 'quarantine_expired'
    from expired_uploads e
    on conflict (bucket_id, storage_path) where processed_at is null do nothing
    returning 1
  )
  select count(*) into upload_count from expired_uploads;

  with candidates as (
    select l.id from public.listings l
    where l.status = 'active'
      and l.expires_at is not null
      and l.expires_at <= statement_timestamp()
    order by l.expires_at, l.id
    for update skip locked
    limit bounded_rows
  ), expired_listings as (
    update public.listings l
    set status = 'expired'
    from candidates c where l.id = c.id
    returning l.id, l.seller_id, l.slug
  ), notified as (
    insert into public.notifications (
      profile_id, kind, title, body, action_url, data, created_at
    )
    select
      e.seller_id,
      'listing_expired'::public.notification_kind,
      'Обявата е изтекла',
      'Можете да я прегледате и публикувате отново.',
      '/listing/' || e.slug,
      jsonb_build_object('listingId', e.id),
      statement_timestamp()
    from expired_listings e
    returning 1
  )
  select count(*) into listing_count from expired_listings;

  with candidates as (
    select o.id from public.offers o
    where o.status = 'pending'
      and (
        o.expires_at <= statement_timestamp()
        or exists (
          select 1 from public.listings l
          where l.id = o.listing_id
            and l.status in ('expired', 'completed', 'rejected', 'removed')
        )
      )
    order by o.expires_at, o.id
    for update skip locked
    limit bounded_rows
  )
  update public.offers o
  set status = 'expired', responded_at = statement_timestamp()
  from candidates c where o.id = c.id;
  get diagnostics offer_count = row_count;

  return jsonb_build_object(
    'expiredInvites', invite_count,
    'expiredMemberships', membership_count,
    'expiredUploads', upload_count,
    'expiredListings', listing_count,
    'expiredOffers', offer_count,
    'completedAt', statement_timestamp()
  );
end;
$$;

create or replace function public.run_beta_maintenance(max_rows integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return private.run_beta_maintenance(max_rows);
end;
$$;

create or replace function private.queue_listing_expiry_notifications(
  max_rows integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, created_at
  )
  select
    l.seller_id,
    'listing_expiring'::public.notification_kind,
    'Обявата изтича скоро',
    'Прегледайте я преди да изтече.',
    '/listing/' || l.slug,
    jsonb_build_object('listingId', l.id),
    statement_timestamp()
  from public.listings l
  where l.status = 'active'
    and l.expires_at > statement_timestamp()
    and l.expires_at <= statement_timestamp() + interval '3 days'
    and not exists (
      select 1 from public.notifications n
      where n.profile_id = l.seller_id
        and n.kind = 'listing_expiring'
        and n.data ->> 'listingId' = l.id::text
    )
  order by l.expires_at, l.id
  limit greatest(1, least(coalesce(max_rows, 500), 5000));
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

alter table public.listings replica identity full;
alter table public.listing_photos replica identity full;
alter table public.offers replica identity full;
alter table public.deal_confirmations replica identity full;
alter table public.reports replica identity full;
alter table public.beta_memberships replica identity full;
alter table public.upload_quarantine replica identity full;

do $$
declare
  realtime_table text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach realtime_table in array array[
      'listings', 'listing_photos', 'offers', 'deal_confirmations', 'reports',
      'beta_memberships', 'upload_quarantine'
    ]
    loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
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

-- pg_cron is available on hosted Supabase but may be absent in lightweight CI
-- PostgreSQL images.  The maintenance functions always install; scheduling is
-- enabled transactionally when the extension is available to the migration role.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron'
  ) and not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    begin
      execute 'create extension pg_cron';
    exception when others then
      raise notice 'pg_cron is available but could not be enabled: %', sqlerrm;
    end;
  end if;
end;
$$;

do $$
begin
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'perfume-beta-maintenance',
      '*/5 * * * *',
      'select private.run_beta_maintenance(500)'
    );
    perform cron.schedule(
      'perfume-beta-expiry-notifications',
      '15 8 * * *',
      'select private.queue_listing_expiry_notifications(500)'
    );
  end if;
end;
$$;

revoke execute on function public.slugify_marketplace(text)
  from public, anon, authenticated;
revoke execute on function public.assign_fragrance_slug()
  from public, anon, authenticated;
revoke execute on function public.assign_listing_slug()
  from public, anon, authenticated;

alter table public.notification_email_deliveries enable row level security;
revoke all on public.notification_email_deliveries
  from public, anon, authenticated, service_role;
grant select on public.notification_email_deliveries to service_role;

revoke execute on function public.queue_notification_email_delivery()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_offer_received()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_message_received()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_deal_confirmation_needed()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_review_received()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_report_created()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_report_updated()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_merchant_application_staff()
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_merchant_application_owner()
  from public, anon, authenticated, service_role;

revoke execute on function public.claim_notification_email_delivery(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_email_sent(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_email_failed(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_notification_email_delivery(uuid, text)
  to service_role;
grant execute on function public.mark_notification_email_sent(uuid, text, text)
  to service_role;
grant execute on function public.mark_notification_email_failed(uuid, text, text)
  to service_role;

revoke execute on function public.mark_upload_cleanup_complete(bigint, text)
  from public, anon, authenticated, service_role;
drop function public.mark_upload_cleanup_complete(bigint, text);
revoke all on private.upload_cleanup_claim_requests
  from public, anon, authenticated, service_role;
revoke all on public.upload_cleanup_queue
  from public, anon, authenticated, service_role;
grant select on public.upload_cleanup_queue to service_role;
revoke execute on function public.claim_upload_cleanup(integer, text)
  from public, anon, authenticated;
revoke execute on function public.complete_upload_cleanup(bigint, text)
  from public, anon, authenticated;
revoke execute on function public.fail_upload_cleanup(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_upload_cleanup(integer, text)
  to service_role;
grant execute on function public.complete_upload_cleanup(bigint, text)
  to service_role;
grant execute on function public.fail_upload_cleanup(bigint, text, text)
  to service_role;

revoke execute on function public.search_catalog(text, integer) from public, anon;
revoke execute on function public.search_listings(
  text, public.audience, public.segment[], public.deal_mode, text,
  integer, integer, integer, timestamptz, uuid
) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;
grant execute on function public.search_listings(
  text, public.audience, public.segment[], public.deal_mode, text,
  integer, integer, integer, timestamptz, uuid
) to authenticated;

revoke execute on function private.run_beta_maintenance(integer)
  from public, anon, authenticated;
revoke execute on function private.queue_listing_expiry_notifications(integer)
  from public, anon, authenticated;
revoke execute on function public.run_beta_maintenance(integer)
  from public, anon, authenticated;
grant execute on function private.run_beta_maintenance(integer) to service_role;
grant execute on function private.queue_listing_expiry_notifications(integer)
  to service_role;
grant execute on function public.run_beta_maintenance(integer) to service_role;

comment on function public.search_listings(
  text, public.audience, public.segment[], public.deal_mode, text,
  integer, integer, integer, timestamptz, uuid
) is 'Closed-beta listing discovery with indexed text matching, typed filters and stable recency cursor.';

comment on table public.notification_email_deliveries is
  'Content-free, service-only delivery ledger. notification_id is the stable provider idempotency key; recipient addresses and message bodies are never stored here.';

comment on function public.claim_upload_cleanup(integer, text) is
  'Service-only bounded storage cleanup lease. Request tokens are idempotent; stale leases are reclaimable after five minutes and exhaust after eight attempts.';

commit;
