begin;

-- Repeat the beta predicate in user-write RLS policies as defense in depth.
-- The table triggers from migration 003 remain the comprehensive backstop,
-- including security-sensitive tables whose ordinary policy has no write path.
alter policy profiles_own_update on public.profiles
using (id = auth.uid() and not is_suspended and public.is_active_beta_user())
with check (id = auth.uid() and public.is_active_beta_user());

alter policy merchant_applicant_create on public.merchant_applications
with check (
  public.is_active_beta_user()
  and applicant_id = auth.uid()
  and status in ('draft', 'submitted')
  and reviewer_id is null
  and reviewer_notes is null
  and reviewed_at is null
);

alter policy merchant_applicant_update on public.merchant_applications
using (
  public.is_active_beta_user()
  and applicant_id = auth.uid()
  and status in ('draft', 'submitted')
)
with check (
  public.is_active_beta_user()
  and applicant_id = auth.uid()
  and status in ('draft', 'submitted', 'withdrawn')
);

alter policy brands_pending_create on public.brands
with check (
  public.is_active_beta_user()
  and created_by = auth.uid()
  and status = 'pending_canonicalization'
  and provenance ->> 'source' = 'seller'
  and merged_into_brand_id is null
  and canonicalized_by is null
  and canonicalized_at is null
);

alter policy listings_owner_create on public.listings
with check (
  public.is_active_beta_user()
  and seller_id = auth.uid()
  and status = 'draft'
  and activated_at is null
  and expires_at is null
  and completed_at is null
);

alter policy listings_owner_update on public.listings
using (
  public.is_active_beta_user()
  and seller_id = auth.uid()
  and status not in ('completed', 'removed')
)
with check (public.is_active_beta_user() and seller_id = auth.uid());

alter policy listings_owner_delete_draft on public.listings
using (public.is_active_beta_user() and seller_id = auth.uid() and status = 'draft');

alter policy listing_photos_owner_delete on public.listing_photos
using (
  public.is_active_beta_user()
  and exists (
    select 1 from public.listings l
    where l.id = listing_id
      and l.seller_id = auth.uid()
      and l.status in ('draft', 'paused')
  )
);

alter policy authenticity_reviews_owner_request on public.listing_authenticity_reviews
with check (
  public.is_active_beta_user()
  and requested_by = auth.uid()
  and status = 'pending'
  and public_note is null
  and reviewed_at is null
  and exists (
    select 1 from public.listings l
    where l.id = listing_id and l.seller_id = auth.uid() and l.kind = 'offer'
  )
);

alter policy favorites_owner_all on public.favorites
using (public.is_active_beta_user() and profile_id = auth.uid())
with check (public.is_active_beta_user() and profile_id = auth.uid());

alter policy saved_searches_owner_all on public.saved_searches
using (public.is_active_beta_user() and profile_id = auth.uid())
with check (public.is_active_beta_user() and profile_id = auth.uid());

alter policy offers_offerer_create on public.offers
with check (
  public.is_active_beta_user() and offerer_id = auth.uid() and status = 'pending'
);

alter policy offers_offerer_withdraw on public.offers
using (
  public.is_active_beta_user() and offerer_id = auth.uid() and status = 'pending'
)
with check (
  public.is_active_beta_user() and offerer_id = auth.uid() and status = 'withdrawn'
);

alter policy conversation_members_self_update on public.conversation_members
using (
  public.is_active_beta_user()
  and profile_id = auth.uid()
  and public.is_conversation_member(conversation_id)
)
with check (public.is_active_beta_user() and profile_id = auth.uid());

alter policy messages_members_create on public.messages
with check (
  public.is_active_beta_user()
  and sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.status = 'open'
  )
);

alter policy messages_sender_edit on public.messages
using (
  public.is_active_beta_user()
  and sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.status = 'open'
  )
)
with check (public.is_active_beta_user() and sender_id = auth.uid());

alter policy deal_confirmations_self_create on public.deal_confirmations
with check (public.is_active_beta_user() and profile_id = auth.uid());

alter policy reviews_reviewer_create on public.reviews
with check (
  public.is_active_beta_user() and reviewer_id = auth.uid() and status = 'published'
);

alter policy reviews_reviewer_edit on public.reviews
using (
  public.is_active_beta_user() and reviewer_id = auth.uid() and status = 'published'
)
with check (
  public.is_active_beta_user() and reviewer_id = auth.uid() and status = 'published'
);

alter policy profile_comments_author_create on public.profile_comments
with check (
  public.is_active_beta_user() and author_id = auth.uid() and status = 'published'
);

alter policy profile_comments_author_edit on public.profile_comments
using (
  public.is_active_beta_user() and author_id = auth.uid() and status = 'published'
)
with check (
  public.is_active_beta_user() and author_id = auth.uid() and status = 'published'
);

alter policy reports_reporter_create on public.reports
with check (
  public.is_active_beta_user()
  and reporter_id = auth.uid()
  and status = 'open'
  and assigned_to is null
  and resolution_code is null
  and resolution_notes is null
  and resolved_at is null
);

