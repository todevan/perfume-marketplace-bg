create or replace function private.lock_profile_lifecycle(
  first_profile_id uuid,
  second_profile_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_profile_id uuid;
begin
  for locked_profile_id in
    select distinct candidate.profile_id
    from unnest(array[first_profile_id, second_profile_id]) as candidate(profile_id)
    where candidate.profile_id is not null
    order by candidate.profile_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'aromatika:profile-lifecycle:' || locked_profile_id::text,
        0
      )
    );
  end loop;
end;
$$;

revoke execute on function private.lock_profile_lifecycle(uuid, uuid)
  from public, anon, authenticated, service_role;

drop policy if exists listings_public_read on public.listings;
create policy listings_public_read on public.listings
for select to authenticated
using (
  (
    public.is_active_beta_user()
    and status in ('active', 'reserved', 'completed')
    and private.is_active_beta_user(seller_id)
  )
  or seller_id = auth.uid()
  or public.is_staff()
  or (
    public.is_active_beta_user()
    and exists (
      select 1
      from public.deals d
      where (d.listing_id = listings.id or d.offered_listing_id = listings.id)
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

  perform private.lock_profile_lifecycle(target_profile_id, null);

  perform d.id
  from public.deals d
  where d.status = 'pending_confirmation'
    and target_profile_id in (d.party_a_id, d.party_b_id)
    and private.is_deal_identity_consistent(
      d.listing_id,
      d.accepted_offer_id,
      d.offered_listing_id,
      d.party_a_id,
      d.party_b_id
    )
  order by d.id
  for update;

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

revoke execute on function public.complete_deal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_deal(uuid) to authenticated;
revoke execute on function public.moderate_profile(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.moderate_profile(uuid, uuid, boolean, text)
  to authenticated;
