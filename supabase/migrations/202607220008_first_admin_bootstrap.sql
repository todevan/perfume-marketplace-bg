begin;

-- The first administrator cannot use the normal invitation RPC because that
-- RPC correctly requires an already-active administrator. This private,
-- singleton bootstrap record closes that one-time operational gap without
-- weakening the normal invitation path.
create table private.first_admin_bootstrap (
  singleton boolean primary key default true check (singleton),
  environment_name text not null
    check (environment_name = 'database'),
  requested_email extensions.citext not null,
  prepared_request_id uuid not null unique,
  provenance jsonb not null,
  prepared_at timestamptz not null default statement_timestamp(),
  bound_profile_id uuid unique references public.profiles(id) on delete restrict,
  bound_invite_id uuid unique references public.beta_invites(id) on delete restrict,
  bound_request_id uuid unique,
  bound_at timestamptz,
  constraint first_admin_bootstrap_email_shape check (
    requested_email::text = lower(btrim(requested_email::text))
    and requested_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and char_length(requested_email::text) <= 320
  ),
  constraint first_admin_bootstrap_provenance_shape check (
    provenance ->> 'source' = 'trusted_operator_script'
    and provenance ->> 'environment' = environment_name
    and provenance ->> 'initialRequestId' = prepared_request_id::text
  ),
  constraint first_admin_bootstrap_bound_shape check (
    (
      bound_profile_id is null
      and bound_invite_id is null
      and bound_request_id is null
      and bound_at is null
    )
    or (
      bound_profile_id is not null
      and bound_invite_id is not null
      and bound_request_id is not null
      and bound_at is not null
    )
  )
);

create table private.first_admin_bootstrap_attempts (
  id uuid primary key default gen_random_uuid(),
  bootstrap_singleton boolean not null default true
    references private.first_admin_bootstrap(singleton) on delete restrict,
  invite_id uuid not null unique
    references public.beta_invites(id) on delete restrict,
  request_id uuid not null unique,
  provenance jsonb not null,
  prepared_at timestamptz not null default statement_timestamp(),
  constraint first_admin_bootstrap_attempt_singleton check (bootstrap_singleton),
  constraint first_admin_bootstrap_attempt_provenance_shape check (
    provenance ->> 'source' = 'trusted_operator_script'
    and provenance ->> 'requestId' = request_id::text
  )
);

comment on table private.first_admin_bootstrap is
  'Immutable singleton provenance for the one first-administrator bootstrap allowed in this database environment.';
comment on table private.first_admin_bootstrap_attempts is
  'Append-only delivery-attempt provenance. Raw invitation material is never stored; only the beta invite hash record is referenced.';

create or replace function private.protect_first_admin_bootstrap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'first administrator bootstrap provenance cannot be deleted'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.singleton := true;
    new.prepared_at := statement_timestamp();
    if new.bound_profile_id is not null
       or new.bound_invite_id is not null
       or new.bound_request_id is not null
       or new.bound_at is not null
    then
      raise exception 'a first administrator bootstrap must begin unbound'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.singleton is distinct from old.singleton
     or new.environment_name is distinct from old.environment_name
     or new.requested_email is distinct from old.requested_email
     or new.prepared_request_id is distinct from old.prepared_request_id
     or new.provenance is distinct from old.provenance
     or new.prepared_at is distinct from old.prepared_at
  then
    raise exception 'first administrator bootstrap provenance is immutable'
      using errcode = '42501';
  end if;

  if old.bound_profile_id is not null then
    if new is distinct from old then
      raise exception 'a bound first administrator bootstrap is terminal'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.bound_profile_id is null
     or new.bound_invite_id is null
     or new.bound_request_id is null
  then
    raise exception 'only a complete first administrator binding is allowed'
      using errcode = '23514';
  end if;

  new.bound_at := statement_timestamp();
  return new;
end;
$$;

create trigger protect_first_admin_bootstrap
before insert or update or delete on private.first_admin_bootstrap
for each row execute function private.protect_first_admin_bootstrap();

create trigger first_admin_bootstrap_attempts_append_only
before update or delete on private.first_admin_bootstrap_attempts
for each row execute function public.reject_append_only_mutation();

