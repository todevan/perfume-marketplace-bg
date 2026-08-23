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

revoke execute on function public.moderate_profile(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.moderate_profile(uuid, uuid, boolean, text)
  to authenticated;
