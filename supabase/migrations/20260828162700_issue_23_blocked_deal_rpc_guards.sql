begin;

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
     or not exists (
       select 1
       from public.conversations c
       where c.accepted_offer_id = deal_record.accepted_offer_id
         and public.is_conversation_member(c.id, requesting_user)
     )
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

create or replace function public.cancel_deal(target_deal_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deal_record public.deals%rowtype;
  requesting_user uuid := auth.uid();
begin
  perform public.assert_active_beta_user();
  if char_length(trim(coalesce(reason, ''))) < 2 then
    raise exception 'cancellation reason is required' using errcode = '23514';
  end if;

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
     or not exists (
       select 1
       from public.conversations c
       where c.accepted_offer_id = deal_record.accepted_offer_id
         and public.is_conversation_member(c.id, requesting_user)
     )
  then
    raise exception 'pending deal is not available to this participant'
      using errcode = '42501';
  end if;

  perform public.cancel_deal_foundation(target_deal_id, reason);
end;
$$;

create or replace function public.open_deal_dispute(
  target_deal_id uuid,
  details text
)
returns table (deal_id uuid, report_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  deal_record public.deals%rowtype;
  existing_report_id uuid;
  created_report_id uuid;
begin
  perform public.assert_active_beta_user();
  if char_length(btrim(coalesce(details, ''))) not between 10 and 4000 then
    raise exception 'dispute details must contain 10 to 4000 characters'
      using errcode = '22023';
  end if;

  -- The deal row is the concurrency lock. A second participant racing the
  -- first observes the disputed state and receives the same live report id.
  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
     or not exists (
       select 1
       from public.conversations c
       where c.accepted_offer_id = deal_record.accepted_offer_id
         and public.is_conversation_member(c.id, requesting_user)
     )
  then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  if deal_record.status = 'disputed' then
    select r.id into existing_report_id
    from public.reports r
    where r.target_type = 'deal'
      and r.target_id = target_deal_id
      and r.reason_code = 'deal_dispute'
      and r.status in ('open', 'investigating')
    order by r.created_at
    limit 1;
    if existing_report_id is null then
      raise exception 'disputed deal has no live moderation case'
        using errcode = '23514';
    end if;
    return query select target_deal_id, existing_report_id;
    return;
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'only a deal awaiting confirmation can be disputed'
      using errcode = '23514';
  end if;

  update public.deals
  set status = 'disputed', disputed_at = statement_timestamp()
  where id = target_deal_id;

  insert into public.reports (
    reporter_id, target_type, target_id, reason_code, details, status, created_at
  ) values (
    requesting_user, 'deal', target_deal_id, 'deal_dispute', btrim(details),
    'open', statement_timestamp()
  ) returning id into created_report_id;

  return query select target_deal_id, created_report_id;
end;
$$;

commit;