-- Preparation creates a deliberately non-redeemable beta invite marker. Its
-- token_hash is 256 random bits and no corresponding raw token ever exists.
-- The trusted operator script sends the Supabase Auth invitation and then uses
-- bind_first_admin_invite() to associate the authoritative Auth user.
create or replace function public.prepare_first_admin_invite(
  bootstrap_email text,
  valid_for interval default interval '7 days'
)
returns table (
  bootstrap_invite_id uuid,
  bootstrap_invite_expires_at timestamptz,
  bootstrap_attempt_reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email extensions.citext :=
    lower(btrim(coalesce(bootstrap_email, '')))::extensions.citext;
  bootstrap_request_id uuid := extensions.gen_random_uuid();
  bootstrap_record private.first_admin_bootstrap%rowtype;
  existing_attempt record;
  created_invite_id uuid;
  target_expiry timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required for first administrator preparation'
      using errcode = '42501';
  end if;
  if normalized_email::text !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or char_length(normalized_email::text) > 320
  then
    raise exception 'a valid bootstrap email is required' using errcode = '22023';
  end if;
  if valid_for is null
     or valid_for <= interval '0 seconds'
     or valid_for > interval '30 days'
  then
    raise exception 'bootstrap invite validity must be between zero and 30 days'
      using errcode = '23514';
  end if;

  -- The advisory lock serializes the first insert before a singleton row exists;
  -- the row lock below serializes every subsequent prepare/bind transition.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('private.first_admin_bootstrap', 0)
  );

  select *
  into bootstrap_record
  from private.first_admin_bootstrap
  where singleton
  for update;

  if not found then
    if exists (select 1 from public.profiles p where p.role = 'admin') then
      raise exception 'an administrator already exists; bootstrap is unavailable'
        using errcode = '23505';
    end if;

    insert into private.first_admin_bootstrap (
      singleton,
      environment_name,
      requested_email,
      prepared_request_id,
      provenance
    ) values (
      true,
      'database',
      normalized_email,
      bootstrap_request_id,
      jsonb_build_object(
        'source', 'trusted_operator_script',
        'environment', 'database',
        'initialRequestId', bootstrap_request_id::text
      )
    )
    returning * into bootstrap_record;
  elsif bootstrap_record.requested_email <> normalized_email then
    raise exception 'this database is already reserved for a different bootstrap identity'
      using errcode = '23505';
  end if;

  if bootstrap_record.bound_profile_id is not null then
    raise exception 'the first administrator bootstrap is already bound'
      using errcode = '23505';
  end if;

  select
    a.invite_id,
    i.expires_at,
    i.status
  into existing_attempt
  from private.first_admin_bootstrap_attempts a
  join public.beta_invites i on i.id = a.invite_id
  where a.bootstrap_singleton
    and i.status = 'pending'
    and i.expires_at > statement_timestamp()
  order by a.prepared_at desc
  limit 1;

  if found then
    return query select
      existing_attempt.invite_id,
      existing_attempt.expires_at,
      true;
    return;
  end if;

  -- A stale pending marker may be safely expired before a new immutable attempt
  -- is appended. Accepted attempts are terminal and can only be bound.
  update public.beta_invites i
  set status = 'expired'
  from private.first_admin_bootstrap_attempts a
  where a.bootstrap_singleton
    and a.invite_id = i.id
    and i.status = 'pending'
    and i.expires_at <= statement_timestamp();

  if exists (
    select 1
    from private.first_admin_bootstrap_attempts a
    join public.beta_invites i on i.id = a.invite_id
    where a.bootstrap_singleton
      and i.status in ('pending', 'accepted')
  ) then
    raise exception 'an active first administrator bootstrap attempt already exists'
      using errcode = '23505';
  end if;

  target_expiry := statement_timestamp() + valid_for;
  insert into public.beta_invites (
    email,
    token_hash,
    expires_at,
    created_by
  ) values (
    normalized_email,
    encode(extensions.gen_random_bytes(32), 'hex'),
    target_expiry,
    null
  )
  returning id into created_invite_id;

  insert into private.first_admin_bootstrap_attempts (
    bootstrap_singleton,
    invite_id,
    request_id,
    provenance
  ) values (
    true,
    created_invite_id,
    bootstrap_request_id,
    jsonb_build_object(
      'source', 'trusted_operator_script',
      'environment', 'database',
      'requestId', bootstrap_request_id::text
    )
  );

  return query select created_invite_id, target_expiry, false;
end;
$$;

