-- Two-session proof that the shared legal activation boundary is sampled only
-- after a contended table lock is acquired, never at the waiter's statement start.

set role postgres;
set search_path = public, extensions, pg_catalog;

create temp table legal_activation_dblink_extension_state (
  test_owned boolean not null
);
do $$
declare
  extension_oid oid;
  extension_comment text;
  ownership_marker constant text := 'issue25:legal_consent_activation_concurrency:test-owned:v1';
begin
  select e.oid, obj_description(e.oid, 'pg_extension')
  into extension_oid, extension_comment
  from pg_extension e
  where e.extname = 'dblink';

  if extension_oid is not null and extension_comment = ownership_marker then
    execute 'drop extension dblink';
    extension_oid := null;
  end if;

  if extension_oid is null then
    execute 'create extension dblink with schema extensions';
    execute format('comment on extension dblink is %L', ownership_marker);
    insert into legal_activation_dblink_extension_state values (true);
  else
    insert into legal_activation_dblink_extension_state values (false);
  end if;
end;
$$;
create extension if not exists pgtap with schema extensions;

do $$
declare
  connection_name text;
begin
  foreach connection_name in array array[
    'issue25_legal_lock', 'issue25_legal_activate'
  ] loop
    begin
      perform extensions.dblink_disconnect(connection_name);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

drop function if exists private.issue25_activate_provisional_legal_versions_for_test();

-- Restore the exact pre-activation state in one local test transaction. Abort
-- rather than remove any acceptance evidence if the local fixture is not clean.
begin;
lock table public.beta_legal_documents in share row exclusive mode;
do $$
begin
  if exists (
    select 1
    from public.beta_consent_events c
    where c.document_code in ('beta_terms', 'marketplace_rules')
      and c.document_version = '2026-08-24-provisional.1'
  ) then
    raise exception 'legal activation concurrency fixture requires no provisional consent events';
  end if;
end;
$$;
delete from public.beta_legal_documents
where document_code in ('beta_terms', 'marketplace_rules')
  and document_version = '2026-08-24-provisional.1';
update public.beta_legal_documents
set retired_at = null
where document_code in ('beta_terms', 'marketplace_rules')
  and document_version = '2026-07-22';
commit;

-- This test-only helper deliberately mirrors the migration's single atomic DO
-- block so a second PostgreSQL session can invoke it while blocked on the lock.
create function private.issue25_activate_provisional_legal_versions_for_test()
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  activation_timestamp timestamptz;
  expected_current_count integer;
  retired_count integer;
begin
  lock table public.beta_legal_documents in share row exclusive mode;

  select count(*)::integer
  into expected_current_count
  from public.beta_legal_documents d
  where d.document_code in ('beta_terms', 'marketplace_rules')
    and d.document_version = '2026-07-22'
    and d.required_for_access = true
    and d.effective_at = timestamptz '2026-07-22 00:00:00+03'
    and d.retired_at is null;

  if expected_current_count <> 2
     or exists (
       select 1
       from public.beta_legal_documents d
       where d.document_code in ('beta_terms', 'marketplace_rules')
         and d.retired_at is null
         and not (
           d.document_version = '2026-07-22'
           and d.required_for_access = true
           and d.effective_at = timestamptz '2026-07-22 00:00:00+03'
         )
     )
     or exists (
       select 1
       from public.beta_legal_documents d
       where d.document_code in ('beta_terms', 'marketplace_rules')
         and d.document_version = '2026-08-24-provisional.1'
     )
  then
    raise exception 'expected current legal document versions are missing or drifted'
      using errcode = '23514';
  end if;

  activation_timestamp := clock_timestamp();
  update public.beta_legal_documents
  set retired_at = activation_timestamp
  where document_code in ('beta_terms', 'marketplace_rules')
    and document_version = '2026-07-22'
    and required_for_access = true
    and effective_at = timestamptz '2026-07-22 00:00:00+03'
    and retired_at is null;

  get diagnostics retired_count = row_count;
  if retired_count <> 2 then
    raise exception 'expected current legal document versions changed during activation'
      using errcode = '40001';
  end if;

  insert into public.beta_legal_documents (
    document_code, document_version, required_for_access, effective_at
  ) values
    ('beta_terms', '2026-08-24-provisional.1', true, activation_timestamp),
    ('marketplace_rules', '2026-08-24-provisional.1', true, activation_timestamp);

  return activation_timestamp;
end;
$$;
revoke execute on function private.issue25_activate_provisional_legal_versions_for_test()
  from public, anon, authenticated, service_role;

create temp table legal_activation_sessions (
  actor text primary key,
  pid integer not null
);
create temp table legal_activation_observation (
  reached_lock_barrier boolean not null default false,
  release_boundary timestamptz,
  activation_timestamp timestamptz
);
insert into legal_activation_observation default values;

