begin;

-- Hosted Supabase projects can carry a direct anon grant through platform
-- defaults even after PUBLIC is revoked. Keep the closed-beta profile surface
-- available only to authenticated beta members and trusted server operations.
revoke all on public.public_profiles from public, anon;
grant select on public.public_profiles to authenticated, service_role;

commit;
