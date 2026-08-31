begin;

-- Mutual confirmation remains readable history, but it is no longer an active
-- deal mutation path.
drop trigger if exists validate_deal_confirmation on public.deal_confirmations;
drop trigger if exists complete_mutually_confirmed_deal on public.deal_confirmations;
drop trigger if exists notify_deal_confirmation_needed on public.deal_confirmations;

drop function if exists public.confirm_deal(uuid);
drop function if exists public.validate_deal_confirmation();
drop function if exists public.complete_mutually_confirmed_deal();
drop function if exists public.notify_deal_confirmation_needed();

drop policy if exists deal_confirmations_self_create on public.deal_confirmations;
revoke insert on table public.deal_confirmations from authenticated;
revoke update, delete, truncate, references, trigger
  on table public.deal_confirmations
  from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.deal_confirmations
  from public, anon, service_role;

create or replace function public.complete_deal(target_deal_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  deal_record public.deals%rowtype;
  listing_record public.listings%rowtype;
  completed_deal public.deals%rowtype;
  requesting_user uuid := auth.uid();
  target_listing_found boolean := false;
  transition_time timestamptz;
begin
  perform public.assert_active_beta_user();

  -- All participant lifecycle operations lock the deal before membership and
  -- inventory. Authorization is revalidated from locked rows, never from a
  -- stale pre-lock read.
  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  perform 1
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
  where c.accepted_offer_id = deal_record.accepted_offer_id
    and cm.profile_id = requesting_user
    and cm.blocked_at is null
  for update of cm;
  if not found then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  for listing_record in
    select l.*
    from public.listings l
    where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
    order by l.id
    for update
  loop
    if listing_record.id = deal_record.listing_id then
      target_listing_found := true;
      if listing_record.seller_id <> requesting_user then
        raise exception 'only the seller can complete this deal'
          using errcode = '42501';
      end if;
    end if;
  end loop;

  if not target_listing_found then
    raise exception 'deal inventory is unavailable' using errcode = '23514';
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'deal is not eligible for completion' using errcode = '23514';
  end if;
  transition_time := clock_timestamp();

  update public.deals
  set status = 'completed',
      completed_at = transition_time
  where id = target_deal_id
  returning * into completed_deal;

  -- A moderation-owned state is stronger than an ordinary lifecycle state.
  update public.listings
  set status = 'completed',
      completed_at = transition_time
  where id in (deal_record.listing_id, deal_record.offered_listing_id)
    and status = 'reserved';

  update public.profiles
  set completed_deals_count = completed_deals_count + 1
  where id in (deal_record.party_a_id, deal_record.party_b_id);

  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key, created_at
  )
  values
    (
      deal_record.party_a_id,
      'deal_completed',
      'Сделката е завършена',
      'Вече можете да оставите отзив.',
      '/deals?highlight=' || target_deal_id::text,
      jsonb_build_object('dealId', target_deal_id),
      'deal_completed:' || target_deal_id::text || ':' || deal_record.party_a_id::text,
      transition_time
    ),
    (
      deal_record.party_b_id,
      'deal_completed',
      'Сделката е завършена',
      'Вече можете да оставите отзив.',
      '/deals?highlight=' || target_deal_id::text,
      jsonb_build_object('dealId', target_deal_id),
      'deal_completed:' || target_deal_id::text || ':' || deal_record.party_b_id::text,
      transition_time
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
  deal_record public.deals%rowtype;
  requesting_user uuid := auth.uid();
  normalized_reason text := regexp_replace(
    coalesce(reason, ''),
    '^[[:space:]   -   　﻿]+|[[:space:]   -   　﻿]+$',
    '',
    'g'
  );
  notification_recipient uuid;
  transition_time timestamptz;
begin
  perform public.assert_active_beta_user();
  if char_length(normalized_reason) not between 2 and 1000 then
    raise exception 'cancellation reason must contain 2 to 1000 characters'
      using errcode = '23514';
  end if;

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  perform 1
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
  where c.accepted_offer_id = deal_record.accepted_offer_id
    and cm.profile_id = requesting_user
    and cm.blocked_at is null
  for update of cm;
  if not found then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  perform l.id
  from public.listings l
  where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
  order by l.id
  for update;

  if deal_record.status not in ('pending_confirmation', 'disputed') then
    raise exception 'deal is not eligible for cancellation' using errcode = '23514';
  end if;
  transition_time := clock_timestamp();

  update public.deals
  set status = 'cancelled',
      cancelled_at = transition_time,
      cancelled_by = requesting_user,
      cancellation_reason = normalized_reason
  where id = target_deal_id;

  update public.listings
  set status = 'paused'
  where id in (deal_record.listing_id, deal_record.offered_listing_id)
    and status = 'reserved';

  update public.conversations
  set status = 'archived'
  where accepted_offer_id = deal_record.accepted_offer_id;

  notification_recipient := case
    when requesting_user = deal_record.party_a_id then deal_record.party_b_id
    else deal_record.party_a_id
  end;
  insert into public.notifications (
    profile_id, kind, title, body, action_url, data, dedupe_key, created_at
  )
  values (
    notification_recipient,
    'deal_cancelled',
    'Сделката е отменена',
    'Другият участник отмени сделката.',
    '/deals?highlight=' || target_deal_id::text,
    jsonb_build_object('dealId', target_deal_id),
    'deal_cancelled:' || target_deal_id::text || ':' || notification_recipient::text,
    transition_time
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- Keep the existing report-bound moderation workflow, but never erase legacy
-- participant confirmations when a dispute is resumed or cancelled. Those rows
-- are immutable historical evidence under the new lifecycle.
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
  deal_record public.deals%rowtype;
  updated_deal public.deals%rowtype;
  normalized_rationale text := btrim(coalesce(rationale, ''));
  report_resolution_code text;
  transition_time timestamptz;
begin
  if not public.is_staff() then
    raise exception 'active staff role required' using errcode = '42501';
  end if;
  if resolution_status not in ('pending_confirmation', 'cancelled') then
    raise exception 'a dispute may only resume seller completion or cancel the deal'
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

  -- Deal-first ordering matches participant lifecycle operations. The report
  -- is locked second so moderation cannot form a report -> deal deadlock cycle.
  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or deal_record.status not in ('disputed', 'cancelled')
  then
    raise exception 'the reported deal is not disputable' using errcode = '23514';
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

  if deal_record.status = 'cancelled' then
    if resolution_status <> 'cancelled' then
      raise exception 'a cancelled deal cannot resume seller completion'
        using errcode = '23514';
    end if;
    -- Participant cancellation is terminal evidence. Moderation dispositions
    -- the report without rewriting who cancelled, why, or when.
    updated_deal := deal_record;
    report_resolution_code := 'deal_cancelled_after_dispute';
  elsif resolution_status = 'pending_confirmation' then
    update public.deals
    set status = 'pending_confirmation'
    where id = target_deal_id
    returning * into updated_deal;
    report_resolution_code := 'deal_confirmation_resumed';
  else
    perform l.id
    from public.listings l
    where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
    order by l.id
    for update;
    transition_time := clock_timestamp();

    update public.deals
    set status = 'cancelled',
        cancelled_at = transition_time,
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

  update public.reports
  set status = 'resolved',
      resolution_code = report_resolution_code,
      resolution_notes = normalized_rationale
  where id = target_report.id;

  return updated_deal;
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
  if char_length(btrim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;
  if target_profile_id = auth.uid() then
    raise exception 'moderators cannot act on their own profile'
      using errcode = '42501';
  end if;

  select * into target_report
  from public.reports r
  where r.id = report_case_id
  for update;
  if not found then
    raise exception 'assigned moderation case required' using errcode = '42501';
  end if;
  perform private.require_assigned_moderation_case(
    target_report.id,
    'profile',
    target_profile_id
  );

  -- Lock every deal that suspension may dispute before touching the profile.
  -- Lifecycle RPCs already lock the deal first, so this removes the former
  -- profile -> deal inversion while retaining deterministic UUID order.
  perform d.id
  from public.deals d
  where d.status = 'pending_confirmation'
    and target_profile_id in (d.party_a_id, d.party_b_id)
  order by d.id
  for update;

  select * into previous_profile
  from public.profiles p
  where p.id = target_profile_id
  for update;
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
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, 'profile', target_profile_id,
    btrim(moderation_rationale), to_jsonb(previous_profile), to_jsonb(updated_profile)
  );
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
    raise exception 'reviews require a completed deal' using errcode = '23514';
  end if;
  if new.reviewer_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewee_id not in (target_deal.party_a_id, target_deal.party_b_id)
     or new.reviewer_id = new.reviewee_id
  then
    raise exception 'review parties do not match the deal' using errcode = '23514';
  end if;
  if auth.uid() is not null
     and auth.uid() <> new.reviewer_id
     and not public.is_staff()
  then
    raise exception 'cannot author a review for another profile'
      using errcode = '42501';
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

revoke execute on function public.complete_deal(uuid)
  from public, anon, service_role;
revoke execute on function public.cancel_deal(uuid, text)
  from public, anon, service_role;
revoke execute on function public.validate_review_write()
  from public, anon, authenticated, service_role;

grant execute on function public.complete_deal(uuid) to authenticated;
grant execute on function public.cancel_deal(uuid, text) to authenticated;

commit;