select extensions.dblink_connect(
  'issue25_legal_lock',
  'host=db port=5432 dbname=postgres user=postgres password=postgres application_name=issue25_legal_lock'
);
select extensions.dblink_connect(
  'issue25_legal_activate',
  'host=db port=5432 dbname=postgres user=postgres password=postgres application_name=issue25_legal_activate'
);

insert into legal_activation_sessions
select 'lock', pid
from extensions.dblink('issue25_legal_lock', 'select pg_backend_pid()') as t(pid integer)
union all
select 'activate', pid
from extensions.dblink('issue25_legal_activate', 'select pg_backend_pid()') as t(pid integer);

select extensions.dblink_exec(
  'issue25_legal_lock',
  'begin; lock table public.beta_legal_documents in access exclusive mode'
);
select extensions.dblink_exec('issue25_legal_activate', 'begin');
select extensions.dblink_send_query(
  'issue25_legal_activate',
  'select private.issue25_activate_provisional_legal_versions_for_test()'
);

do $$
declare
  attempt integer;
  waiter_pid integer := (
    select pid from legal_activation_sessions where actor = 'activate'
  );
  is_waiting boolean := false;
begin
  for attempt in 1..200 loop
    perform pg_stat_clear_snapshot();
    select exists (
      select 1
      from pg_stat_activity a
      join pg_locks l on l.pid = a.pid
      where a.pid = waiter_pid
        and a.state = 'active'
        and a.wait_event_type = 'Lock'
        and l.locktype = 'relation'
        and l.relation = 'public.beta_legal_documents'::regclass
        and not l.granted
    ) into is_waiting;

    exit when is_waiting;
    perform pg_sleep(0.025);
  end loop;

  update legal_activation_observation
  set reached_lock_barrier = is_waiting;
end;
$$;

-- A statement-start timestamp in the waiting session is now strictly stale.
-- Capture the lower bound immediately before releasing the conflicting lock.
select pg_sleep(0.25);
update legal_activation_observation
set release_boundary = clock_timestamp();
select extensions.dblink_exec('issue25_legal_lock', 'commit');

do $$
declare
  attempt integer;
begin
  for attempt in 1..200 loop
    exit when extensions.dblink_is_busy('issue25_legal_activate') = 0;
    perform pg_sleep(0.025);
  end loop;

  if extensions.dblink_is_busy('issue25_legal_activate') <> 0 then
    raise exception 'legal activation did not finish after the table lock was released';
  end if;

  update legal_activation_observation
  set activation_timestamp = result.activation_timestamp
  from extensions.dblink_get_result('issue25_legal_activate')
    as result(activation_timestamp timestamptz);
  perform activation_timestamp
  from extensions.dblink_get_result('issue25_legal_activate')
    as drained(activation_timestamp timestamptz);
end;
$$;
select extensions.dblink_exec('issue25_legal_activate', 'commit');

select plan(6);
select is(
  (select count(distinct pid)::integer from legal_activation_sessions),
  2,
  'the lock holder and activation waiter use distinct PostgreSQL sessions'
);
select ok(
  (select reached_lock_barrier from legal_activation_observation),
  'activation reaches the explicit legal-document table-lock barrier'
);
select ok(
  (
    select activation_timestamp >= release_boundary
    from legal_activation_observation
  ),
  'the recorded activation boundary is not earlier than lock release'
);
select ok(
  (
    select count(*) = 2
      and count(distinct d.retired_at) = 1
      and min(d.retired_at) = observation.activation_timestamp
    from public.beta_legal_documents d
    cross join legal_activation_observation observation
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-07-22'
      and d.retired_at is not null
    group by observation.activation_timestamp
  ),
  'both historical versions share the post-lock retirement boundary'
);
select ok(
  (
    select count(*) = 2
      and count(distinct d.effective_at) = 1
      and min(d.effective_at) = observation.activation_timestamp
    from public.beta_legal_documents d
    cross join legal_activation_observation observation
    where d.document_code in ('beta_terms', 'marketplace_rules')
      and d.document_version = '2026-08-24-provisional.1'
      and d.retired_at is null
    group by observation.activation_timestamp
  ),
  'both current versions share the same post-lock effective boundary'
);
select ok(
  has_table_privilege('anon', 'public.beta_legal_documents', 'select')
    and has_table_privilege('authenticated', 'public.beta_legal_documents', 'select')
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.beta_legal_documents'::regclass)
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.beta_consent_events'::regclass),
  'legal-document privileges and consent RLS remain unchanged after activation'
);

select extensions.dblink_disconnect('issue25_legal_lock');
select extensions.dblink_disconnect('issue25_legal_activate');
drop function private.issue25_activate_provisional_legal_versions_for_test();

select * from finish();

do $$
declare
  ownership_marker constant text := 'issue25:legal_consent_activation_concurrency:test-owned:v1';
begin
  if (select test_owned from legal_activation_dblink_extension_state)
     and exists (
       select 1
       from pg_extension e
       where e.extname = 'dblink'
         and obj_description(e.oid, 'pg_extension') = ownership_marker
     )
  then
    execute 'drop extension dblink';
  end if;
end;
$$;
