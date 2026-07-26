begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
revoke usage on schema extensions from anon;
grant usage on schema extensions to authenticated, service_role;

-- Closed-beta identity is deliberately separate from auth.users.  Creating an
-- auth account does not grant marketplace access: a one-use invite, verified
-- email, current legal acknowledgements and completed onboarding are all
-- required by is_active_beta_user().

create type public.beta_invite_status as enum (
  'pending', 'accepted', 'revoked', 'expired'
);

create type public.beta_membership_status as enum (
  'pending', 'active', 'suspended', 'revoked', 'expired'
);

create table public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  token_hash text not null unique,
  status public.beta_invite_status not null default 'pending',
  created_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint beta_invite_email_shape check (
    email::text = lower(btrim(email::text))
    and email::text ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and char_length(email::text) <= 320
  ),
  constraint beta_invite_token_hash_shape check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint beta_invite_expiry_shape check (expires_at > created_at),
  constraint beta_invite_acceptance_shape check (
    (status = 'accepted') = (accepted_at is not null and accepted_by is not null)
  ),
  constraint beta_invite_revocation_shape check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create unique index beta_invites_one_pending_email_idx
  on public.beta_invites (email)
  where status = 'pending';
create index beta_invites_expiry_idx
  on public.beta_invites (expires_at)
  where status = 'pending';

create table public.beta_memberships (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  invite_id uuid not null unique references public.beta_invites(id) on delete restrict,
  status public.beta_membership_status not null default 'pending',
  onboarding_completed_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_membership_window check (
    expires_at is null or expires_at > created_at
  ),
  constraint beta_membership_state_shape check (
    (
      status = 'pending'
      and onboarding_completed_at is null
      and activated_at is null
      and ended_at is null
    )
    or (
      status in ('active', 'suspended')
      and onboarding_completed_at is not null
      and activated_at is not null
      and ended_at is null
    )
    or (
      status in ('revoked', 'expired')
      and ended_at is not null
    )
  )
);

create index beta_memberships_status_expiry_idx
  on public.beta_memberships (status, expires_at);

-- A new active version is inserted; the superseded version is retired instead
-- of being overwritten.  This keeps every accepted document version provable.
create table public.beta_legal_documents (
  document_code text not null,
  document_version text not null,
  required_for_access boolean not null default true,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (document_code, document_version),
  constraint beta_legal_document_code_shape check (
    document_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint beta_legal_document_version_shape check (
    char_length(btrim(document_version)) between 1 and 80
  ),
  constraint beta_legal_document_window check (
    retired_at is null or retired_at > effective_at
  )
);

create unique index beta_legal_documents_one_current_idx
  on public.beta_legal_documents (document_code)
  where retired_at is null;

create table public.beta_consent_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  document_code text not null,
  document_version text not null,
  accepted_at timestamptz not null default now(),
  source text not null default 'web' check (source in ('web', 'admin_import')),
  foreign key (document_code, document_version)
    references public.beta_legal_documents (document_code, document_version)
    on delete restrict,
  unique (profile_id, document_code, document_version)
);

create index beta_consent_events_profile_idx
  on public.beta_consent_events (profile_id, accepted_at desc);

-- No raw email address or telephone number is copied into this audit stream.
-- The subject UUID remains as a pseudonymous audit key if an auth identity is
-- later removed.
create table public.beta_auth_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  event_type text not null default 'verification_synced'
    check (event_type = 'verification_synced'),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  occurred_at timestamptz not null default now()
);

create index beta_auth_events_profile_idx
  on public.beta_auth_events (profile_id, occurred_at desc);

insert into public.beta_legal_documents (
  document_code, document_version, required_for_access, effective_at
)
values
  ('beta_terms', '2026-07-22', true, timestamptz '2026-07-22 00:00:00+03'),
  ('privacy_notice', '2026-07-22', true, timestamptz '2026-07-22 00:00:00+03'),
  ('marketplace_rules', '2026-07-22', true, timestamptz '2026-07-22 00:00:00+03'),
  ('age_18_confirmation', '2026-07-22', true, timestamptz '2026-07-22 00:00:00+03')
