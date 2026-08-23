create or replace function private.is_deal_identity_consistent(
  target_listing_id uuid,
  target_accepted_offer_id uuid,
  target_offered_listing_id uuid,
  target_party_a_id uuid,
  target_party_b_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.listings l
    join public.offers o
      on o.id = target_accepted_offer_id
     and o.listing_id = target_listing_id
     and o.offered_listing_id is not distinct from target_offered_listing_id
     and o.offerer_id = target_party_b_id
     and o.status = 'accepted'
    where l.id = target_listing_id
      and l.seller_id = target_party_a_id
  );
$$;

revoke execute on function private.is_deal_identity_consistent(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_deal_identity_consistent(uuid, uuid, uuid, uuid, uuid)
  to authenticated;

drop policy if exists deals_participant_read on public.deals;
create policy deals_participant_read on public.deals
for select to authenticated
using (
  public.is_staff()
  or (
    auth.uid() in (party_a_id, party_b_id)
    and private.is_deal_identity_consistent(
      listing_id,
      accepted_offer_id,
      offered_listing_id,
      party_a_id,
      party_b_id
    )
  )
);

create or replace function public.complete_deal(target_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  deal_record public.deals%rowtype;
  completed_deal public.deals%rowtype;
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

  perform l.id
  from public.listings l
  where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
  order by l.id
  for update;

  if not private.is_deal_identity_consistent(
    deal_record.listing_id,
    deal_record.accepted_offer_id,
    deal_record.offered_listing_id,
    deal_record.party_a_id,
    deal_record.party_b_id
  ) then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
  if requesting_user <> deal_record.party_a_id then
    raise exception 'only the listing seller can complete this deal' using errcode = '42501';
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'only an active accepted deal can be completed' using errcode = '23514';
  end if;

  update public.deals
  set status = 'completed', completed_at = statement_timestamp()
  where id = target_deal_id
  returning * into completed_deal;

  update public.listings
  set status = 'completed', completed_at = statement_timestamp()
  where id in (deal_record.listing_id, deal_record.offered_listing_id);

  update public.profiles
  set completed_deals_count = completed_deals_count + 1
  where id in (deal_record.party_a_id, deal_record.party_b_id);

  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values
    (
      deal_record.party_a_id,
      'deal_completed',
      'Отбелязахте сделката като приключена',
      'Вие и купувачът вече можете да оставите отзив.',
      '/deals?highlight=' || target_deal_id::text,
      jsonb_build_object('dealId', target_deal_id, 'role', 'seller'),
      'deal_completed:' || target_deal_id::text || ':' || deal_record.party_a_id::text
    ),
    (
      deal_record.party_b_id,
      'deal_completed',
      'Продавачът приключи сделката',
      'Вече можете да оставите отзив за сделката.',
      '/deals?highlight=' || target_deal_id::text,
      jsonb_build_object('dealId', target_deal_id, 'role', 'buyer'),
      'deal_completed:' || target_deal_id::text || ':' || deal_record.party_b_id::text
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return completed_deal;
end;
$$;

create or replace function public.cancel_deal(target_deal_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  deal_record public.deals%rowtype;
  normalized_reason text := btrim(coalesce(reason, ''));
  counterpart_id uuid;
  actor_role text;
begin
  perform public.assert_active_beta_user();
  if char_length(normalized_reason) not between 2 and 1000 then
    raise exception 'cancellation reason must contain between 2 and 1000 characters'
      using errcode = '23514';
  end if;

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;

  perform l.id
  from public.listings l
  where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
  order by l.id
  for update;

  if not private.is_deal_identity_consistent(
    deal_record.listing_id,
    deal_record.accepted_offer_id,
    deal_record.offered_listing_id,
    deal_record.party_a_id,
    deal_record.party_b_id
  ) then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
  if deal_record.status not in ('pending_confirmation', 'disputed') then
    raise exception 'only an active accepted deal can be cancelled' using errcode = '23514';
  end if;

  delete from public.deal_confirmations where deal_id = target_deal_id;

  update public.deals
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      cancelled_by = requesting_user,
      cancellation_reason = normalized_reason
  where id = target_deal_id;

  delete from public.deal_listing_locks where deal_id = target_deal_id;
  update public.listings
  set status = 'paused'
  where id in (deal_record.listing_id, deal_record.offered_listing_id)
    and status = 'reserved';
  update public.conversations
  set status = 'archived'
  where accepted_offer_id = deal_record.accepted_offer_id;

  counterpart_id := case
    when requesting_user = deal_record.party_a_id then deal_record.party_b_id
    else deal_record.party_a_id
  end;
  actor_role := case
    when requesting_user = deal_record.party_a_id then 'seller'
    else 'buyer'
  end;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key
  ) values (
    counterpart_id,
    'deal_cancelled',
    case actor_role
      when 'seller' then 'Продавачът отказа сделката'
      else 'Купувачът отказа сделката'
    end,
    'Сделката е отказана с посочена причина.',
    '/deals?highlight=' || target_deal_id::text,
    jsonb_build_object(
      'dealId', target_deal_id,
      'cancelledByRole', actor_role,
      'reason', normalized_reason
    ),
    'deal_cancelled:' || target_deal_id::text || ':' || counterpart_id::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
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
  if not found then
    raise exception 'reviews require a seller-completed deal' using errcode = '23514';
  end if;
  if not private.is_deal_identity_consistent(
    target_deal.listing_id,
    target_deal.accepted_offer_id,
    target_deal.offered_listing_id,
    target_deal.party_a_id,
    target_deal.party_b_id
  ) then
    raise exception 'review deal identity is inconsistent' using errcode = '23514';
  end if;
  if target_deal.status <> 'completed' then
    raise exception 'reviews require a seller-completed deal' using errcode = '23514';
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

create or replace function public.normalize_legacy_deal_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'deal_confirmation_needed' then
    new.title := 'Продавачът приключва сделката';
    new.body := 'Сделката вече се отбелязва като приключена от продавача. Отворете я за актуален статус.';
    new.status := 'archived';
    new.read_at := coalesce(new.read_at, statement_timestamp());
    new.data := (coalesce(new.data, '{}'::jsonb) - 'confirmedBy')
      || jsonb_build_object('lifecycle', 'seller_completion');
  end if;
  return new;
end;
$$;

revoke execute on function public.normalize_legacy_deal_notification()
  from public, anon, authenticated, service_role;
drop trigger if exists normalize_legacy_deal_notification on public.notifications;
create trigger normalize_legacy_deal_notification
before insert or update on public.notifications
for each row execute function public.normalize_legacy_deal_notification();

update public.notifications n
set title = 'Продавачът приключва сделката',
    body = 'Сделката вече се отбелязва като приключена от продавача. Отворете я за актуален статус.',
    status = 'archived',
    read_at = coalesce(n.read_at, statement_timestamp()),
    data = (coalesce(n.data, '{}'::jsonb) - 'confirmedBy')
      || jsonb_build_object('lifecycle', 'seller_completion')
where n.kind = 'deal_confirmation_needed';

-- Sent rows are durable delivery evidence. Every other legacy ledger row is
-- unsent/reclaimable work and is safely removed by the migration owner.
-- A worker that claimed before this transaction may already hold old content;
-- deployments must quiesce/drain the worker to exclude that narrow race.
delete from public.notification_email_deliveries d
using public.notifications n
where d.notification_id = n.id
  and n.kind = 'deal_confirmation_needed'
  and d.status <> 'sent';

create or replace function public.queue_notification_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'deal_confirmation_needed' or new.status = 'archived' then
    return new;
  end if;
  insert into public.notification_email_deliveries (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.queue_notification_email_delivery()
  from public, anon, authenticated, service_role;

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
  select * into notification
  from public.notifications n
  where n.id = target_notification_id;
  if not found then
    raise exception 'canonical notification was not found' using errcode = 'P0002';
  end if;
  if notification.kind = 'deal_confirmation_needed' then
    raise exception 'legacy deal confirmation email delivery is suppressed'
      using errcode = '42501';
  end if;

  delivery := public.claim_notification_email_delivery(
    target_notification_id,
    worker_request_id
  );

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
  from public, anon, authenticated, service_role;
grant execute on function public.claim_notification_email_delivery_v2(uuid, text)
  to service_role;

revoke execute on function public.complete_deal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_deal(uuid) to authenticated;
revoke execute on function public.cancel_deal(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_deal(uuid, text) to authenticated;
