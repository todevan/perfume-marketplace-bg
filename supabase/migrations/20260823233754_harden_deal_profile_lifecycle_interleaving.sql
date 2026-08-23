create or replace function private.reject_completed_deal_with_inactive_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from 'completed'
     and new.status = 'completed'
     and (
       not private.is_active_beta_user(new.party_a_id)
       or not private.is_active_beta_user(new.party_b_id)
     )
  then
    raise exception 'deal participants are not active' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_completed_deal_with_inactive_participant()
  from public, anon, authenticated, service_role;
drop trigger if exists reject_completed_deal_with_inactive_participant on public.deals;
create trigger reject_completed_deal_with_inactive_participant
before update of status on public.deals
for each row execute function private.reject_completed_deal_with_inactive_participant();

create or replace function public.resolve_deal_dispute(
  report_case_id uuid,
  target_deal_id uuid,
  resolution_status public.deal_status,
  rationale text
)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_staff uuid := auth.uid();
  target_report public.reports%rowtype;
  deal_snapshot public.deals%rowtype;
  deal_record public.deals%rowtype;
  updated_deal public.deals%rowtype;
  normalized_rationale text := btrim(coalesce(rationale, ''));
  report_resolution_code text;
begin
  if not public.is_staff() then
    raise exception 'active staff role required' using errcode = '42501';
  end if;
  if resolution_status not in ('pending_confirmation', 'cancelled') then
    raise exception 'a dispute may only resume confirmation or cancel the deal'
      using errcode = '22023';
  end if;
  if char_length(normalized_rationale) not between 10 and 4000
     or (
       resolution_status = 'cancelled'
       and char_length(normalized_rationale) > 1000
     )
  then
    raise exception 'resolution rationale has an invalid length'
      using errcode = '22023';
  end if;

  select * into target_report
  from public.reports r
  where r.id = report_case_id
  for update;
  if not found
     or target_report.target_type <> 'deal'
     or target_report.target_id <> target_deal_id
     or target_report.status <> 'investigating'
     or target_report.assigned_to is distinct from requesting_staff
  then
    raise exception 'an assigned investigating deal report is required'
      using errcode = '42501';
  end if;

  select * into deal_snapshot
  from public.deals d
  where d.id = target_deal_id;
  if not found then
    raise exception 'the reported deal is neither disputed nor participant-cancelled'
      using errcode = '23514';
  end if;

  perform private.lock_profile_lifecycle(
    deal_snapshot.party_a_id,
    deal_snapshot.party_b_id
  );

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found or deal_record.status not in ('disputed', 'cancelled') then
    raise exception 'the reported deal is neither disputed nor participant-cancelled'
      using errcode = '23514';
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
    raise exception 'deal identity is inconsistent' using errcode = '23514';
  end if;

  if deal_record.status = 'cancelled' then
    if resolution_status <> 'cancelled' then
      raise exception 'a participant-cancelled deal cannot be resumed'
        using errcode = '23514';
    end if;
    updated_deal := deal_record;
    report_resolution_code := 'deal_cancelled_by_participant';
  else
    delete from public.deal_confirmations where deal_id = target_deal_id;

    if resolution_status = 'pending_confirmation' then
      if not private.is_active_beta_user(deal_record.party_a_id)
         or not private.is_active_beta_user(deal_record.party_b_id)
      then
        raise exception 'a deal with an inactive participant cannot be resumed'
          using errcode = '23514';
      end if;
      update public.deals
      set status = 'pending_confirmation'
      where id = target_deal_id
      returning * into updated_deal;
      report_resolution_code := 'deal_confirmation_resumed';
    else
      update public.deals
      set status = 'cancelled',
          cancelled_at = statement_timestamp(),
          cancelled_by = requesting_staff,
          cancellation_reason = normalized_rationale
      where id = target_deal_id
      returning * into updated_deal;

      delete from public.deal_listing_locks where deal_id = target_deal_id;
      update public.listings
      set status = 'paused'
      where id in (deal_record.listing_id, deal_record.offered_listing_id)
        and status = 'reserved';
      update public.conversations
      set status = 'archived'
      where accepted_offer_id = deal_record.accepted_offer_id;
      report_resolution_code := 'deal_cancelled_after_dispute';
    end if;
  end if;

  update public.reports
  set status = 'resolved',
      resolution_code = report_resolution_code,
      resolution_notes = normalized_rationale
  where id = target_report.id;

  return updated_deal;