on conflict do nothing;

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger beta_consent_events_append_only
before update or delete on public.beta_consent_events
for each row execute function public.reject_append_only_mutation();

create trigger beta_auth_events_append_only
before update or delete on public.beta_auth_events
for each row execute function public.reject_append_only_mutation();

create or replace function public.protect_beta_invite_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email::text))::extensions.citext;
    new.created_at := statement_timestamp();
    if new.status <> 'pending'
       or new.accepted_by is not null
       or new.accepted_at is not null
       or new.revoked_at is not null
    then
      raise exception 'new beta invites must start pending' using errcode = '23514';
    end if;
    if new.expires_at <= statement_timestamp()
       or new.expires_at > statement_timestamp() + interval '30 days'
    then
      raise exception 'beta invite expiry must be within the next 30 days'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'beta invite identity is immutable' using errcode = '23514';
  end if;

  if old.status <> 'pending' and new is distinct from old then
    raise exception 'accepted, revoked and expired invites are terminal'
      using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('accepted', 'revoked', 'expired')
  then
    raise exception 'invalid beta invite transition' using errcode = '23514';
  end if;

  if new.status = 'accepted' then
    new.accepted_at := statement_timestamp();
    if new.accepted_by is null then
      raise exception 'accepted beta invites require a profile' using errcode = '23514';
    end if;
  elsif new.status = 'revoked' then
    new.revoked_at := statement_timestamp();
    new.accepted_by := null;
    new.accepted_at := null;
  elsif new.status = 'expired' then
    new.accepted_by := null;
    new.accepted_at := null;
    new.revoked_at := null;
  else
    new.accepted_by := null;
    new.accepted_at := null;
    new.revoked_at := null;
  end if;
  return new;
end;
$$;

create trigger protect_beta_invite_workflow
before insert or update on public.beta_invites
for each row execute function public.protect_beta_invite_workflow();

create or replace function public.protect_beta_membership_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
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

create trigger protect_beta_membership_workflow
before insert or update on public.beta_memberships
for each row execute function public.protect_beta_membership_workflow();

alter table public.profiles
  add column email_verified_at timestamptz;

update public.profiles p
set email_verified_at = u.email_confirmed_at,
    phone_verified_at = case
      when nullif(btrim(coalesce(u.phone, '')), '') is null then null
      else u.phone_confirmed_at
    end
from auth.users u
where u.id = p.id
  and row(p.email_verified_at, p.phone_verified_at) is distinct from row(
    u.email_confirmed_at,
    case
      when nullif(btrim(coalesce(u.phone, '')), '') is null then null
      else u.phone_confirmed_at
    end
  );

create or replace function public.sync_auth_user_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  synced_email_at timestamptz := new.email_confirmed_at;
  synced_phone_at timestamptz := case
    when nullif(btrim(coalesce(new.phone, '')), '') is null then null
    else new.phone_confirmed_at
  end;
  previous_email_at timestamptz;
  previous_phone_at timestamptz;
begin
  select p.email_verified_at, p.phone_verified_at
  into previous_email_at, previous_phone_at
  from public.profiles p
  where p.id = new.id;

  update public.profiles
  set email_verified_at = synced_email_at,
      phone_verified_at = synced_phone_at
  where id = new.id
    and row(email_verified_at, phone_verified_at)
      is distinct from row(synced_email_at, synced_phone_at);

  if found then
    insert into public.beta_auth_events (
      profile_id, event_type, email_verified_at, phone_verified_at, occurred_at
    ) values (
      new.id, 'verification_synced', synced_email_at, synced_phone_at,
      statement_timestamp()
    );
  end if;
  return new;
end;
$$;