-- Binding is service-side and tokenless. It verifies that Supabase Auth created
-- exactly one invited user for the reserved email, then creates only a pending
-- beta membership. Email confirmation, every required legal acknowledgement,
-- onboarding and MFA remain mandatory before the role is effective.
create or replace function public.bind_first_admin_invite(
  target_invite_id uuid,
  target_user_id uuid
)
returns table (
  bootstrap_profile_id uuid,
  bootstrap_invite_id uuid,
  bootstrap_already_bound boolean,
  bootstrap_email_confirmed boolean,
  bootstrap_onboarding_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_record private.first_admin_bootstrap%rowtype;
  target_request_id uuid;
  target_email_confirmed_at timestamptz;
  target_invited_at timestamptz;
  target_profile_role public.platform_role;
  target_profile_suspended boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required for first administrator binding'
      using errcode = '42501';
  end if;
  if target_invite_id is null or target_user_id is null then
    raise exception 'bootstrap invite id and Auth user id are required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('private.first_admin_bootstrap', 0)
  );

  select *
  into bootstrap_record
  from private.first_admin_bootstrap
  where singleton
  for update;

  if not found then
    raise exception 'first administrator bootstrap identity was not prepared'
      using errcode = 'P0002';
  end if;

  if bootstrap_record.bound_profile_id is not null then
    if bootstrap_record.bound_invite_id is distinct from target_invite_id
       or bootstrap_record.bound_profile_id is distinct from target_user_id
    then
      raise exception 'bootstrap is already bound to a different invite or Auth user'
        using errcode = '23505';
    end if;

    select
      u.email_confirmed_at
    into target_email_confirmed_at
    from auth.users u
    where u.id = target_user_id
      and lower(btrim(u.email))::extensions.citext =
        bootstrap_record.requested_email;
    if not found then
      raise exception 'bound bootstrap Auth identity no longer matches its provenance'
        using errcode = '42501';
    end if;

    return query select
      bootstrap_record.bound_profile_id,
      bootstrap_record.bound_invite_id,
      true,
      target_email_confirmed_at is not null,
      not private.is_active_beta_user(bootstrap_record.bound_profile_id);
    return;
  end if;

  select a.request_id
  into target_request_id
  from private.first_admin_bootstrap_attempts a
  join public.beta_invites i on i.id = a.invite_id
  where a.bootstrap_singleton
    and a.invite_id = target_invite_id
    and i.status = 'pending'
    and i.expires_at > statement_timestamp()
    and i.email = bootstrap_record.requested_email
  for update of i;

  if not found then
    raise exception 'an active bootstrap invite was not found'
      using errcode = 'P0002';
  end if;

  select u.email_confirmed_at, u.invited_at
  into target_email_confirmed_at, target_invited_at
  from auth.users u
  where u.id = target_user_id
    and lower(btrim(u.email))::extensions.citext =
      bootstrap_record.requested_email;

  if not found or target_invited_at is null then
    raise exception 'the matching Auth user was not created by an invitation'
      using errcode = '42501';
  end if;

  select p.role, p.is_suspended
  into target_profile_role, target_profile_suspended
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found or target_profile_suspended or target_profile_role <> 'user' then
    raise exception 'the invited bootstrap profile is not eligible for binding'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.role = 'admin' and p.id <> target_user_id
  ) then
    raise exception 'another administrator already exists; bootstrap is unavailable'
      using errcode = '23505';
  end if;

  update public.beta_invites
  set status = 'accepted',
      accepted_by = target_user_id
  where id = target_invite_id
    and status = 'pending';
  if not found then
    raise exception 'bootstrap invite changed during binding'
      using errcode = '40001';
  end if;

  insert into public.beta_memberships (
    profile_id,
    invite_id,
    status
  ) values (
    target_user_id,
    target_invite_id,
    'pending'
  );

  update public.profiles
  set role = 'admin'
  where id = target_user_id;

  update private.first_admin_bootstrap
  set bound_profile_id = target_user_id,
      bound_invite_id = target_invite_id,
      bound_request_id = target_request_id,
      bound_at = statement_timestamp()
  where singleton;

  return query select
    target_user_id,
    target_invite_id,
    false,
    target_email_confirmed_at is not null,
    true;
end;
$$;

revoke all on private.first_admin_bootstrap
  from public, anon, authenticated, service_role;
revoke all on private.first_admin_bootstrap_attempts
  from public, anon, authenticated, service_role;

revoke execute on function private.protect_first_admin_bootstrap()
  from public, anon, authenticated, service_role;
revoke execute on function public.prepare_first_admin_invite(text, interval)
  from public, anon, authenticated;
revoke execute on function public.bind_first_admin_invite(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.prepare_first_admin_invite(text, interval)
  to service_role;
grant execute on function public.bind_first_admin_invite(uuid, uuid)
  to service_role;

comment on function public.prepare_first_admin_invite(text, interval) is
  'Service-role-only, concurrency-safe preparation for the sole first administrator. Returns no raw token.';
comment on function public.bind_first_admin_invite(uuid, uuid) is
  'Idempotently binds the prepared bootstrap to the authoritative invited Auth user without accepting legal documents or activating membership.';

commit;