end;
$$;
revoke execute on function public.resolve_deal_dispute(
  uuid, uuid, public.deal_status, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_deal_dispute(
  uuid, uuid, public.deal_status, text
) to authenticated;


create or replace function public.accept_offer(target_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_offer public.offers%rowtype;
  target_listing public.listings%rowtype;
begin
  perform public.assert_active_beta_user();
  select * into target_offer
  from public.offers
  where id = target_offer_id;
  if not found
     or target_offer.status <> 'pending'
     or target_offer.expires_at is null
     or target_offer.expires_at <= now()
  then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;

  select * into target_listing
  from public.listings
  where id = target_offer.listing_id;
  if not found then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;
  if target_listing.seller_id <> auth.uid() then
    raise exception 'only the seller can accept this offer' using errcode = '42501';
  end if;

  perform private.lock_profile_lifecycle(
    target_listing.seller_id,
    target_offer.offerer_id
  );

  select * into target_offer
  from public.offers
  where id = target_offer_id;
  if not found
     or target_offer.status <> 'pending'
     or target_offer.expires_at is null
     or target_offer.expires_at <= now()
  then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;
  if not private.is_active_beta_user(target_listing.seller_id)
     or not private.is_active_beta_user(target_offer.offerer_id)
  then
    raise exception 'both offer participants must be active' using errcode = '42501';
  end if;

  return public.accept_offer_foundation(target_offer_id);
end;
$$;

create or replace function public.complete_deal(target_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  deal_snapshot public.deals%rowtype;
  deal_record public.deals%rowtype;
  completed_deal public.deals%rowtype;
begin
  perform public.assert_active_beta_user();

  select * into deal_snapshot
  from public.deals d
  where d.id = target_deal_id;
  if not found
     or requesting_user not in (deal_snapshot.party_a_id, deal_snapshot.party_b_id)
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
  if not private.is_deal_identity_consistent(
    deal_snapshot.listing_id,
    deal_snapshot.accepted_offer_id,
    deal_snapshot.offered_listing_id,
    deal_snapshot.party_a_id,
    deal_snapshot.party_b_id
  ) then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
  if requesting_user <> deal_snapshot.party_a_id then
    raise exception 'only the listing seller can complete this deal' using errcode = '42501';
  end if;

  perform private.lock_profile_lifecycle(
    deal_snapshot.party_a_id,
    deal_snapshot.party_b_id
  );

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
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
  if not private.is_active_beta_user(deal_record.party_a_id)
     or not private.is_active_beta_user(deal_record.party_b_id) then
    raise exception 'deal participants are not active' using errcode = '42501';
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'only an active accepted deal can be completed' using errcode = '23514';
  end if;

  perform l.id
  from public.listings l
  where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
  order by l.id
  for update;

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
  deal_snapshot public.deals%rowtype;
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

  select * into deal_snapshot
  from public.deals d
  where d.id = target_deal_id;
  if not found
     or requesting_user not in (deal_snapshot.party_a_id, deal_snapshot.party_b_id)
     or not private.is_deal_identity_consistent(
       deal_snapshot.listing_id,
       deal_snapshot.accepted_offer_id,
       deal_snapshot.offered_listing_id,
       deal_snapshot.party_a_id,
       deal_snapshot.party_b_id
     )
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;

  perform private.lock_profile_lifecycle(
    deal_snapshot.party_a_id,
    deal_snapshot.party_b_id
  );

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
     or not private.is_deal_identity_consistent(
       deal_record.listing_id,
       deal_record.accepted_offer_id,
       deal_record.offered_listing_id,
       deal_record.party_a_id,
       deal_record.party_b_id
     )
  then
    raise exception 'deal is not available to this participant' using errcode = '42501';
  end if;
  if not private.is_active_beta_user(requesting_user) then
    raise exception 'active beta membership is required' using errcode = '42501';
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
revoke execute on function public.accept_offer(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_offer(uuid) to authenticated;
revoke execute on function public.complete_deal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_deal(uuid) to authenticated;
revoke execute on function public.cancel_deal(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_deal(uuid, text) to authenticated;