-- PostgreSQL fires same-kind triggers in name order.  The zz_ prefix ensures
-- the foundation's on_auth_user_created trigger has inserted the profile first.
create trigger zz_sync_auth_user_verification
after insert or update of email_confirmed_at, phone, phone_confirmed_at on auth.users
for each row execute function public.sync_auth_user_verification();

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and pg_trigger_depth() <= 1
     and (
       new.account_kind is distinct from old.account_kind
       or new.role is distinct from old.role
       or new.email_verified_at is distinct from old.email_verified_at
       or new.phone_verified_at is distinct from old.phone_verified_at
       or new.merchant_verified_at is distinct from old.merchant_verified_at
       or new.is_suspended is distinct from old.is_suspended
       or new.rating_average is distinct from old.rating_average
       or new.rating_count is distinct from old.rating_count
       or new.completed_deals_count is distinct from old.completed_deals_count
       or new.created_at is distinct from old.created_at
       or new.last_seen_at is distinct from old.last_seen_at
     )
  then
    raise exception 'privileged profile fields cannot be changed by this user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

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

create or replace function public.is_active_beta_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_beta_user(auth.uid());
$$;

create or replace function private.has_verified_phone(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.phone_verified_at is not null
  );
$$;

create or replace function public.has_verified_phone()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_verified_phone(auth.uid());
$$;

create or replace function public.assert_active_beta_user()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_beta_user(auth.uid()) then
    raise exception 'active beta membership is required' using errcode = '42501';
  end if;
end;
$$;

-- Staff privileges are useful only for a currently admitted beta identity.
-- The service role remains the explicit path for scheduled/system operations.
create or replace function public.is_staff(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    check_user_id = auth.uid()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or pg_trigger_depth() > 0
  ) and private.is_active_beta_user(check_user_id) and exists (
    select 1 from public.profiles p
    where p.id = check_user_id
      and p.role in ('moderator', 'admin')
      and not p.is_suspended
  );
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    check_user_id = auth.uid()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or pg_trigger_depth() > 0
  ) and private.is_active_beta_user(check_user_id) and exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.role = 'admin' and not p.is_suspended
  );
$$;

