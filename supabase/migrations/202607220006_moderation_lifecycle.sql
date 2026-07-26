begin;

-- A report and its audit trail form one durable case.  Removing a report would
-- detach the evidence that authorized moderator access, so the FK is restrictive.
alter table public.moderation_audit
  drop constraint if exists moderation_audit_report_id_fkey;
alter table public.moderation_audit
  add constraint moderation_audit_report_id_fkey
  foreign key (report_id) references public.reports(id) on delete restrict;

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
     or not public.is_staff()
  then
    raise exception 'an active staff actor is required for moderation audit events'
      using errcode = '42501';
  end if;

  -- Merchant applications are already a first-class reviewed case with their
  -- own immutable applicant record. Every content/user action needs a report.
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
  if report_record.assigned_to is distinct from new.actor_id and not public.is_admin() then
    raise exception 'moderation report is assigned to another actor'
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

create trigger validate_moderation_audit_insert
before insert on public.moderation_audit
for each row execute function public.validate_moderation_audit_insert();

create trigger moderation_audit_append_only
before update or delete on public.moderation_audit
for each row execute function public.reject_append_only_mutation();

create trigger catalog_sync_runs_append_only
before update or delete on public.catalog_sync_runs
for each row execute function public.reject_append_only_mutation();

-- Staff can no longer mutate public review/comment visibility through generic
-- table UPDATE.  The report-bound RPCs below are the sole paths.
drop policy if exists reviews_staff_moderate on public.reviews;
drop policy if exists profile_comments_staff_moderate on public.profile_comments;
drop policy if exists merchant_staff_review on public.merchant_applications;

create unique index reports_one_live_deal_dispute_idx
  on public.reports (target_id)
  where target_type = 'deal'
    and reason_code = 'deal_dispute'
    and status in ('open', 'investigating');

-- A dispute report and the corresponding deal state must be created by the
-- same transaction. This prevents a direct reports INSERT from reserving the
-- unique live-case slot while the deal is still confirmable.
create or replace function public.validate_deal_dispute_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'deal'
     and new.reason_code = 'deal_dispute'
     and not exists (
       select 1
       from public.deals d
       where d.id = new.target_id
         and d.status = 'disputed'
         and new.reporter_id in (d.party_a_id, d.party_b_id)
     )
  then
    raise exception 'deal disputes require the atomic dispute workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger aa_validate_deal_dispute_report
before insert on public.reports
for each row execute function public.validate_deal_dispute_report();