alter policy notifications_owner_update on public.notifications
using (public.is_active_beta_user() and profile_id = auth.uid())
with check (public.is_active_beta_user() and profile_id = auth.uid());

alter policy notifications_owner_delete on public.notifications
using (public.is_active_beta_user() and profile_id = auth.uid());

create or replace function public.enforce_client_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_user = 'authenticated' then
    new.created_at := statement_timestamp();
  elsif tg_op = 'UPDATE' and new.created_at is distinct from old.created_at then
    raise exception 'created_at is server-managed and immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  timestamped_table text;
begin
  foreach timestamped_table in array array[
    'profiles', 'merchant_applications', 'brands', 'brand_aliases', 'fragrances',
    'listings', 'listing_photos', 'listing_authenticity_reviews', 'favorites',
    'saved_searches', 'offers', 'conversations', 'messages',
    'deals', 'deal_listing_locks', 'reviews', 'profile_comments', 'reports',
    'moderation_audit', 'payments', 'payment_refunds', 'entitlements', 'notifications'
  ]
  loop
    execute format(
      'create trigger enforce_client_created_at before insert or update on public.%I for each row execute function public.enforce_client_created_at()',
      timestamped_table
    );
  end loop;
end;
$$;

-- Strong lifecycle shapes are NOT VALID so a production database containing a
-- legacy bad row can still deploy the forward migration.  PostgreSQL enforces
-- them for all new/changed rows immediately; operators can repair and VALIDATE
-- the historical set separately.
alter table public.listings
  add constraint listing_lifecycle_window_shape check (
    status not in ('active', 'reserved', 'expired')
    or (
      activated_at is not null
      and expires_at is not null
      and expires_at > activated_at
    )
  ) not valid;

alter table public.listings
  add constraint listing_completion_timestamp_shape check (
    (status = 'completed') = (completed_at is not null)
  ) not valid;

alter table public.offers
  add constraint offer_response_timestamp_shape check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  ) not valid;

alter table public.offers
  add constraint offer_expiry_after_creation check (expires_at > created_at) not valid;

alter table public.messages
  add constraint message_edit_timestamp_shape check (
    edited_at is null or edited_at >= created_at
  ) not valid;

alter table public.messages
  add constraint message_delete_timestamp_shape check (
    deleted_at is null or deleted_at >= created_at
  ) not valid;

alter table public.notifications
  add constraint notification_read_timestamp_shape check (
    status <> 'read' or read_at is not null
  ) not valid;

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
  photo_roles public.photo_role[];
begin
  if new.status <> 'active' then
    return new;
  end if;
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
    select count(*), coalesce(array_agg(distinct lp.role), '{}'::public.photo_role[])
      into photo_count, photo_roles
    from public.listing_photos lp
    where lp.listing_id = new.id and lp.sanitized_at is not null;
    if photo_count < 4 then
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

create or replace function public.validate_offer_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.listings%rowtype;
  swap_item public.listings%rowtype;
begin
  if tg_op = 'UPDATE' then
    if row(
         new.listing_id, new.offerer_id, new.kind, new.cash_amount_minor,
         new.offered_listing_id, new.expires_at, new.created_at
       ) is distinct from row(
         old.listing_id, old.offerer_id, old.kind, old.cash_amount_minor,
         old.offered_listing_id, old.expires_at, old.created_at
       )
    then
      raise exception 'offer identity, terms and expiry are immutable'
        using errcode = '23514';
    end if;
    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'responded offers are terminal' using errcode = '23514';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'pending'
         or new.status not in ('accepted', 'declined', 'withdrawn', 'expired')
      then
        raise exception 'invalid offer transition' using errcode = '23514';
      end if;
      if current_user = 'authenticated' and new.status <> 'withdrawn' then
        raise exception 'offer response requires the server workflow'
          using errcode = '42501';
      end if;
      if new.status = 'accepted' and not (
        private.is_active_beta_user(new.offerer_id)
        and exists (
          select 1 from public.listings l
          where l.id = new.listing_id
            and private.is_active_beta_user(l.seller_id)
        )
      ) then
        raise exception 'both offer participants require active beta memberships'
          using errcode = '42501';
      end if;
      new.responded_at := statement_timestamp();
    elsif new.responded_at is distinct from old.responded_at then
      raise exception 'responded_at is server-managed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status <> 'pending' then
    raise exception 'new offers must be pending' using errcode = '23514';
  end if;
  if not private.is_active_beta_user(new.offerer_id) then
    raise exception 'active beta membership is required before making an offer'
      using errcode = '42501';
  end if;
  if not private.has_verified_phone(new.offerer_id) then
    raise exception 'phone verification is required before making an offer'
      using errcode = '23514';
  end if;

  select * into target
  from public.listings
  where id = new.listing_id
  for share;
  if not found
     or target.status <> 'active'
     or target.expires_at is null
     or target.expires_at <= statement_timestamp()
     or not private.is_active_beta_user(target.seller_id)
  then
    raise exception 'offers require an active beta listing' using errcode = '23514';
  end if;
  if target.seller_id = new.offerer_id then
    raise exception 'self offers are not allowed' using errcode = '23514';
  end if;
  if (target.deal_mode = 'sale' and new.kind <> 'cash')
     or (target.deal_mode = 'swap' and new.kind <> 'swap')
  then
    raise exception 'offer kind is incompatible with listing deal mode'
      using errcode = '23514';
  end if;

  if new.offered_listing_id is not null then
    select * into swap_item
    from public.listings
    where id = new.offered_listing_id
    for share;
    if not found
       or swap_item.seller_id <> new.offerer_id
       or swap_item.status <> 'active'
       or swap_item.expires_at is null
       or swap_item.expires_at <= statement_timestamp()
       or swap_item.kind <> 'offer'
       or swap_item.deal_mode not in ('swap', 'sale_or_swap')
       or coalesce(swap_item.remaining_ml, 0) <= 0
    then
      raise exception 'swap item must be an active listing owned by the offerer'
        using errcode = '23514';
    end if;
  end if;

  new.created_at := statement_timestamp();
  new.expires_at := least(
    target.expires_at,
    statement_timestamp() + interval '7 days'
  );
  new.responded_at := null;
  return new;