create or replace function public.create_beta_invite(
  invited_email text,
  invited_by uuid,
  valid_for interval default interval '7 days'
)
returns table (
  invite_id uuid,
  invite_token text,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email extensions.citext;
  raw_token text;
  created_invite_id uuid;
  target_expiry timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required to create beta invites'
      using errcode = '42501';
  end if;
  if invited_by is null or not public.is_admin(invited_by) then
    raise exception 'an active beta administrator must authorize the invite'
      using errcode = '42501';
  end if;
  if valid_for <= interval '0 seconds' or valid_for > interval '30 days' then
    raise exception 'invite validity must be between zero and 30 days'
      using errcode = '23514';
  end if;
  normalized_email := lower(btrim(coalesce(invited_email, '')))::extensions.citext;
  if normalized_email::text !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or char_length(normalized_email::text) > 320
  then
    raise exception 'a valid invite email is required' using errcode = '22023';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  target_expiry := statement_timestamp() + valid_for;
  insert into public.beta_invites (email, token_hash, expires_at, created_by)
  values (
    normalized_email,
    encode(
      extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    target_expiry,
    invited_by
  )
  returning id into created_invite_id;

  return query select created_invite_id, raw_token, target_expiry;
end;
$$;

-- Compensation for an auth-provider delivery failure. The invite row and its
-- token hash remain as durable audit evidence; no raw token is accepted or
-- persisted by this path. Repeating compensation for an already-revoked row is
-- safe, while accepted/expired invitations remain terminal.
create or replace function public.revoke_beta_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_record public.beta_invites%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required to revoke beta invites'
      using errcode = '42501';
  end if;

  select * into invite_record
  from public.beta_invites i
  where i.id = target_invite_id
  for update;
  if not found then
    raise exception 'beta invite was not found' using errcode = 'P0002';
  end if;
  if invite_record.status = 'revoked' then
    return;
  end if;
  if invite_record.status <> 'pending' then
    raise exception 'only a pending beta invite can be revoked'
      using errcode = '23514';
  end if;

  update public.beta_invites
  set status = 'revoked'
  where id = target_invite_id;
end;
$$;

create or replace function public.redeem_beta_invite(invite_token text)
returns public.beta_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  requesting_email extensions.citext;
  email_confirmed_at timestamptz;
  invite_record public.beta_invites%rowtype;
  membership_record public.beta_memberships%rowtype;
  supplied_hash text;
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(coalesce(invite_token, '')) not between 32 and 256 then
    raise exception 'invalid or expired beta invite' using errcode = 'P0002';
  end if;

  select lower(btrim(u.email))::extensions.citext, u.email_confirmed_at
  into requesting_email, email_confirmed_at
  from auth.users u
  where u.id = requesting_user;
  if not found or requesting_email is null or email_confirmed_at is null then
    raise exception 'a confirmed email is required' using errcode = '42501';
  end if;

  supplied_hash := encode(
    extensions.digest(pg_catalog.convert_to(invite_token, 'UTF8'), 'sha256'),
    'hex'
  );
  select * into invite_record
  from public.beta_invites i
  where i.token_hash = supplied_hash
  for update;

  if found and invite_record.status = 'accepted'
     and invite_record.accepted_by = requesting_user
  then
    select * into membership_record
    from public.beta_memberships m
    where m.profile_id = requesting_user and m.invite_id = invite_record.id;
    if found then return membership_record; end if;
  end if;

  if not found
     or invite_record.status <> 'pending'
     or invite_record.expires_at <= statement_timestamp()
     or invite_record.email <> requesting_email
  then
    raise exception 'invalid or expired beta invite' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.beta_memberships m where m.profile_id = requesting_user
  ) then
    raise exception 'this profile already has a beta membership'
      using errcode = '23505';
  end if;

  update public.profiles
  set email_verified_at = email_confirmed_at
  where id = requesting_user;

  update public.beta_invites
  set status = 'accepted', accepted_by = requesting_user
  where id = invite_record.id;

  insert into public.beta_memberships (profile_id, invite_id, status)
  values (requesting_user, invite_record.id, 'pending')
  returning * into membership_record;
  return membership_record;
end;
$$;

create or replace function public.accept_beta_consent(
  requested_document_code text,
  requested_document_version text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  result_timestamp timestamptz;
begin
  if requesting_user is null or not exists (
    select 1 from public.beta_memberships m
    where m.profile_id = requesting_user
      and m.status in ('pending', 'active', 'suspended')
  ) then
    raise exception 'a beta membership is required before accepting documents'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.beta_legal_documents d
    where d.document_code = requested_document_code
      and d.document_version = requested_document_version
      and d.effective_at <= statement_timestamp()
      and d.retired_at is null
  ) then
    raise exception 'document version is not current' using errcode = '23514';
  end if;

  insert into public.beta_consent_events (
    profile_id, document_code, document_version, accepted_at, source
  ) values (
    requesting_user, requested_document_code, requested_document_version,
    statement_timestamp(), 'web'
  )
  on conflict (profile_id, document_code, document_version) do nothing;

  select c.accepted_at into result_timestamp
  from public.beta_consent_events c
  where c.profile_id = requesting_user
    and c.document_code = requested_document_code
    and c.document_version = requested_document_version;
  return result_timestamp;
end;
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
  normalized_city text := nullif(btrim(home_city), '');
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_username !~ '^[[:alnum:]_.-]{3,40}$' then
    raise exception 'username must contain 3 to 40 letters, digits or ._-'
      using errcode = '22023';
  end if;
  if normalized_city is not null and char_length(normalized_city) not between 2 and 100 then
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

  -- Activation is first inside this transaction.  If the unique username update
  -- fails, the membership activation rolls back with it.
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
    -- All gate preconditions were locked and checked above; the transaction
    -- snapshot used by a STABLE predicate may not observe its own activation yet.
    'isActive', true
  );
