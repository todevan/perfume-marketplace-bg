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
  normalized_reason text := btrim(
    coalesce(reason, ''),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
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
revoke execute on function public.cancel_deal(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_deal(uuid, text) to authenticated;