create or replace function public.open_deal_dispute(
  target_deal_id uuid,
  details text
)
returns table (deal_id uuid, report_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  deal_record public.deals%rowtype;
  existing_report_id uuid;
  created_report_id uuid;
begin
  perform public.assert_active_beta_user();
  if char_length(btrim(coalesce(details, ''))) not between 10 and 4000 then
    raise exception 'dispute details must contain 10 to 4000 characters'
      using errcode = '22023';
  end if;

  -- The deal row is the concurrency lock. A second participant racing the
  -- first observes the disputed state and receives the same live report id.
  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found
     or requesting_user not in (deal_record.party_a_id, deal_record.party_b_id)
  then
    raise exception 'deal is not available to this participant'
      using errcode = '42501';
  end if;

  if deal_record.status = 'disputed' then
    select r.id into existing_report_id
    from public.reports r
    where r.target_type = 'deal'
      and r.target_id = target_deal_id
      and r.reason_code = 'deal_dispute'
      and r.status in ('open', 'investigating')
    order by r.created_at
    limit 1;
    if existing_report_id is null then
      raise exception 'disputed deal has no live moderation case'
        using errcode = '23514';
    end if;
    return query select target_deal_id, existing_report_id;
    return;
  end if;
  if deal_record.status <> 'pending_confirmation' then
    raise exception 'only a deal awaiting confirmation can be disputed'
      using errcode = '23514';
  end if;

  update public.deals
  set status = 'disputed', disputed_at = statement_timestamp()
  where id = target_deal_id;

  insert into public.reports (
    reporter_id, target_type, target_id, reason_code, details, status, created_at
  ) values (
    requesting_user, 'deal', target_deal_id, 'deal_dispute', btrim(details),
    'open', statement_timestamp()
  ) returning id into created_report_id;

  return query select target_deal_id, created_report_id;
end;
$$;

create or replace function public.resolve_deal_dispute(
  report_case_id uuid,
  target_deal_id uuid,
  resolution_status public.deal_status,
  rationale text
)
returns public.deals
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_staff uuid := auth.uid();
  target_report public.reports%rowtype;
  deal_record public.deals%rowtype;
  updated_deal public.deals%rowtype;
  normalized_rationale text := btrim(coalesce(rationale, ''));
  report_resolution_code text;
begin
  if not public.is_staff() then
    raise exception 'active staff role required' using errcode = '42501';
  end if;
  if resolution_status not in ('pending_confirmation', 'cancelled') then
    raise exception 'a dispute may only resume confirmation or cancel the deal'
      using errcode = '22023';
  end if;
  if char_length(normalized_rationale) not between 10 and 4000
     or (
       resolution_status = 'cancelled'
       and char_length(normalized_rationale) > 1000
     )
  then
    raise exception 'resolution rationale has an invalid length'
      using errcode = '22023';
  end if;

  select * into target_report
  from public.reports r
  where r.id = report_case_id
  for update;
  if not found
     or target_report.target_type <> 'deal'
     or target_report.target_id <> target_deal_id
     or target_report.status <> 'investigating'
     or target_report.assigned_to is distinct from requesting_staff
  then
    raise exception 'an assigned investigating deal report is required'
      using errcode = '42501';
  end if;

  select * into deal_record
  from public.deals d
  where d.id = target_deal_id
  for update;
  if not found or deal_record.status <> 'disputed' then
    raise exception 'the reported deal is not disputed' using errcode = '23514';
  end if;

  -- Any pre-dispute assent is stale. Both parties must explicitly reconfirm if
  -- the deal resumes, and cancellation must leave no confirmation residue.
  delete from public.deal_confirmations where deal_id = target_deal_id;

  if resolution_status = 'pending_confirmation' then
    update public.deals
    set status = 'pending_confirmation'
    where id = target_deal_id
    returning * into updated_deal;
    report_resolution_code := 'deal_confirmation_resumed';
  else
    -- Lock inventory in deterministic order before the deal state trigger
    -- releases deal_listing_locks, then unwind every reserved workflow surface.
    perform l.id
    from public.listings l
    where l.id in (deal_record.listing_id, deal_record.offered_listing_id)
    order by l.id
    for update;

    update public.deals
    set status = 'cancelled',
        cancelled_at = statement_timestamp(),
        cancelled_by = requesting_staff,
        cancellation_reason = normalized_rationale
    where id = target_deal_id
    returning * into updated_deal;

    delete from public.deal_listing_locks where deal_id = target_deal_id;
    update public.listings
    set status = 'paused'
    where id in (deal_record.listing_id, deal_record.offered_listing_id)
      and status = 'reserved';
    update public.conversations
    set status = 'archived'
    where accepted_offer_id = deal_record.accepted_offer_id;
    report_resolution_code := 'deal_cancelled_after_dispute';
  end if;

  -- protect_report_case() validates this transition and the foundation audit
  -- trigger writes the append-only report_resolved event in the same transaction.
  update public.reports
  set status = 'resolved',
      resolution_code = report_resolution_code,
      resolution_notes = normalized_rationale
  where id = target_report.id;

  return updated_deal;
end;
$$;

create or replace function public.review_merchant_application(
  target_application_id uuid,
  target_status public.merchant_application_status,
  review_notes text default null
)
returns public.merchant_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_staff uuid := auth.uid();
  application_record public.merchant_applications%rowtype;
  updated_application public.merchant_applications%rowtype;
  normalized_notes text := nullif(btrim(coalesce(review_notes, '')), '');
begin
  if not public.is_staff() then
    raise exception 'active staff role required' using errcode = '42501';
  end if;
  if target_status not in ('under_review', 'approved', 'rejected') then
    raise exception 'invalid merchant review target status' using errcode = '22023';
  end if;
  if char_length(coalesce(normalized_notes, '')) > 4000 then
    raise exception 'merchant review notes are too long' using errcode = '22023';
  end if;

  select * into application_record
  from public.merchant_applications a
  where a.id = target_application_id
  for update;
  if not found or application_record.applicant_id = requesting_staff then
    raise exception 'merchant application is not available to this reviewer'
      using errcode = '42501';
  end if;

  if target_status = 'under_review' then
    if application_record.status <> 'submitted' then
      raise exception 'only a submitted application can be claimed'
        using errcode = '23514';
    end if;
    update public.merchant_applications
    set status = 'under_review',
        reviewer_id = requesting_staff,
        reviewer_notes = normalized_notes,
        reviewed_at = null
    where id = target_application_id
    returning * into updated_application;
  else
    if application_record.status <> 'under_review'
       or (
         application_record.reviewer_id is distinct from requesting_staff
         and not public.is_admin()
       )
       or char_length(coalesce(normalized_notes, '')) < 2
    then
      raise exception 'an assigned review with notes is required for a decision'
        using errcode = '42501';
    end if;
    update public.merchant_applications
    set status = target_status,
        reviewer_id = coalesce(application_record.reviewer_id, requesting_staff),
        reviewer_notes = normalized_notes,
        reviewed_at = statement_timestamp()
    where id = target_application_id
    returning * into updated_application;
  end if;

  return updated_application;
end;
$$;

create or replace function public.require_brand_report_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status then
    raise exception 'brand moderation requires the report-bound workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger require_brand_report_workflow
before update of status on public.brands
for each row execute function public.require_brand_report_workflow();

alter function public.canonicalize_brand(uuid, uuid, text)
  rename to canonicalize_brand_unscoped;
revoke execute on function public.canonicalize_brand_unscoped(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.canonicalize_brand(
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
declare
  target_report public.reports%rowtype;
  pending_brand public.brands%rowtype;
  canonical_brand public.brands%rowtype;
  updated_brand public.brands%rowtype;
begin
  if not public.is_staff() then
    raise exception 'active staff access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;

  select * into target_report
  from public.reports r where r.id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'brand'
     or target_report.target_id <> pending_brand_id
     or (
       target_report.assigned_to is distinct from auth.uid()
       and not public.is_admin()
     )
  then
    raise exception 'an assigned active brand report is required'
      using errcode = '42501';
  end if;

  select * into pending_brand
  from public.brands b where b.id = pending_brand_id for update;
  select * into canonical_brand
  from public.brands b where b.id = canonical_brand_id for share;
  if not found
     or pending_brand.id is null
     or pending_brand.status <> 'pending_canonicalization'
     or canonical_brand.status <> 'canonical'
     or pending_brand.id = canonical_brand.id
  then
    raise exception 'expected distinct pending and canonical brand records'
      using errcode = '23514';
  end if;

  update public.listings
  set brand_id = canonical_brand.id,
      suggested_brand_id = canonical_brand.id,
      catalog_provenance = catalog_provenance || jsonb_build_object(
        'canonicalizedFrom', pending_brand.id,
        'canonicalizedAt', statement_timestamp(),
        'canonicalizedBy', auth.uid(),
        'reportId', target_report.id
      )
  where brand_id = pending_brand.id;

  update public.brands
  set status = 'merged',
      merged_into_brand_id = canonical_brand.id,
      canonicalized_by = auth.uid(),
      canonicalized_at = statement_timestamp()
  where id = pending_brand.id
  returning * into updated_brand;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, 'brand_merged', 'brand', pending_brand.id,
    btrim(rationale), to_jsonb(pending_brand), to_jsonb(updated_brand)
  );
end;
$$;

alter function public.review_listing_authenticity(
  uuid, public.authenticity_review_status, text, text
) rename to review_listing_authenticity_unscoped;
revoke execute on function public.review_listing_authenticity_unscoped(
  uuid, public.authenticity_review_status, text, text
) from public, anon, authenticated, service_role;

create or replace function public.review_listing_authenticity(
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
declare
  target_report public.reports%rowtype;
  previous_review public.listing_authenticity_reviews%rowtype;
  updated_review public.listing_authenticity_reviews%rowtype;
begin
  if not public.is_staff() then
    raise exception 'active staff access required' using errcode = '42501';
  end if;
  if review_result = 'pending' then
    raise exception 'review result must be final' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(review_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;

  select * into target_report
  from public.reports r where r.id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'listing'
     or target_report.target_id <> target_listing_id
     or (
       target_report.assigned_to is distinct from auth.uid()
       and not public.is_admin()
     )
  then
    raise exception 'an assigned active listing report is required'
      using errcode = '42501';
  end if;

  select * into previous_review
  from public.listing_authenticity_reviews ar
  where ar.listing_id = target_listing_id
  for update;
  if not found then
    raise exception 'authenticity review request not found' using errcode = 'P0002';
  end if;

  update public.listing_authenticity_reviews
  set status = review_result,
      public_note = nullif(btrim(review_public_note), ''),
      reviewed_at = statement_timestamp()
  where listing_id = target_listing_id
  returning * into updated_review;

  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, 'authenticity_reviewed', 'listing',
    target_listing_id, btrim(review_rationale),
    to_jsonb(previous_review), to_jsonb(updated_review)
  );
end;
$$;

create or replace function public.moderate_review(
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
declare
  target_report public.reports%rowtype;
  previous_review public.reviews%rowtype;
  updated_review public.reviews%rowtype;
  audit_action public.moderation_action;
begin
  if not public.is_staff() then
    raise exception 'active staff access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;
  select * into target_report
  from public.reports r where r.id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'review'
     or target_report.target_id <> target_review_id
     or (
       target_report.assigned_to is distinct from auth.uid()
       and not public.is_admin()
     )
  then
    raise exception 'an assigned active review report is required'
      using errcode = '42501';
  end if;

  select * into previous_review
  from public.reviews r where r.id = target_review_id for update;
  if not found then raise exception 'review not found' using errcode = 'P0002'; end if;
  if moderated_status is null or moderated_status = previous_review.status then
    raise exception 'a different review status is required' using errcode = '23514';
  end if;
  update public.reviews set status = moderated_status
  where id = target_review_id returning * into updated_review;
  audit_action := case moderated_status
    when 'published' then 'content_restored'::public.moderation_action
    when 'hidden' then 'content_hidden'::public.moderation_action
    else 'content_removed'::public.moderation_action
  end;
  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, 'review', target_review_id,
    btrim(moderation_rationale), to_jsonb(previous_review), to_jsonb(updated_review)
  );
end;
$$;

create or replace function public.moderate_profile_comment(
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
declare
  target_report public.reports%rowtype;
  previous_comment public.profile_comments%rowtype;
  updated_comment public.profile_comments%rowtype;
  audit_action public.moderation_action;
begin
  if not public.is_staff() then
    raise exception 'active staff access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(moderation_rationale, ''))) < 10 then
    raise exception 'a concrete moderation rationale is required'
      using errcode = '23514';
  end if;
  select * into target_report
  from public.reports r where r.id = report_case_id for update;
  if not found
     or target_report.status <> 'investigating'
     or target_report.target_type <> 'profile_comment'
     or target_report.target_id <> target_comment_id
     or (
       target_report.assigned_to is distinct from auth.uid()
       and not public.is_admin()
     )
  then
    raise exception 'an assigned active profile-comment report is required'
      using errcode = '42501';
  end if;

  select * into previous_comment
  from public.profile_comments pc where pc.id = target_comment_id for update;
  if not found then
    raise exception 'profile comment not found' using errcode = 'P0002';
  end if;
  if moderated_status is null or moderated_status = previous_comment.status then
    raise exception 'a different comment status is required' using errcode = '23514';
  end if;
  update public.profile_comments set status = moderated_status
  where id = target_comment_id returning * into updated_comment;
  audit_action := case moderated_status
    when 'published' then 'content_restored'::public.moderation_action
    when 'hidden' then 'content_hidden'::public.moderation_action
    else 'content_removed'::public.moderation_action
  end;
  insert into public.moderation_audit (
    actor_id, report_id, action, target_type, target_id, rationale,
    before_data, after_data
  ) values (
    auth.uid(), target_report.id, audit_action, 'profile_comment',
    target_comment_id, btrim(moderation_rationale),
    to_jsonb(previous_comment), to_jsonb(updated_comment)
  );
end;
$$;

revoke insert, update, delete, truncate on public.moderation_audit from authenticated;
revoke update, delete, truncate on public.moderation_audit from service_role;
revoke update, delete, truncate on public.catalog_sync_runs from authenticated, service_role;
revoke delete on public.reports from authenticated, service_role;

revoke execute on function public.validate_moderation_audit_insert()
  from public, anon, authenticated;
revoke execute on function public.validate_deal_dispute_report()
  from public, anon, authenticated;
revoke execute on function public.require_brand_report_workflow()
  from public, anon, authenticated;
revoke execute on function public.open_deal_dispute(uuid, text) from public, anon;
revoke execute on function public.resolve_deal_dispute(
  uuid, uuid, public.deal_status, text
) from public, anon, service_role;
revoke execute on function public.review_merchant_application(
  uuid, public.merchant_application_status, text
) from public, anon, service_role;

revoke execute on function public.canonicalize_brand(uuid, uuid, uuid, text)
  from public, anon;
revoke execute on function public.review_listing_authenticity(
  uuid, uuid, public.authenticity_review_status, text, text
) from public, anon;
revoke execute on function public.moderate_review(
  uuid, uuid, public.review_status, text
) from public, anon;
revoke execute on function public.moderate_profile_comment(
  uuid, uuid, public.review_status, text
) from public, anon;

grant execute on function public.canonicalize_brand(uuid, uuid, uuid, text)
  to authenticated;
grant execute on function public.review_listing_authenticity(
  uuid, uuid, public.authenticity_review_status, text, text
) to authenticated;
grant execute on function public.moderate_review(
  uuid, uuid, public.review_status, text
) to authenticated;
grant execute on function public.moderate_profile_comment(
  uuid, uuid, public.review_status, text
) to authenticated;
grant execute on function public.open_deal_dispute(uuid, text) to authenticated;
grant execute on function public.resolve_deal_dispute(
  uuid, uuid, public.deal_status, text
) to authenticated;
grant execute on function public.review_merchant_application(
  uuid, public.merchant_application_status, text
) to authenticated;

comment on table public.moderation_audit is
  'Append-only report-bound moderation ledger; merchant application decisions are the sole non-report exception.';

commit;
