begin;

set local role postgres;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(13);

select ok(
  to_regprocedure('public.list_my_reports(integer,integer)') is not null,
  'reporters have one safe paginated report-history RPC'
);
select ok(
  to_regprocedure('public.list_moderation_report_queue(integer,integer)') is not null,
  'staff have one summary-only moderation queue RPC'
);
select ok(
  to_regprocedure('public.claim_moderation_report(uuid)') is not null,
  'staff have one atomic report-claim RPC'
);
select ok(
  to_regprocedure('public.get_assigned_moderation_case(uuid)') is not null,
  'the exact assignee has one private moderation-case RPC'
);

select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.list_my_reports(integer,integer)'), 'execute'), false)
    and coalesce(not has_function_privilege('anon', to_regprocedure('public.list_my_reports(integer,integer)'), 'execute'), false),
  'report history is authenticated-only'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.list_moderation_report_queue(integer,integer)'), 'execute'), false)
    and coalesce(not has_function_privilege('anon', to_regprocedure('public.list_moderation_report_queue(integer,integer)'), 'execute'), false),
  'the moderation queue is authenticated-only'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.claim_moderation_report(uuid)'), 'execute'), false)
    and coalesce(not has_function_privilege('anon', to_regprocedure('public.claim_moderation_report(uuid)'), 'execute'), false),
  'report claim is authenticated-only'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.get_assigned_moderation_case(uuid)'), 'execute'), false)
    and coalesce(not has_function_privilege('anon', to_regprocedure('public.get_assigned_moderation_case(uuid)'), 'execute'), false),
  'private moderation case access is authenticated-only'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.can_read_report_evidence(text)'), 'execute'), false)
    and coalesce(not has_function_privilege('anon', to_regprocedure('public.can_read_report_evidence(text)'), 'execute'), false),
  'authenticated storage RLS can execute the exact-assignment evidence predicate while anonymous callers cannot'
);

select ok(
  not has_table_privilege('authenticated', 'public.reports', 'select'),
  'authenticated clients cannot read mixed public/private report rows directly'
);
select ok(
  has_table_privilege('authenticated', 'public.reports', 'insert'),
  'authenticated reporters retain direct report creation'
);
select ok(
  not has_table_privilege('authenticated', 'public.reports', 'update'),
  'authenticated clients cannot update report workflow state directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.moderation_audit', 'select'),
  'authenticated staff cannot read moderation audit rows outside assigned-case RPCs'
);

select * from finish();
rollback;