end;
$$;

create or replace function public.validate_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_beta_user(new.sender_id) then
    raise exception 'active beta membership is required to send messages'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.status = 'open'
  ) then
    raise exception 'messages require an open conversation' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.profile_id = new.sender_id
      and cm.blocked_at is null
  ) then
    raise exception 'sender is not an active conversation member' using errcode = '42501';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply target belongs to another conversation' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_at := statement_timestamp(); end if;
  return new;
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
  select * into target_deal
  from public.deals where id = new.deal_id for update;
  if not found or target_deal.status <> 'pending_confirmation' then
    raise exception 'deal is not awaiting confirmation' using errcode = '23514';
  end if;
  if new.profile_id not in (target_deal.party_a_id, target_deal.party_b_id) then
    raise exception 'profile is not a deal participant' using errcode = '42501';
  end if;
  if not (
    private.is_active_beta_user(target_deal.party_a_id)
    and private.is_active_beta_user(target_deal.party_b_id)
  ) then
    raise exception 'both deal participants require active beta memberships'
      using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> new.profile_id then
    raise exception 'cannot confirm a deal for another user' using errcode = '42501';
  end if;
  new.confirmed_at := statement_timestamp();
  return new;
end;
$$;

create or replace function public.validate_review_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_deal public.deals%rowtype;
begin
  if not private.is_active_beta_user(new.reviewer_id) then
    raise exception 'active beta membership is required to write a review'
      using errcode = '42501';
  end if;
  select * into target_deal from public.deals where id = new.deal_id;
  if not found or target_deal.status <> 'completed' then
    raise exception 'reviews require a mutually confirmed deal' using errcode = '23514';
  end if;
  if new.reviewer_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewee_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewer_id = new.reviewee_id
  then
    raise exception 'review parties do not match the deal' using errcode = '23514';
  end if;
  if auth.uid() is not null and auth.uid() <> new.reviewer_id and not public.is_staff() then
    raise exception 'cannot author a review for another profile' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.deal_id is distinct from old.deal_id
    or new.reviewer_id is distinct from old.reviewer_id
    or new.reviewee_id is distinct from old.reviewee_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'review identity fields are immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_at := statement_timestamp(); end if;
  return new;
end;
$$;

create or replace function public.publish_listing(target_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  listing_record public.listings%rowtype;
begin
  perform public.assert_active_beta_user();
  select * into listing_record
  from public.listings l
  where l.id = target_listing_id
  for update;
  if not found or listing_record.seller_id <> auth.uid() then
    raise exception 'listing is not available to this seller' using errcode = '42501';
  end if;
  if listing_record.status = 'active' then return listing_record; end if;
  if listing_record.status not in ('draft', 'paused', 'expired') then
    raise exception 'listing cannot be published from its current status'
      using errcode = '23514';
  end if;

  update public.listings
  set status = 'active'
  where id = target_listing_id
  returning * into listing_record;
  return listing_record;
end;
$$;

create or replace function public.confirm_deal(target_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  deal_record public.deals%rowtype;
  requesting_user uuid := auth.uid();
begin
  perform public.assert_active_beta_user();
  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.deal_confirmations dc
    where dc.deal_id = target_deal_id and dc.profile_id = requesting_user
  ) then
    return deal_record;
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'deal is not awaiting confirmation' using errcode = '23514';
  end if;

  insert into public.deal_confirmations (deal_id, profile_id, confirmed_at)
  values (target_deal_id, requesting_user, statement_timestamp());

  select * into deal_record from public.deals d where d.id = target_deal_id;
  return deal_record;
end;
$$;

revoke execute on function public.enforce_client_created_at()
  from public, anon, authenticated;

revoke execute on function public.publish_listing(uuid) from public, anon;
revoke execute on function public.confirm_deal(uuid) from public, anon;
grant execute on function public.publish_listing(uuid) to authenticated;
grant execute on function public.confirm_deal(uuid) to authenticated;

commit;
