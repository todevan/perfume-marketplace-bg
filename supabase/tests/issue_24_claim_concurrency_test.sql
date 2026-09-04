begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(5);

create or replace function pg_temp.wait_for_backend_lock(
  target_pid integer,
  timeout interval default interval '2 seconds'
)
returns boolean
language plpgsql
set search_path = 'pg_catalog'
as $$
declare
  deadline timestamptz := clock_timestamp() + timeout;
begin
  loop
    if exists (
      select 1
      from pg_catalog.pg_stat_activity a
      where a.pid = target_pid
        and a.wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    if clock_timestamp() >= deadline then
      return false;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$$;

do $connections$
declare
  connection_string text := pg_catalog.format(
    'host=%s port=%s dbname=%s user=postgres password=postgres sslmode=disable connect_timeout=2',
    pg_catalog.inet_server_addr(),
    pg_catalog.inet_server_port(),
    pg_catalog.current_database()
  );
begin
  perform extensions.dblink_connect('issue24_fixture', connection_string);
  perform extensions.dblink_connect('issue24_locker', connection_string);
  perform extensions.dblink_connect('issue24_claim_a', connection_string);
  perform extensions.dblink_connect('issue24_claim_b', connection_string);
end;
$connections$;

do $fixture$
begin
  perform extensions.dblink_exec(
    'issue24_fixture',
    $sql$
      begin;
      set local session_replication_role = replica;
      delete from public.moderation_audit where report_id = '24600000-0000-4000-8000-000000000001';
      delete from public.reports where id = '24600000-0000-4000-8000-000000000001';
      delete from public.listings where id = '24600000-0000-4000-8000-000000000002';
      delete from public.brands where id = '24600000-0000-4000-8000-000000000003';
      delete from public.notification_email_deliveries
      where notification_id in (
        select id from public.notifications where profile_id in (
          '24600000-0000-4000-8000-000000000011',
          '24600000-0000-4000-8000-000000000012',
          '24600000-0000-4000-8000-000000000013',
          '24600000-0000-4000-8000-000000000014'
        )
      );
      delete from public.notifications where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      delete from public.beta_consent_events where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      set local session_replication_role = origin;
      delete from public.beta_memberships where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      delete from public.beta_invites where id in (
        '24600000-0000-4000-8000-000000000021',
        '24600000-0000-4000-8000-000000000022',
        '24600000-0000-4000-8000-000000000023',
        '24600000-0000-4000-8000-000000000024'
      );
      delete from auth.users where id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );

      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values
        ('24600000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-race-reporter@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_race_reporter"}', now(), now()),
        ('24600000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-race-target@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_race_target"}', now(), now()),
        ('24600000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-race-mod-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_race_mod_a"}', now(), now()),
        ('24600000-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue24-race-mod-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"username":"issue24_race_mod_b"}', now(), now());

      update public.profiles
      set city = 'Sofia', email_verified_at = now(), phone_verified_at = now(),
          role = case when id in (
            '24600000-0000-4000-8000-000000000013',
            '24600000-0000-4000-8000-000000000014'
          ) then 'moderator'::public.platform_role else role end
      where id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );

      insert into public.beta_invites (id, email, token_hash, status, expires_at) values
        ('24600000-0000-4000-8000-000000000021', 'issue24-race-reporter@example.test', repeat('6',64), 'pending', now() + interval '7 days'),
        ('24600000-0000-4000-8000-000000000022', 'issue24-race-target@example.test', repeat('7',64), 'pending', now() + interval '7 days'),
        ('24600000-0000-4000-8000-000000000023', 'issue24-race-mod-a@example.test', repeat('8',64), 'pending', now() + interval '7 days'),
        ('24600000-0000-4000-8000-000000000024', 'issue24-race-mod-b@example.test', repeat('9',64), 'pending', now() + interval '7 days');

      update public.beta_invites
      set status = 'accepted',
          accepted_by = case id
            when '24600000-0000-4000-8000-000000000021'::uuid then '24600000-0000-4000-8000-000000000011'::uuid
            when '24600000-0000-4000-8000-000000000022'::uuid then '24600000-0000-4000-8000-000000000012'::uuid
            when '24600000-0000-4000-8000-000000000023'::uuid then '24600000-0000-4000-8000-000000000013'::uuid
            else '24600000-0000-4000-8000-000000000014'::uuid
          end
      where id in (
        '24600000-0000-4000-8000-000000000021',
        '24600000-0000-4000-8000-000000000022',
        '24600000-0000-4000-8000-000000000023',
        '24600000-0000-4000-8000-000000000024'
      );

      insert into public.beta_memberships (profile_id, invite_id, status)
      select accepted_by, id, 'pending'
      from public.beta_invites
      where id in (
        '24600000-0000-4000-8000-000000000021',
        '24600000-0000-4000-8000-000000000022',
        '24600000-0000-4000-8000-000000000023',
        '24600000-0000-4000-8000-000000000024'
      );
      update public.beta_memberships
      set status = 'active'
      where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      update public.beta_memberships
      set activated_at = now() - interval '1 second'
      where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      insert into public.beta_consent_events (profile_id, document_code, document_version, source)
      select m.profile_id, d.document_code, d.document_version, 'web'
      from public.beta_memberships m
      cross join public.beta_legal_documents d
      where m.profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      ) and d.required_for_access and d.retired_at is null;

      insert into public.brands (id, canonical_name, slug, status, normalized_key)
      values ('24600000-0000-4000-8000-000000000003', 'Issue 24 Race Brand', 'issue-24-race-brand', 'canonical', 'issue 24 race brand');
      set local session_replication_role = replica;
      insert into public.listings (
        id, seller_id, kind, deal_mode, product_format, audience, brand_id,
        fragrance_name, concentration, title, description, city,
        bottle_volume_ml, remaining_ml, is_sealed, price_minor, status,
        slug, activated_at, expires_at
      ) values (
        '24600000-0000-4000-8000-000000000002',
        '24600000-0000-4000-8000-000000000012',
        'offer', 'sale', 'retail_bottle', 'unisex',
        '24600000-0000-4000-8000-000000000003',
        'Race Fragrance', 'EDP', 'Concurrent claim fixture', 'Concurrent claim fixture', 'Sofia',
        100, 90, false, 10000, 'active', 'issue-24-race-listing', now(), now() + interval '30 days'
      );
      insert into public.reports (
        id, reporter_id, target_type, target_id, reason_code, status, created_at, updated_at
      ) values (
        '24600000-0000-4000-8000-000000000001',
        '24600000-0000-4000-8000-000000000011',
        'listing', '24600000-0000-4000-8000-000000000002',
        'counterfeit', 'open', now(), now()
      );
      set local session_replication_role = origin;
      commit;
    $sql$
  );
