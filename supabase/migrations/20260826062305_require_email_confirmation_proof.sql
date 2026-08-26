begin;

-- Fail closed if hosted Auth configuration drifts into autoconfirm. A genuine
-- email/password signup must have both a sent confirmation challenge and a
-- later provider-recorded confirmation before it can claim membership.
create or replace function public.claim_open_registration()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = requesting_user
  ) then
    raise exception 'profile is not ready' using errcode = '42501';
  end if;

  -- Existing invite-era members must keep signing in normally. Restrict only
  -- creation of a new invite-free admission record.
  if exists (
    select 1
    from public.beta_memberships m
    where m.profile_id = requesting_user
  ) then
    return true;
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = requesting_user
      and u.invited_at is null
      and nullif(u.encrypted_password, '') is not null
      and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'email'
  ) then
    raise exception 'open registration requires a direct email/password account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = requesting_user
      and u.confirmation_sent_at is not null
      and u.email_confirmed_at is not null
      and u.email_confirmed_at >= u.confirmation_sent_at
  ) then
    raise exception 'open registration requires completed email confirmation'
      using errcode = '42501';
  end if;

  insert into public.beta_memberships (profile_id, invite_id, status)
  values (requesting_user, null, 'pending')
  on conflict (profile_id) do nothing;
  return true;
end;
$$;

revoke execute on function public.claim_open_registration() from public, anon;
grant execute on function public.claim_open_registration() to authenticated;

commit;
