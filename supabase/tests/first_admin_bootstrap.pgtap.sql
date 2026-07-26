begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(18);

select ok(
  to_regclass('private.first_admin_bootstrap') is not null,
  'first-admin singleton provenance exists'
);
select ok(
  to_regclass('private.first_admin_bootstrap_attempts') is not null,
  'bootstrap attempt provenance exists'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'private.first_admin_bootstrap'::regclass
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) like '%singleton%'
  ),
  'the environment has one singleton bootstrap root'
);
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'private.first_admin_bootstrap'::regclass
      and t.tgname = 'protect_first_admin_bootstrap'
      and not t.tgisinternal
  ),
  'bootstrap identity and binding provenance are immutable'
);
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'private.first_admin_bootstrap_attempts'::regclass
      and t.tgname = 'first_admin_bootstrap_attempts_append_only'
      and not t.tgisinternal
  ),
  'bootstrap attempts are append-only'
);

select ok(
  to_regprocedure(
    'public.prepare_first_admin_invite(text,interval)'
  ) is not null
  and to_regprocedure(
    'public.prepare_first_admin_bootstrap(text,text,uuid,interval)'
  ) is null,
  'only the exact first-admin prepare RPC signature exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.prepare_first_admin_invite(text,interval)',
    'execute'
  ),
  'service role can prepare the bootstrap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.prepare_first_admin_invite(text,interval)',
    'execute'
  ),
  'authenticated clients cannot prepare the bootstrap'
);
select is(
  pg_get_function_result(
    'public.prepare_first_admin_invite(text,interval)'::regprocedure
  ),
  'TABLE(bootstrap_invite_id uuid, bootstrap_invite_expires_at timestamp with time zone, bootstrap_attempt_reused boolean)',
  'prepare returns no raw invitation token'
);
select ok(
  position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.prepare_first_admin_invite(text,interval)'::regprocedure
    )
  ) > 0,
  'prepare serializes concurrent first-admin attempts'
);

select ok(
  to_regprocedure(
    'public.bind_first_admin_invite(uuid,uuid)'
  ) is not null
  and to_regprocedure(
    'public.bind_first_admin_bootstrap(text,text,uuid)'
  ) is null,
  'only the exact first-admin bind RPC signature exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.bind_first_admin_invite(uuid,uuid)',
    'execute'
  ),
  'service role can bind the bootstrap'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bind_first_admin_invite(uuid,uuid)',
    'execute'
  ),
  'authenticated clients cannot bind the bootstrap'
);
select ok(
  position(
    'from auth.users' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'u.invited_at' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'bind verifies the authoritative invited Auth user'
);
select ok(
  position(
    'insert into public.beta_consent_events' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) = 0,
  'bind never accepts legal documents for the administrator'
);
select ok(
  position(
    '''pending''' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'bind creates only pending beta access'
);
select ok(
  not has_table_privilege(
    'service_role', 'private.first_admin_bootstrap', 'select'
  )
  and not has_table_privilege(
    'service_role', 'private.first_admin_bootstrap_attempts', 'select'
  ),
  'service role cannot bypass the audited RPCs with direct table access'
);
select ok(
  position(
    'bootstrap_record.bound_profile_id is not null' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'bootstrap_record.bound_invite_id is distinct from target_invite_id'
    in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'bootstrap_record.bound_profile_id is distinct from target_user_id'
    in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'a.invite_id = target_invite_id' in lower(pg_get_functiondef(
      'public.bind_first_admin_invite(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'bind is idempotent only for the exact immutable invite and Auth user pair'
);

select * from finish();
rollback;
