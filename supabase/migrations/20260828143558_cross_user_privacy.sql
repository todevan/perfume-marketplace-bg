begin;

create or replace function public.is_conversation_member(
  target_conversation_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.profile_id = target_profile_id
      and cm.blocked_at is null
  )
  and private.is_active_beta_user(target_profile_id)
  and (target_profile_id = auth.uid() or public.is_staff());
$$;

revoke execute on function public.is_conversation_member(uuid, uuid)
  from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid)
  to authenticated;

alter policy offers_participant_read on public.offers
using (
  (
    public.is_active_beta_user()
    and (
      offerer_id = auth.uid()
      or exists (
        select 1
        from public.listings l
        where l.id = listing_id and l.seller_id = auth.uid()
      )
    )
    and (
      offers.status <> 'accepted'
      or exists (
        select 1
        from public.conversations c
        where c.accepted_offer_id = offers.id
          and public.is_conversation_member(c.id)
      )
    )
  )
  or public.is_staff()
);

alter policy deals_participant_read on public.deals
using (
  (
    public.is_active_beta_user()
    and auth.uid() in (party_a_id, party_b_id)
    and exists (
      select 1
      from public.conversations c
      where c.accepted_offer_id = deals.accepted_offer_id
        and public.is_conversation_member(c.id)
    )
  )
  or public.is_staff()
);

create or replace function public.accept_offer(target_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_beta_user();
  if not exists (
    select 1
    from public.offers o
    join public.listings l on l.id = o.listing_id
    where o.id = target_offer_id
      and l.seller_id = auth.uid()
  ) then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;
  return public.accept_offer_foundation(target_offer_id);
end;
$$;

create or replace function public.decline_offer(target_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_beta_user();
  if not exists (
    select 1
    from public.offers o
    join public.listings l on l.id = o.listing_id
    where o.id = target_offer_id
      and l.seller_id = auth.uid()
  ) then
    raise exception 'pending offer not found' using errcode = 'P0002';
  end if;
  perform public.decline_offer_foundation(target_offer_id);
end;
$$;

revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.decline_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;

commit;
