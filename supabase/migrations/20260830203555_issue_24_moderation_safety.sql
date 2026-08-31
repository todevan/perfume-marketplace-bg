begin;

create or replace function private.report_target_capability(
  target_type public.report_target_type
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case target_type
    when 'profile' then 'target_action'
    when 'brand' then 'safe_disposition'
    when 'listing' then 'target_action'
    when 'offer' then 'safe_disposition'
    when 'conversation' then 'target_action'
    when 'message' then 'target_action'
    when 'deal' then 'target_action'
    when 'review' then 'target_action'
    when 'profile_comment' then 'target_action'
  end;
$$;

create or replace function private.is_moderation_target_eligible(
  actor_id uuid,
  target_type public.report_target_type,
  target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select actor_id is not null
    and actor_id = auth.uid()
    and public.is_staff(actor_id)
    and private.report_target_capability(target_type) is not null
    and case target_type
      when 'listing' then exists (
        select 1 from public.listings l where l.id = target_id
      )
      when 'brand' then exists (
        select 1 from public.brands b where b.id = target_id
      )
      when 'offer' then exists (
        select 1 from public.offers o where o.id = target_id
      )
      when 'profile' then actor_id <> target_id and exists (
        select 1
        from public.profiles p
        where p.id = target_id
          and (
            p.role = 'user'
            or public.is_admin(actor_id)
          )
      )
      when 'review' then exists (
        select 1 from public.reviews r where r.id = target_id
      )
      when 'profile_comment' then exists (
        select 1 from public.profile_comments c where c.id = target_id
      )
      when 'deal' then exists (
        select 1 from public.deals d where d.id = target_id
      )
      when 'conversation' then exists (
        select 1 from public.conversations c where c.id = target_id
      )
      when 'message' then exists (
        select 1 from public.messages m where m.id = target_id
      )
      else false
    end;
$$;

create or replace function private.enforce_report_target_capability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.report_target_capability(new.target_type) <> 'target_action' then
    raise exception 'report target is not supported for submission'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_report_target_capability on public.reports;
create trigger enforce_report_target_capability
before insert on public.reports
for each row execute function private.enforce_report_target_capability();

create or replace function private.require_assigned_moderation_case(
  report_case_id uuid,
  expected_target_type public.report_target_type,
  expected_target_id uuid
)
returns public.reports
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
begin
  select * into target_report
  from public.reports r
  where r.id = report_case_id;

  if not found
     or target_report.status <> 'investigating'
     or target_report.assigned_to is distinct from auth.uid()
     or target_report.target_type is distinct from expected_target_type
     or target_report.target_id is distinct from expected_target_id
     or not private.is_moderation_target_eligible(
       auth.uid(),
       target_report.target_type,
       target_report.target_id
     )
  then
    raise exception 'assigned moderation case required' using errcode = '42501';
  end if;

  return target_report;
end;
$$;

revoke execute on function private.is_moderation_target_eligible(uuid, public.report_target_type, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.report_target_capability(public.report_target_type)
  from public, anon, authenticated, service_role;
revoke execute on function private.enforce_report_target_capability()
  from public, anon, authenticated, service_role;
revoke execute on function private.require_assigned_moderation_case(uuid, public.report_target_type, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.list_my_reports(
  p_page_size integer default 50,
  p_page_offset integer default 0,
  p_status public.report_status default null
)
returns table (
  report_id uuid,
  target_type public.report_target_type,
  reason_code text,
  evidence_count bigint,
  status public.report_status,
  outcome text,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  safe_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
begin
  if caller_id is null then
    raise exception 'authenticated reporter access required' using errcode = '42501';
  end if;
  if coalesce(p_page_offset, 0) < 0 then
    raise exception 'page offset must be non-negative' using errcode = '22023';
  end if;

  return query
  select
    r.id,
    r.target_type,
    case
      when r.reason_code in (
        'counterfeit_suspected',
        'misleading_content',
        'harassment',
        'spam_fraud',
        'other_violation'
      ) then r.reason_code
      else 'other_violation'
    end,
    jsonb_array_length(r.evidence_paths)::bigint,
    r.status,
    case
      when r.status in ('open', 'investigating') then 'pending'
      when r.status = 'dismissed' then 'no_action'
      when r.resolution_code in (
        'content_hidden',
        'content_removed',
        'content_corrected',
        'user_suspended',
        'brand_merged',
        'authenticity_reviewed',
        'deal_cancelled_after_dispute'
      ) then 'action_taken'
      when r.resolution_code in (
        'no_violation',
        'user_restored',
        'deal_confirmation_resumed'
      ) then 'no_action'
      else 'completed'
    end,
    r.resolved_at,
    r.created_at,
    r.updated_at,
    count(*) over ()
  from public.reports r
  where r.reporter_id = caller_id
    and (p_status is null or r.status = p_status)
  order by r.created_at desc, r.id desc
  limit safe_page_size
  offset coalesce(p_page_offset, 0);
end;
$$;

create or replace function public.list_moderation_report_queue(
  p_page_size integer default 50,
  p_page_offset integer default 0
)
returns table (
  report_id uuid,
  target_type public.report_target_type,
  reason_code text,
  status public.report_status,
  assignment_state text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  safe_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
begin
  if caller_id is null or not public.is_staff(caller_id) then
    raise exception 'active AAL2 staff access required' using errcode = '42501';
  end if;
  if coalesce(p_page_offset, 0) < 0 then
    raise exception 'page offset must be non-negative' using errcode = '22023';
  end if;

  return query
  select
    r.id,
    r.target_type,
    case
      when r.reason_code in (
        'counterfeit_suspected',
        'misleading_content',
        'harassment',
        'spam_fraud',
        'other_violation'
      ) then r.reason_code
      else 'other_violation'
    end,
    r.status,
    case
      when r.assigned_to is null then 'unassigned'
      else 'assigned_to_you'
    end,
    r.created_at
  from public.reports r
  where (
      (r.status = 'open' and r.assigned_to is null)
      or (r.status = 'investigating' and r.assigned_to = caller_id)
    )
    and private.is_moderation_target_eligible(caller_id, r.target_type, r.target_id)
  order by r.created_at asc, r.id asc
  limit safe_page_size
  offset coalesce(p_page_offset, 0);
end;
$$;

create or replace function public.claim_moderation_report(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_report public.reports%rowtype;
begin
  if caller_id is null or not public.is_staff(caller_id) then
    return 'unavailable';
  end if;

  select * into target_report
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found
     or not private.is_moderation_target_eligible(
       caller_id,
       target_report.target_type,
       target_report.target_id
     )
  then
    return 'unavailable';
  end if;
  if target_report.status = 'investigating'
     and target_report.assigned_to = caller_id
  then
    return 'already_claimed_by_you';
  end if;

  if target_report.status <> 'open' or target_report.assigned_to is not null then
    return 'unavailable';
  end if;

  update public.reports
  set status = 'investigating',
      assigned_to = caller_id,
      updated_at = statement_timestamp()
  where id = target_report.id;

  return 'claimed';
end;
$$;

create or replace function public.get_assigned_moderation_case(p_report_id uuid)
returns table (
  report_id uuid,
  reporter_id uuid,
  target_type public.report_target_type,
  target_id uuid,
  reason_code text,
  details text,
  evidence_paths jsonb,
  status public.report_status,
  assigned_to uuid,
  resolution_code text,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  audit_entries jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
begin
  target_report := private.require_assigned_moderation_case(
    p_report_id,
    (select r.target_type from public.reports r where r.id = p_report_id),
    (select r.target_id from public.reports r where r.id = p_report_id)
  );

  return query
  select
    target_report.id,
    target_report.reporter_id,
    target_report.target_type,
    target_report.target_id,
    target_report.reason_code,
    target_report.details,
    target_report.evidence_paths,
    target_report.status,
    target_report.assigned_to,
    target_report.resolution_code,
    target_report.resolution_notes,
    target_report.resolved_at,
    target_report.created_at,
    target_report.updated_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'actor_id', a.actor_id,
          'action', a.action,
          'rationale', a.rationale,
          'created_at', a.created_at
        ) order by a.created_at, a.id
      )
      from public.moderation_audit a
      where a.report_id = target_report.id
    ), '[]'::jsonb);
end;
$$;

create function public.resolve_unsupported_report(
  report_case_id uuid,
  moderation_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
  normalized_rationale text := btrim(coalesce(moderation_rationale, ''));
begin
  if char_length(normalized_rationale) < 10 then
    raise exception 'moderation rationale must contain at least 10 characters'
      using errcode = '22023';
  end if;

  select * into target_report
  from public.reports r
  where r.id = report_case_id
  for update;

  if not found
     or private.report_target_capability(target_report.target_type) <> 'safe_disposition'
  then
    raise exception 'assigned moderation case required' using errcode = '42501';
  end if;

  perform private.require_assigned_moderation_case(
    target_report.id,
    target_report.target_type,
    target_report.target_id
  );

  update public.reports
  set status = 'dismissed',
      resolution_code = 'unsupported_target',
      resolution_notes = normalized_rationale,
      resolved_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = target_report.id;
end;
$$;

create or replace function public.validate_moderation_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_record public.reports%rowtype;
  target_matches boolean := false;
begin
  new.created_at := statement_timestamp();
  if auth.uid() is null
     or new.actor_id is distinct from auth.uid()
     or not public.is_staff(auth.uid())
  then
    raise exception 'an active staff actor is required for moderation audit events'
      using errcode = '42501';
  end if;

  if new.report_id is null then
    if new.action not in ('merchant_verified', 'merchant_rejected') then
      raise exception 'moderation action requires an assigned report case'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select * into report_record
  from public.reports r
  where r.id = new.report_id;
  if not found then
    raise exception 'moderation report case was not found' using errcode = 'P0002';
  end if;
  if report_record.assigned_to is distinct from new.actor_id then
    raise exception 'moderation report is assigned to another actor'
      using errcode = '42501';
  end if;
  if not private.is_moderation_target_eligible(
    new.actor_id,
    report_record.target_type,
    report_record.target_id
  ) then
    raise exception 'moderation actor is not eligible for the report target'
      using errcode = '42501';
  end if;

  if new.action = 'report_assigned' then
    if report_record.status <> 'investigating' then
      raise exception 'report assignment audit requires an investigating case'
        using errcode = '23514';
    end if;
  elsif new.action = 'report_resolved' then
    if report_record.status not in ('resolved', 'dismissed') then
      raise exception 'report resolution audit requires a closed case'
        using errcode = '23514';
    end if;
  elsif report_record.status <> 'investigating' then
    raise exception 'moderation actions require a live investigating case'
      using errcode = '23514';
  end if;

  target_matches := report_record.target_type = new.target_type
    and report_record.target_id = new.target_id;
  if not target_matches
     and new.action = 'conversation_accessed'
     and report_record.target_type = 'message'
     and new.target_type = 'conversation'
  then
    select exists (
      select 1 from public.messages m
      where m.id = report_record.target_id
        and m.conversation_id = new.target_id
    ) into target_matches;
  end if;
  if not target_matches then
    raise exception 'audit target is not authorized by its report case'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_beta_user(new.sender_id) then
    raise exception 'active beta membership is required to send messages'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.status = 'open'
  ) then
    raise exception 'messages require an open conversation' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.profile_id = new.sender_id
      and cm.blocked_at is null
  ) then
    raise exception 'sender is not an active conversation member' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.blocked_at is not null
  ) then
    raise exception 'conversation contact is blocked' using errcode = '42501';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'reply target belongs to another conversation' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_at := statement_timestamp(); end if;
  return new;
end;
$$;

create or replace function public.can_read_report_evidence(evidence_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.report_evidence_uploads u
    join public.reports r on r.id = u.report_id
    where u.bucket_id = 'report-evidence'
      and u.storage_path = evidence_path
      and u.status = 'attached'
      and (
        u.uploader_id = auth.uid()
        or (
          r.status = 'investigating'
          and r.assigned_to = auth.uid()
          and private.is_moderation_target_eligible(
            auth.uid(),
            r.target_type,
            r.target_id
          )
        )
      )
  );
$$;

alter function public.moderator_read_messages(uuid, timestamptz, integer)
  set schema private;
alter function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status)
  set schema private;
alter function public.moderate_profile(uuid, uuid, boolean, text)
  set schema private;
alter function public.canonicalize_brand(uuid, uuid, uuid, text)
  set schema private;
alter function public.review_listing_authenticity(uuid, uuid, public.authenticity_review_status, text, text)
  set schema private;
alter function public.moderate_review(uuid, uuid, public.review_status, text)
  set schema private;
alter function public.moderate_profile_comment(uuid, uuid, public.review_status, text)
  set schema private;
alter function public.resolve_conversation_report(uuid, text, text)
  set schema private;

revoke execute on function private.moderator_read_messages(uuid, timestamptz, integer) from public, anon, authenticated, service_role;
revoke execute on function private.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) from public, anon, authenticated, service_role;
revoke execute on function private.moderate_profile(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function private.canonicalize_brand(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.review_listing_authenticity(uuid, uuid, public.authenticity_review_status, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.moderate_review(uuid, uuid, public.review_status, text) from public, anon, authenticated, service_role;
revoke execute on function private.moderate_profile_comment(uuid, uuid, public.review_status, text) from public, anon, authenticated, service_role;
revoke execute on function private.resolve_conversation_report(uuid, text, text) from public, anon, authenticated, service_role;

create function public.moderator_read_messages(
  report_case_id uuid,
  before_timestamp timestamptz default now(),
  page_size integer default 50
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  reply_to_id uuid,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
begin
  select * into target_report from public.reports r where r.id = report_case_id;
  if not found or target_report.target_type not in ('conversation', 'message') then
    raise exception 'assigned moderation case required' using errcode = '42501';
  end if;
  perform private.require_assigned_moderation_case(
    target_report.id,
    target_report.target_type,
    target_report.target_id
  );
  return query
  select * from private.moderator_read_messages(
    report_case_id,
    before_timestamp,
    page_size
  );
end;
$$;

create function public.moderate_listing(
  report_case_id uuid,
  target_listing_id uuid,
  moderation_rationale text,
  corrected_audience public.audience default null,
  corrected_segments public.segment[] default null,
  moderated_status public.listing_status default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(report_case_id, 'listing', target_listing_id);
  perform private.moderate_listing(
    report_case_id,
    target_listing_id,
    moderation_rationale,
    corrected_audience,
    corrected_segments,
    moderated_status
  );
end;
$$;

create function public.moderate_profile(
  report_case_id uuid,
  target_profile_id uuid,
  suspend_profile boolean,
  moderation_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(report_case_id, 'profile', target_profile_id);
  perform private.moderate_profile(
    report_case_id,
    target_profile_id,
    suspend_profile,
    moderation_rationale
  );
end;
$$;

create function public.canonicalize_brand(
  report_case_id uuid,
  pending_brand_id uuid,
  canonical_brand_id uuid,
  rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(report_case_id, 'brand', pending_brand_id);
  perform private.canonicalize_brand(
    report_case_id,
    pending_brand_id,
    canonical_brand_id,
    rationale
  );
end;
$$;

create function public.review_listing_authenticity(
  report_case_id uuid,
  target_listing_id uuid,
  review_result public.authenticity_review_status,
  review_public_note text,
  review_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(report_case_id, 'listing', target_listing_id);
  perform private.review_listing_authenticity(
    report_case_id,
    target_listing_id,
    review_result,
    review_public_note,
    review_rationale
  );
end;
$$;

create function public.moderate_review(
  report_case_id uuid,
  target_review_id uuid,
  moderated_status public.review_status,
  moderation_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(report_case_id, 'review', target_review_id);
  perform private.moderate_review(
    report_case_id,
    target_review_id,
    moderated_status,
    moderation_rationale
  );
end;
$$;

create function public.moderate_profile_comment(
  report_case_id uuid,
  target_comment_id uuid,
  moderated_status public.review_status,
  moderation_rationale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_assigned_moderation_case(
    report_case_id,
    'profile_comment',
    target_comment_id
  );
  perform private.moderate_profile_comment(
    report_case_id,
    target_comment_id,
    moderated_status,
    moderation_rationale
  );
end;
$$;

create function public.resolve_conversation_report(
  report_case_id uuid,
  decision text,
  moderation_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_report public.reports%rowtype;
begin
  select * into target_report from public.reports r where r.id = report_case_id;
  if not found or target_report.target_type not in ('conversation', 'message') then
    raise exception 'assigned moderation case required' using errcode = '42501';
  end if;
  perform private.require_assigned_moderation_case(
    target_report.id,
    target_report.target_type,
    target_report.target_id
  );
  return private.resolve_conversation_report(
    report_case_id,
    decision,
    moderation_rationale
  );
end;
$$;

drop policy if exists reports_reporter_read on public.reports;
drop policy if exists reports_staff_queue_read on public.reports;
drop policy if exists reports_staff_update on public.reports;
drop policy if exists moderation_audit_staff_read on public.moderation_audit;

alter table public.reports enable row level security;
alter table public.moderation_audit enable row level security;

revoke select, update, delete, truncate on public.reports from authenticated;
grant insert on public.reports to authenticated;
revoke select, insert, update, delete, truncate on public.moderation_audit from authenticated;

revoke execute on function public.list_my_reports(integer, integer, public.report_status) from public, anon, service_role;
revoke execute on function public.list_moderation_report_queue(integer, integer) from public, anon, service_role;
revoke execute on function public.claim_moderation_report(uuid) from public, anon, service_role;
revoke execute on function public.get_assigned_moderation_case(uuid) from public, anon, service_role;
revoke execute on function public.resolve_unsupported_report(uuid, text) from public, anon, service_role;
grant execute on function public.list_my_reports(integer, integer, public.report_status) to authenticated;
grant execute on function public.list_moderation_report_queue(integer, integer) to authenticated;
grant execute on function public.claim_moderation_report(uuid) to authenticated;
grant execute on function public.get_assigned_moderation_case(uuid) to authenticated;
grant execute on function public.resolve_unsupported_report(uuid, text) to authenticated;

revoke execute on function public.moderator_read_messages(uuid, timestamptz, integer) from public, anon, service_role;
revoke execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) from public, anon, service_role;
revoke execute on function public.moderate_profile(uuid, uuid, boolean, text) from public, anon, service_role;
revoke execute on function public.canonicalize_brand(uuid, uuid, uuid, text) from public, anon, service_role;
revoke execute on function public.review_listing_authenticity(uuid, uuid, public.authenticity_review_status, text, text) from public, anon, service_role;
revoke execute on function public.moderate_review(uuid, uuid, public.review_status, text) from public, anon, service_role;
revoke execute on function public.moderate_profile_comment(uuid, uuid, public.review_status, text) from public, anon, service_role;
revoke execute on function public.resolve_conversation_report(uuid, text, text) from public, anon, service_role;
grant execute on function public.moderator_read_messages(uuid, timestamptz, integer) to authenticated;
grant execute on function public.moderate_listing(uuid, uuid, text, public.audience, public.segment[], public.listing_status) to authenticated;
grant execute on function public.moderate_profile(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.canonicalize_brand(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.review_listing_authenticity(uuid, uuid, public.authenticity_review_status, text, text) to authenticated;
grant execute on function public.moderate_review(uuid, uuid, public.review_status, text) to authenticated;
grant execute on function public.moderate_profile_comment(uuid, uuid, public.review_status, text) to authenticated;
grant execute on function public.resolve_conversation_report(uuid, text, text) to authenticated;

revoke execute on function public.validate_moderation_audit_insert() from public, anon, authenticated, service_role;
revoke execute on function public.validate_message_write() from public, anon, authenticated, service_role;
revoke execute on function public.can_read_report_evidence(text) from public, anon, authenticated, service_role;
grant execute on function public.can_read_report_evidence(text) to authenticated;

commit;