exception when unique_violation then
  raise exception 'username is already in use' using errcode = '23505';
end;
$$;

create or replace function public.get_my_beta_access()
returns table (
  profile_id uuid,
  membership_status public.beta_membership_status,
  onboarding_completed_at timestamptz,
  membership_expires_at timestamptz,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  merchant_verified_at timestamptz,
  role public.platform_role,
  is_suspended boolean,
  username text,
  account_kind public.account_kind,
  has_current_consents boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return query
  select
    requesting_user,
    m.status,
    m.onboarding_completed_at,
    m.expires_at,
    p.email_verified_at,
    p.phone_verified_at,
    p.merchant_verified_at,
    p.role,
    p.is_suspended,
    p.username::text,
    p.account_kind,
    not exists (
      select 1
      from public.beta_legal_documents d
      where d.required_for_access
        and d.effective_at <= now()
        and d.retired_at is null
        and not exists (
          select 1 from public.beta_consent_events c
          where c.profile_id = requesting_user
            and c.document_code = d.document_code
            and c.document_version = d.document_version
        )
    ),
    private.is_active_beta_user(requesting_user)
  from (select requesting_user as id) u
  left join public.profiles p on p.id = u.id
  left join public.beta_memberships m on m.profile_id = u.id;
end;
$$;

create or replace function private.is_merchant_verified(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.merchant_verified_at is not null
  );
$$;

-- RLS controls rows, not columns.  This is the only table-shaped public
-- profile surface; verification, role and suspension internals remain available
-- through get_my_beta_access() for the current user.
create view public.public_profiles
with (security_barrier = true, security_invoker = true)
as
select
  p.id,
  p.username,
  p.city,
  p.bio,
  p.avatar_path,
  p.account_kind,
  private.is_merchant_verified(p.id) as is_merchant_verified,
  p.rating_average,
  p.rating_count,
  p.completed_deals_count,
  p.created_at as member_since
from public.profiles p
where public.is_active_beta_user()
  and private.is_active_beta_user(p.id);

comment on view public.public_profiles is
  'Safe public profile projection. Email/phone verification timestamps, role, suspension and operational fields are intentionally absent.';

revoke select on public.profiles from anon, authenticated;

-- Column grants are defense in depth for legacy queries that still address the
-- table. RLS hides non-beta/suspended rows and private columns are unselectable.
grant select (
  id, username, city, bio, avatar_path, account_kind,
  rating_average, rating_count, completed_deals_count, created_at
) on public.profiles to authenticated;

revoke all on public.public_profiles from public;
grant select on public.public_profiles to authenticated, service_role;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_safe_read on public.profiles
for select using (
  (
    public.is_active_beta_user()
    and not is_suspended
    and private.is_active_beta_user(id)
  )
  or id = auth.uid()
  or public.is_staff()
);

drop policy if exists listings_public_read on public.listings;
create policy listings_public_read on public.listings
for select to authenticated using (
  (
    public.is_active_beta_user()
    and status in ('active', 'reserved', 'completed')
    and private.is_active_beta_user(seller_id)
  )
  or seller_id = auth.uid()
  or public.is_staff()
  or exists (
    select 1 from public.deals d
    where (d.listing_id = listings.id or d.offered_listing_id = listings.id)
      and auth.uid() in (d.party_a_id, d.party_b_id)
  )
);

alter policy profiles_safe_read on public.profiles to authenticated;

alter policy brands_public_read on public.brands
to authenticated
using (public.is_active_beta_user() and status <> 'rejected');

alter policy aliases_public_read on public.brand_aliases
to authenticated
using (
  public.is_active_beta_user()
  and exists (
    select 1 from public.brands b
    where b.id = brand_id and b.status = 'canonical'
  )
);

alter policy collection_memberships_public_read on public.brand_collection_memberships
to authenticated
using (public.is_active_beta_user());

alter policy fragrances_public_read on public.fragrances
to authenticated
using (
  created_by = auth.uid()
  or public.is_staff()
  or (public.is_active_beta_user() and is_active)
);

alter policy listing_photos_visible_read on public.listing_photos
to authenticated
using (exists (
  select 1 from public.listings l
  where l.id = listing_id
    and (
      l.seller_id = auth.uid()
      or public.is_staff()
      or (
        public.is_active_beta_user()
        and private.is_active_beta_user(l.seller_id)
        and l.status in ('active', 'reserved', 'completed')
        and listing_photos.sanitized_at is not null
      )
    )
));

alter policy authenticity_reviews_visible_read on public.listing_authenticity_reviews
to authenticated
using (
  requested_by = auth.uid()
  or public.is_staff()
  or (
    public.is_active_beta_user()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and private.is_active_beta_user(l.seller_id)
        and l.status in ('active', 'reserved', 'completed')
    )
  )
);

