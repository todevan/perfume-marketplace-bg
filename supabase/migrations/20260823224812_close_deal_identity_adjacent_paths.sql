drop policy if exists deals_participant_read on public.deals;
create policy deals_participant_read on public.deals
for select to authenticated
using (
  public.is_staff()
  or (
    public.is_active_beta_user()
    and auth.uid() in (party_a_id, party_b_id)
    and private.is_deal_identity_consistent(
      listing_id,
      accepted_offer_id,
      offered_listing_id,
      party_a_id,
      party_b_id
    )
  )
);

drop policy if exists deal_confirmations_participant_read on public.deal_confirmations;
create policy deal_confirmations_participant_read on public.deal_confirmations
for select to authenticated
using (
  public.is_staff()
  or (
    public.is_active_beta_user()
    and exists (
      select 1
      from public.deals d
      where d.id = deal_id
        and auth.uid() in (d.party_a_id, d.party_b_id)
        and private.is_deal_identity_consistent(
          d.listing_id,
          d.accepted_offer_id,
          d.offered_listing_id,
          d.party_a_id,
          d.party_b_id
        )
    )
  )
);

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
        select 1
        from public.deals d
        where d.id = new.target_id
          and new.reporter_id in (d.party_a_id, d.party_b_id)
          and private.is_deal_identity_consistent(
            d.listing_id,
            d.accepted_offer_id,
            d.offered_listing_id,
            d.party_a_id,
            d.party_b_id
          )
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

create or replace function public.validate_deal_dispute_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'deal'
     and new.reason_code = 'deal_dispute'
     and not exists (
       select 1
       from public.deals d
       where d.id = new.target_id
         and d.status = 'disputed'
         and new.reporter_id in (d.party_a_id, d.party_b_id)
         and private.is_deal_identity_consistent(
           d.listing_id,
           d.accepted_offer_id,
           d.offered_listing_id,
           d.party_a_id,
           d.party_b_id
         )
     )
  then
    raise exception 'deal disputes require the atomic dispute workflow'
      using errcode = '42501';
  end if;
  return new;
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

    update public.deals d
    set status = 'disputed'
    where d.status = 'pending_confirmation'
      and target_profile_id in (d.party_a_id, d.party_b_id)
      and private.is_deal_identity_consistent(
        d.listing_id,
        d.accepted_offer_id,
        d.offered_listing_id,
        d.party_a_id,
        d.party_b_id
      );

    update public.conversations c
    set status = 'blocked'
    where exists (
      select 1 from public.deals d
      where d.accepted_offer_id = c.accepted_offer_id
        and target_profile_id in (d.party_a_id, d.party_b_id)
        and private.is_deal_identity_consistent(
          d.listing_id,
          d.accepted_offer_id,
          d.offered_listing_id,
          d.party_a_id,
          d.party_b_id
        )
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

create or replace function private.reconcile_legacy_deal_notifications()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notifications n
  set title = 'Продавачът приключва сделката',
      body = 'Сделката вече се отбелязва като приключена от продавача. Отворете я за актуален статус.',
      status = 'archived',
      read_at = coalesce(n.read_at, statement_timestamp()),
      data = (coalesce(n.data, '{}'::jsonb) - 'confirmedBy')
        || jsonb_build_object('lifecycle', 'seller_completion')
  where n.kind = 'deal_confirmation_needed';

  delete from public.notification_email_deliveries d
  using public.notifications n
  where d.notification_id = n.id
    and n.kind = 'deal_confirmation_needed'
    and d.status <> 'sent';
end;
$$;

revoke execute on function private.reconcile_legacy_deal_notifications()
  from public, anon, authenticated, service_role;

select private.reconcile_legacy_deal_notifications();

revoke execute on function public.open_deal_dispute(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.open_deal_dispute(uuid, text) to authenticated;
revoke execute on function public.resolve_deal_dispute(uuid, uuid, public.deal_status, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_deal_dispute(uuid, uuid, public.deal_status, text)
  to authenticated;
revoke execute on function public.moderate_profile(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.moderate_profile(uuid, uuid, boolean, text)
  to authenticated;
revoke execute on function public.validate_report_insert()
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_deal_dispute_report()
  from public, anon, authenticated, service_role;
