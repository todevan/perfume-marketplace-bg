begin;

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
  where id in (deal_record.listing_id, deal_record.offered_listing_id)
    and status = 'reserved';

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
    update public.listings
    set status = moderated_status,
        completed_at = null
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

revoke execute on function public.complete_deal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_deal(uuid) to authenticated;
revoke execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status)
  from public, anon, authenticated, service_role;
grant execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) to authenticated;

commit;