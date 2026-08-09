begin;

-- Staff privileges must be bound to the assurance level of the current request.
-- Trusted service-role operations remain the explicit non-user bypass.
create or replace function private.has_staff_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke all on function private.has_staff_mfa()
  from public, anon, authenticated;
grant execute on function private.has_staff_mfa() to service_role;

comment on function private.has_staff_mfa() is
  'Fail-closed current-request assurance gate for staff database privileges; service_role is the trusted system bypass.';

-- Keep the existing identity binding, active-membership, role and suspension
-- predicates. The new central assurance gate applies to every policy and RPC
-- that already depends on is_staff()/is_admin().
create or replace function public.is_staff(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_staff_mfa() and (
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
  select private.has_staff_mfa() and (
    check_user_id = auth.uid()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or pg_trigger_depth() > 0
  ) and private.is_active_beta_user(check_user_id) and exists (
    select 1 from public.profiles p
    where p.id = check_user_id
      and p.role = 'admin'
      and not p.is_suspended
  );
$$;

-- Repeat the effective ACLs as defense in depth. Function signatures are
-- unchanged, so existing policies, triggers and RPC dependencies remain bound.
revoke execute on function public.is_staff(uuid) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

comment on function public.is_staff(uuid) is
  'Returns true for an active unsuspended staff identity only when the current authenticated request is AAL2, or for the trusted service role.';
comment on function public.is_admin(uuid) is
  'Returns true for an active unsuspended administrator only when the current authenticated request is AAL2, or for the trusted service role.';

commit;
