begin;

create or replace function private.normalize_city(value text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select pg_catalog.btrim(value, ' ');
$$;

create or replace function private.is_valid_city(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select normalized_city is not null
    and pg_catalog.char_length(normalized_city) between 2 and 100
    and normalized_city ~ '[[:alnum:]]'
    and normalized_city !~ '[^[:alnum:] ''-]'
  from (
    select private.normalize_city(value) as normalized_city
  ) normalized;
$$;

revoke execute on function private.normalize_city(text) from public, anon;
revoke execute on function private.is_valid_city(text) from public, anon;
grant execute on function private.normalize_city(text) to authenticated, service_role;
grant execute on function private.is_valid_city(text) to authenticated, service_role;

alter table public.profiles
  add constraint profiles_city_shape check (
    city is null or (
      city = private.normalize_city(city)
      and private.is_valid_city(city)
    )
  ) not valid;

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
        and private.is_valid_city(p.city)
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

revoke execute on function private.is_active_beta_user(uuid) from public, anon;
grant execute on function private.is_active_beta_user(uuid) to authenticated, service_role;

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
  normalized_city text := private.normalize_city(home_city);
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_username !~ '^[[:alnum:]_.-]{3,40}$' then
    raise exception 'username must contain 3 to 40 letters, digits or ._-'
      using errcode = '22023';
  end if;
  if not private.is_valid_city(normalized_city) then
    raise exception 'city must contain 2 to 100 letters or digits with spaces, hyphens, or apostrophes'
      using errcode = '22023';
  end if;

  select * into membership_record
  from public.beta_memberships m
  where m.profile_id = requesting_user
  for update;
  if not found or membership_record.status not in ('pending', 'active') then
    raise exception 'pending beta onboarding was not found' using errcode = '42501';
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
  if membership_record.status = 'active'
     and membership_record.onboarding_completed_at is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = requesting_user
         and private.is_valid_city(p.city)
     )
  then
    return jsonb_build_object(
      'profileId', requesting_user,
      'username', (select p.username::text from public.profiles p where p.id = requesting_user),
      'onboardingCompletedAt', membership_record.onboarding_completed_at,
      'isActive', private.is_active_beta_user(requesting_user)
    );
  end if;

  -- Activation and profile repair share one transaction. A username conflict or
  -- any constraint failure rolls the membership transition back with the profile.
  update public.beta_memberships
  set status = 'active'
  where profile_id = requesting_user;

  -- The inherited workflow trigger stamps fresh activations with
  -- statement_timestamp(), while the canonical access predicate intentionally
  -- evaluates against transaction time. Align only a new pending-to-active
  -- transition so this transaction can observe the access it just granted;
  -- do not rewrite timestamps while repairing an existing active membership.
  if membership_record.status = 'pending' then
    update public.beta_memberships
    set activated_at = transaction_timestamp(),
        onboarding_completed_at = transaction_timestamp()
    where profile_id = requesting_user
      and status = 'active';
  end if;

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
    'isActive',
      membership_record.status = 'active'
      and (membership_record.expires_at is null or membership_record.expires_at > now())
      and private.is_active_beta_user(requesting_user)
  );
exception when unique_violation then
  raise exception 'username is already in use' using errcode = '23505';
end;
$$;

revoke execute on function public.complete_beta_onboarding(text, text)
  from public, anon;
grant execute on function public.complete_beta_onboarding(text, text)
  to authenticated;

comment on function private.normalize_city(text) is
  'Removes only surrounding ASCII spaces from onboarding city input.';
comment on function private.is_valid_city(text) is
  'Canonical city predicate: 2-100 characters, at least one alphanumeric, and only alphanumerics, ASCII spaces, hyphens, or apostrophes.';
comment on function public.is_active_beta_user() is
  'Canonical marketplace gate: verified, unsuspended, onboarded with a valid city, unexpired, and current on required consents.';

commit;
