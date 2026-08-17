begin;

-- Preserve pending and legacy rows with no city while enforcing the shape on
-- every new or changed non-null value. The active-access predicate below is the
-- fail-closed boundary for any pre-existing invalid row.
alter table public.profiles
  add constraint profiles_city_shape
  check (city is null or char_length(btrim(city)) between 2 and 100)
  not valid;

create or replace function private.is_active_beta_user(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user_id is not null
    and exists (
      select 1
      from public.profiles p
      join public.beta_memberships m on m.profile_id = p.id
      where p.id = check_user_id
        and not p.is_suspended
        and p.email_verified_at is not null
        and p.city is not null
        and char_length(btrim(p.city)) between 2 and 100
        and m.status = 'active'
        and m.onboarding_completed_at is not null
        and m.activated_at <= now()
        and (m.expires_at is null or m.expires_at > now())
        and not exists (
          select 1
          from public.beta_legal_documents d
          where d.required_for_access
            and d.effective_at <= now()
            and d.retired_at is null
            and not exists (
              select 1
              from public.beta_consent_events c
              where c.profile_id = check_user_id
                and c.document_code = d.document_code
                and c.document_version = d.document_version
            )
        )
    );
$$;

create or replace function public.complete_beta_onboarding(
  desired_username text,
  home_city text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  membership_record public.beta_memberships%rowtype;
  normalized_username text := btrim(coalesce(desired_username, ''));
  normalized_city text := btrim(coalesce(home_city, ''));
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_username !~ '^[[:alnum:]_.-]{3,40}$' then
    raise exception 'username must contain 3 to 40 letters, digits or ._-'
      using errcode = '22023';
  end if;
  if char_length(normalized_city) not between 2 and 100 then
    raise exception 'city must contain 2 to 100 characters' using errcode = '22023';
  end if;

  select * into membership_record
  from public.beta_memberships m
  where m.profile_id = requesting_user
  for update;
  if not found or membership_record.status not in ('pending', 'active') then
    raise exception 'pending beta onboarding was not found' using errcode = '42501';
  end if;
  if membership_record.status = 'active'
     and membership_record.onboarding_completed_at is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = requesting_user
         and p.city is not null
         and char_length(btrim(p.city)) between 2 and 100
     )
  then
    return jsonb_build_object(
      'profileId', requesting_user,
      'username', (select p.username::text from public.profiles p where p.id = requesting_user),
      'onboardingCompletedAt', membership_record.onboarding_completed_at,
      'isActive', private.is_active_beta_user(requesting_user)
    );
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = requesting_user and p.email_verified_at is not null and not p.is_suspended
  ) then
    raise exception 'a confirmed email and active profile are required'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.beta_legal_documents d
    where d.required_for_access
      and d.effective_at <= statement_timestamp()
      and d.retired_at is null
      and not exists (
        select 1 from public.beta_consent_events c
        where c.profile_id = requesting_user
          and c.document_code = d.document_code
          and c.document_version = d.document_version
      )
  ) then
    raise exception 'all current required beta documents must be accepted'
      using errcode = '42501';
  end if;

  update public.beta_memberships
  set status = 'active'
  where profile_id = requesting_user;

  update public.profiles
  set username = normalized_username,
      city = normalized_city
  where id = requesting_user;

  select * into membership_record
  from public.beta_memberships m where m.profile_id = requesting_user;
  return jsonb_build_object(
    'profileId', requesting_user,
    'username', normalized_username,
    'onboardingCompletedAt', membership_record.onboarding_completed_at,
    'isActive', true
  );
exception when unique_violation then
  raise exception 'username is already in use' using errcode = '23505';
end;
$$;

revoke execute on function private.is_active_beta_user(uuid) from public, anon;
grant execute on function private.is_active_beta_user(uuid) to authenticated, service_role;
revoke execute on function public.complete_beta_onboarding(text, text) from public, anon;
grant execute on function public.complete_beta_onboarding(text, text) to authenticated;

comment on function public.is_active_beta_user() is
  'Canonical access gate: verified, unsuspended, onboarded, valid city, unexpired and current on required consents.';

commit;