alter policy reviews_public_read on public.reviews
to authenticated
using (
  reviewer_id = auth.uid()
  or reviewee_id = auth.uid()
  or public.is_staff()
  or (public.is_active_beta_user() and status = 'published')
);

alter policy profile_comments_public_read on public.profile_comments
to authenticated
using (
  author_id = auth.uid()
  or public.is_staff()
  or (public.is_active_beta_user() and status = 'published')
);

-- The legal-document bootstrap is the sole anonymous database read surface.
revoke select on
  public.profiles,
  public.brands,
  public.brand_aliases,
  public.brand_collection_memberships,
  public.fragrances,
  public.listings,
  public.listing_photos,
  public.listing_authenticity_reviews,
  public.reviews,
  public.profile_comments
from anon;

-- Direct authenticated DML is caught once at the table boundary.  Security-
-- definer entry points either call assert_active_beta_user() or, for staff
-- workflows, call is_staff()/is_admin(), which include the same predicate.
create or replace function public.require_active_beta_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.is_active_beta_user(auth.uid()) then
    raise exception 'active beta membership is required for marketplace writes'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  guarded_table text;
begin
  foreach guarded_table in array array[
    'profiles', 'merchant_applications', 'brands', 'brand_aliases',
    'brand_collection_memberships', 'fragrances', 'listings', 'listing_photos',
    'listing_authenticity_reviews', 'favorites', 'saved_searches', 'offers',
    'conversations', 'conversation_members', 'messages', 'deals',
    'deal_listing_locks', 'deal_confirmations', 'reviews', 'profile_comments',
    'reports', 'moderation_audit', 'payments', 'payment_events',
    'payment_refunds', 'entitlements', 'notifications', 'catalog_sync_runs'
  ]
  loop
    if pg_catalog.to_regclass('public.' || guarded_table) is not null then
      execute format(
        'create trigger require_active_beta_write before insert or update or delete on public.%I for each row execute function public.require_active_beta_write()',
        guarded_table
      );
    end if;
  end loop;
end;
$$;

-- Preserve the foundation implementations as non-callable internals and place
-- an active-membership assertion in front of each user workflow RPC.
alter function public.accept_offer(uuid) rename to accept_offer_foundation;
alter function public.cancel_deal(uuid, text) rename to cancel_deal_foundation;
alter function public.decline_offer(uuid) rename to decline_offer_foundation;