end;
$fixture$;

do $configure$
begin
  perform extensions.dblink_exec('issue24_locker', 'begin');
  perform extensions.dblink_exec(
    'issue24_locker',
    $lock$
      do $body$
      begin
        perform id
        from public.reports
        where id = '24600000-0000-4000-8000-000000000001'
        for update;
      end;
      $body$;
    $lock$
  );
  perform extensions.dblink_exec('issue24_claim_a', 'set role authenticated');
  perform extensions.dblink_exec('issue24_claim_a', $$set request.jwt.claim.sub = '24600000-0000-4000-8000-000000000013'$$);
  perform extensions.dblink_exec('issue24_claim_a', $$set request.jwt.claims = '{"sub":"24600000-0000-4000-8000-000000000013","role":"authenticated","aal":"aal2"}'$$);
  perform extensions.dblink_exec('issue24_claim_b', 'set role authenticated');
  perform extensions.dblink_exec('issue24_claim_b', $$set request.jwt.claim.sub = '24600000-0000-4000-8000-000000000014'$$);
  perform extensions.dblink_exec('issue24_claim_b', $$set request.jwt.claims = '{"sub":"24600000-0000-4000-8000-000000000014","role":"authenticated","aal":"aal2"}'$$);
end;
$configure$;

create temp table issue24_backend_pids (connection_name text primary key, backend_pid integer not null) on commit drop;
insert into issue24_backend_pids
select 'issue24_claim_a', pid from extensions.dblink('issue24_claim_a', 'select pg_backend_pid()') as result(pid integer)
union all
select 'issue24_claim_b', pid from extensions.dblink('issue24_claim_b', 'select pg_backend_pid()') as result(pid integer);

