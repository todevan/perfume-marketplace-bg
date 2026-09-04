begin;

-- Unicode 17.0 General_Category values are intentionally enumerated because
-- PostgreSQL's POSIX regular expressions do not support Unicode property
-- escapes. Invalid input returns null so authorization predicates fail closed;
-- mutating entry points translate that result into SQLSTATE 22023.
create or replace function private.normalize_profile_city(raw_city text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  city_character text;
  code_point integer;
  mapped_city text := '';
  normalized_city text;
begin
  for city_character in
    select parts.city_character
    from pg_catalog.regexp_split_to_table(raw_city, '') as parts(city_character)
  loop
    code_point := pg_catalog.ascii(city_character);

    if code_point between x'0000'::integer and x'001F'::integer
       or code_point between x'007F'::integer and x'009F'::integer
       or code_point = x'00AD'::integer
       or code_point between x'0600'::integer and x'0605'::integer
       or code_point = x'061C'::integer
       or code_point = x'06DD'::integer
       or code_point = x'070F'::integer
       or code_point between x'0890'::integer and x'0891'::integer
       or code_point = x'08E2'::integer
       or code_point = x'180E'::integer
       or code_point between x'200B'::integer and x'200F'::integer
       or code_point between x'202A'::integer and x'202E'::integer
       or code_point between x'2060'::integer and x'2064'::integer
       or code_point between x'2066'::integer and x'206F'::integer
       or code_point = x'FEFF'::integer
       or code_point between x'FFF9'::integer and x'FFFB'::integer
       or code_point = x'110BD'::integer
       or code_point = x'110CD'::integer
       or code_point between x'13430'::integer and x'1343F'::integer
       or code_point between x'1BCA0'::integer and x'1BCA3'::integer
       or code_point between x'1D173'::integer and x'1D17A'::integer
       or code_point = x'E0001'::integer
       or code_point between x'E0020'::integer and x'E007F'::integer
    then
      return null;
    end if;

    if code_point in (
      x'0020'::integer,
      x'00A0'::integer,
      x'1680'::integer,
      x'2000'::integer,
      x'2001'::integer,
      x'2002'::integer,
      x'2003'::integer,
      x'2004'::integer,
      x'2005'::integer,
      x'2006'::integer,
      x'2007'::integer,
      x'2008'::integer,
      x'2009'::integer,
      x'200A'::integer,
      x'202F'::integer,
      x'205F'::integer,
      x'3000'::integer
    ) then
      mapped_city := mapped_city || ' ';
    else
      mapped_city := mapped_city || city_character;
    end if;
  end loop;

  normalized_city := pg_catalog.btrim(
    pg_catalog.regexp_replace(mapped_city, ' +', ' ', 'g')
  );

  if pg_catalog.char_length(normalized_city) not between 2 and 100
     or normalized_city !~ '[[:alnum:]]'
  then
    return null;
  end if;

  return normalized_city;
end;
$$;

revoke all on function private.normalize_profile_city(text)
  from public, anon, authenticated, service_role;

comment on function private.normalize_profile_city(text) is
  'Canonical profile-city normalization using Unicode 17.0 Cc, Cf, and Zs categories; invalid input returns null.';

create or replace function private.enforce_active_profile_city()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_city text;
begin
  if exists (
    select 1
    from public.beta_memberships m
    where m.profile_id = new.id
      and m.status = 'active'
  ) then
    normalized_city := private.normalize_profile_city(new.city);
    if normalized_city is null or new.city is distinct from normalized_city then
      raise exception 'active profiles require a canonical city'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_active_profile_city()
  from public, anon, authenticated, service_role;

create trigger enforce_active_profile_city
before insert or update of city on public.profiles
for each row execute function private.enforce_active_profile_city();

-- Preserve the membership lifecycle and timestamp semantics while adding the
-- same fail-closed city boundary to every transition into active status.
create or replace function public.protect_beta_membership_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_city text;
  normalized_city text;
begin
  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
    new.updated_at := statement_timestamp();
    if new.status <> 'pending'
       or new.onboarding_completed_at is not null
       or new.activated_at is not null
       or new.ended_at is not null
    then
      raise exception 'new beta memberships must start pending'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.invite_id is distinct from old.invite_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'beta membership identity is immutable' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('active', 'revoked', 'expired'))
    or (old.status = 'active' and new.status in ('suspended', 'revoked', 'expired'))
    or (old.status = 'suspended' and new.status in ('active', 'revoked', 'expired'))
  ) then
    raise exception 'invalid or terminal beta membership transition'
      using errcode = '23514';
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    select p.city into stored_city
    from public.profiles p
    where p.id = new.profile_id;
    normalized_city := private.normalize_profile_city(stored_city);
    if normalized_city is null or stored_city is distinct from normalized_city then
      raise exception 'active memberships require a canonical profile city'
        using errcode = '22023';
    end if;
  end if;

  if old.status = 'pending' and new.status = 'active' then
    new.activated_at := statement_timestamp();
    new.onboarding_completed_at := statement_timestamp();
    new.ended_at := null;
  elsif old.status = 'suspended' and new.status = 'active' then
    new.ended_at := null;
  elsif new.status in ('revoked', 'expired') then
    new.ended_at := statement_timestamp();
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke execute on function public.protect_beta_membership_workflow()
  from public, anon, authenticated, service_role;

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
        and p.city = private.normalize_profile_city(p.city)
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
  normalized_city text;
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_username !~ '^[[:alnum:]_.-]{3,40}$' then
    raise exception 'username must contain 3 to 40 letters, digits or ._-'
      using errcode = '22023';
  end if;

  normalized_city := private.normalize_profile_city(home_city);
  if normalized_city is null then
    raise exception 'city must be a normalized value containing 2 to 100 Unicode letters or numbers'
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

  update public.profiles
  set username = normalized_username,
      city = normalized_city
  where id = requesting_user;

  if membership_record.status = 'pending' then
    update public.beta_memberships
    set status = 'active'
    where profile_id = requesting_user;
  end if;

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

comment on function public.complete_beta_onboarding(text, text) is
  'Atomically normalizes the required city, updates the profile, and activates a confirmed, fully consented membership.';

commit;