revoke execute on function public.accept_offer_foundation(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.cancel_deal_foundation(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.decline_offer_foundation(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.accept_offer(target_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_beta_user();
  return public.accept_offer_foundation(target_offer_id);
end;
$$;

create or replace function public.cancel_deal(target_deal_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_beta_user();
  perform public.cancel_deal_foundation(target_deal_id, reason);
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
  perform public.decline_offer_foundation(target_offer_id);
end;
$$;

alter table public.beta_invites enable row level security;
alter table public.beta_memberships enable row level security;
alter table public.beta_legal_documents enable row level security;
alter table public.beta_consent_events enable row level security;
alter table public.beta_auth_events enable row level security;

create policy beta_invites_redeemer_read on public.beta_invites
for select to authenticated using (accepted_by = auth.uid());

create policy beta_memberships_owner_read on public.beta_memberships
for select to authenticated using (profile_id = auth.uid());

create policy beta_legal_documents_public_read on public.beta_legal_documents
for select to anon, authenticated using (
  effective_at <= now() and retired_at is null
);

create policy beta_consent_events_owner_read on public.beta_consent_events
for select to authenticated using (profile_id = auth.uid());

grant select on public.beta_legal_documents to anon, authenticated;
grant select on
  public.beta_invites,
  public.beta_memberships,
  public.beta_consent_events
to authenticated;
grant all on
  public.beta_invites,
  public.beta_memberships,
  public.beta_legal_documents,
  public.beta_consent_events,
  public.beta_auth_events
to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke update, delete, truncate on public.beta_consent_events from service_role;
revoke update, delete, truncate on public.beta_auth_events from service_role;

revoke execute on function public.reject_append_only_mutation()
  from public, anon, authenticated;
revoke execute on function public.protect_beta_invite_workflow()
  from public, anon, authenticated;
revoke execute on function public.protect_beta_membership_workflow()
  from public, anon, authenticated;
revoke execute on function public.sync_auth_user_verification()
  from public, anon, authenticated;
revoke execute on function public.require_active_beta_write()
  from public, anon, authenticated;
revoke execute on function public.assert_active_beta_user()
  from public, anon;
revoke execute on function public.create_beta_invite(text, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.create_beta_invite(text, uuid, interval)
  to service_role;
revoke execute on function public.revoke_beta_invite(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_beta_invite(uuid) to service_role;

revoke execute on function public.redeem_beta_invite(text) from public, anon;
revoke execute on function public.accept_beta_consent(text, text) from public, anon;
revoke execute on function public.complete_beta_onboarding(text, text) from public, anon;
revoke execute on function public.get_my_beta_access() from public, anon;
revoke execute on function public.accept_offer(uuid) from public, anon;
revoke execute on function public.cancel_deal(uuid, text) from public, anon;
revoke execute on function public.decline_offer(uuid) from public, anon;

grant execute on function public.redeem_beta_invite(text) to authenticated;
grant execute on function public.accept_beta_consent(text, text) to authenticated;
grant execute on function public.complete_beta_onboarding(text, text) to authenticated;
grant execute on function public.get_my_beta_access() to authenticated;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.cancel_deal(uuid, text) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;

revoke execute on function private.is_active_beta_user(uuid) from public, anon;
revoke execute on function private.has_verified_phone(uuid) from public, anon;
revoke execute on function private.is_merchant_verified(uuid) from public, anon;
grant execute on function private.is_active_beta_user(uuid) to authenticated, service_role;
grant execute on function private.has_verified_phone(uuid) to authenticated, service_role;
grant execute on function private.is_merchant_verified(uuid) to authenticated, service_role;
revoke execute on function public.is_active_beta_user() from public, anon;
revoke execute on function public.has_verified_phone() from public, anon;
grant execute on function public.is_active_beta_user() to authenticated, service_role;
grant execute on function public.has_verified_phone() to authenticated, service_role;
grant execute on function public.assert_active_beta_user() to authenticated;
revoke execute on function public.is_staff(uuid) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

comment on function public.is_active_beta_user() is
  'Canonical closed-beta write gate: verified, unsuspended, onboarded, unexpired and current on required consents.';
comment on table public.beta_consent_events is
  'Append-only evidence of the exact legal-document version accepted by a beta member.';
comment on table public.beta_auth_events is
  'Append-only verification timestamp sync audit; never contains raw email addresses or phone numbers.';

commit;