do $start_claims$
begin
  if extensions.dblink_send_query('issue24_claim_a', $$select public.claim_moderation_report('24600000-0000-4000-8000-000000000001')$$) <> 1 then
    raise exception 'could not start first claim probe';
  end if;
  if extensions.dblink_send_query('issue24_claim_b', $$select public.claim_moderation_report('24600000-0000-4000-8000-000000000001')$$) <> 1 then
    raise exception 'could not start second claim probe';
  end if;
end;
$start_claims$;

select ok(
  pg_temp.wait_for_backend_lock((select backend_pid from issue24_backend_pids where connection_name = 'issue24_claim_a')),
  'the first real claimant waits on the locked report row'
);
select ok(
  pg_temp.wait_for_backend_lock((select backend_pid from issue24_backend_pids where connection_name = 'issue24_claim_b')),
  'the second real claimant waits on the same locked report row'
);

select extensions.dblink_exec('issue24_locker', 'commit');
create temp table issue24_claim_results (result text not null) on commit drop;
insert into issue24_claim_results select result from extensions.dblink_get_result('issue24_claim_a') as completed(result text);
insert into issue24_claim_results select result from extensions.dblink_get_result('issue24_claim_b') as completed(result text);

select is(
  (select array_agg(result order by result) from issue24_claim_results),
  array['claimed','unavailable']::text[],
  'exactly one concurrent claimant wins and the loser receives generic unavailable'
);
select is(
  (select count(*) from public.moderation_audit where report_id = '24600000-0000-4000-8000-000000000001' and action = 'report_assigned'),
  1::bigint,
  'the concurrent race writes exactly one assignment audit row'
);
select ok(
  (select status = 'investigating' and assigned_to in (
    '24600000-0000-4000-8000-000000000013',
    '24600000-0000-4000-8000-000000000014'
  ) from public.reports where id = '24600000-0000-4000-8000-000000000001'),
  'the concurrent race leaves one valid exact assignee'
);

do $cleanup$
begin
  perform extensions.dblink_exec(
    'issue24_fixture',
    $sql$
      begin;
      set local session_replication_role = replica;
      delete from public.moderation_audit where report_id = '24600000-0000-4000-8000-000000000001';
      delete from public.reports where id = '24600000-0000-4000-8000-000000000001';
      delete from public.listings where id = '24600000-0000-4000-8000-000000000002';
      delete from public.brands where id = '24600000-0000-4000-8000-000000000003';
      delete from public.notification_email_deliveries
      where notification_id in (
        select id from public.notifications where profile_id in (
          '24600000-0000-4000-8000-000000000011',
          '24600000-0000-4000-8000-000000000012',
          '24600000-0000-4000-8000-000000000013',
          '24600000-0000-4000-8000-000000000014'
        )
      );
      delete from public.notifications where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      delete from public.beta_consent_events where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      set local session_replication_role = origin;
      delete from public.beta_memberships where profile_id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      delete from public.beta_invites where id in (
        '24600000-0000-4000-8000-000000000021',
        '24600000-0000-4000-8000-000000000022',
        '24600000-0000-4000-8000-000000000023',
        '24600000-0000-4000-8000-000000000024'
      );
      delete from auth.users where id in (
        '24600000-0000-4000-8000-000000000011',
        '24600000-0000-4000-8000-000000000012',
        '24600000-0000-4000-8000-000000000013',
        '24600000-0000-4000-8000-000000000014'
      );
      commit;
    $sql$
  );
  perform extensions.dblink_disconnect('issue24_claim_b');
  perform extensions.dblink_disconnect('issue24_claim_a');
  perform extensions.dblink_disconnect('issue24_locker');
  perform extensions.dblink_disconnect('issue24_fixture');
end;
$cleanup$;

select * from finish();
rollback;
