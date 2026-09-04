begin;

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

  -- Serialize claims for this auth identity so a concurrent second attempt
  -- reaches the same fail-closed membership check instead of a unique error.
  perform 1
  from auth.users u
  where u.id = requesting_user
  for update;
  if not found then
    raise exception 'open registration requires a directly confirmed email/password account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = requesting_user
  ) then
    raise exception 'profile is not ready' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.beta_memberships m
    where m.profile_id = requesting_user
  ) then
    raise exception 'open registration is no longer available for this account'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from auth.users u
    where u.id = requesting_user
      and coalesce(u.raw_user_meta_data, '{}'::jsonb) ?| array[
        'role', 'platform_role', 'is_staff', 'is_admin'
      ]
  ) then
    raise exception 'open registration metadata is not eligible'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = requesting_user
      and u.invited_at is null
      and nullif(u.encrypted_password, '') is not null
      and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'email'
      and u.confirmation_sent_at is not null
      and u.email_confirmed_at is not null
      and u.email_confirmed_at >= u.confirmation_sent_at
  ) then
    raise exception 'open registration requires a directly confirmed email/password account'
      using errcode = '42501';
  end if;

  insert into public.beta_memberships (profile_id, invite_id, status)
  values (requesting_user, null, 'pending');
  return true;
end;
$$;

revoke all on function public.claim_open_registration()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_open_registration() to authenticated;

comment on function public.claim_open_registration() is
  'One-time self-only admission claim for a directly confirmed, non-invited email/password account.';

commit;
