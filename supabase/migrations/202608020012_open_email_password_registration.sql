begin;

-- Open email/password registration uses the existing onboarding and membership
-- lifecycle without requiring a one-use invite. Legacy invited memberships and
-- the operator-only first-admin bootstrap remain valid.
alter table public.beta_memberships
  alter column invite_id drop not null;

comment on column public.beta_memberships.invite_id is
  'Legacy invite that admitted the member; null for open email/password registration.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_account_kind public.account_kind;
begin
  requested_username := trim(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if requested_username !~ '^[[:alnum:]_.-]{3,40}$' then
    requested_username := 'user_' || replace(substr(new.id::text, 1, 12), '-', '');
  end if;
  requested_account_kind := case
    when new.raw_user_meta_data ->> 'account_kind' = 'merchant'
      then 'merchant'::public.account_kind
    else 'private'::public.account_kind
  end;

  begin
    insert into public.profiles (id, username, account_kind)
    values (new.id, requested_username, requested_account_kind)
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, username, account_kind)
    values (
      new.id,
      'user_' || replace(new.id::text, '-', ''),
      requested_account_kind
    )
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

create or replace function public.claim_open_registration()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = requesting_user
  ) then
    raise exception 'profile is not ready' using errcode = '42501';
  end if;

  -- Existing invite-era members must keep signing in normally. Restrict only
  -- creation of a new invite-free admission record.
  if exists (
    select 1
    from public.beta_memberships m
    where m.profile_id = requesting_user
  ) then
    return true;
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = requesting_user
      and u.invited_at is null
      and nullif(u.encrypted_password, '') is not null
      and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'email'
  ) then
    raise exception 'open registration requires a direct email/password account'
      using errcode = '42501';
  end if;

  insert into public.beta_memberships (profile_id, invite_id, status)
  values (requesting_user, null, 'pending')
  on conflict (profile_id) do nothing;
  return true;
end;
$$;

revoke execute on function public.claim_open_registration() from public, anon;
grant execute on function public.claim_open_registration() to authenticated;

-- Phone verification is no longer an account-activation or marketplace-action
-- prerequisite. All unrelated listing, offer, membership and moderation rules
-- remain authoritative.
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

commit;
