begin;

create type public.report_evidence_upload_status as enum (
  'pending',
  'finalized',
  'attached',
  'rejected',
  'expired'
);

create table public.report_evidence_uploads (
  id uuid primary key,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null default 'report-evidence' check (bucket_id = 'report-evidence'),
  storage_path text not null unique,
  source_mime_type text not null check (
    source_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
  ),
  source_byte_size bigint not null check (source_byte_size between 1 and 10485760),
  status public.report_evidence_upload_status not null default 'pending',
  actual_content_hash text,
  actual_byte_size bigint,
  actual_mime_type text,
  width_px integer,
  height_px integer,
  report_id uuid references public.reports(id) on delete cascade deferrable initially deferred,
  rejection_code text,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  attached_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint report_evidence_upload_path_shape check (
    storage_path = uploader_id::text || '/' || id::text || '.webp'
  ),
  constraint report_evidence_upload_actual_shape check (
    (
      status = 'pending'
      and actual_content_hash is null
      and actual_byte_size is null
      and actual_mime_type is null
      and width_px is null
      and height_px is null
      and report_id is null
      and finalized_at is null
      and attached_at is null
    )
    or (
      status = 'finalized'
      and actual_content_hash ~ '^[a-f0-9]{64}$'
      and actual_byte_size between 1 and 10485760
      and actual_mime_type = 'image/webp'
      and width_px between 1 and 10000
      and height_px between 1 and 10000
      and report_id is null
      and finalized_at is not null
      and attached_at is null
    )
    or (
      status = 'attached'
      and actual_content_hash ~ '^[a-f0-9]{64}$'
      and actual_byte_size between 1 and 10485760
      and actual_mime_type = 'image/webp'
      and width_px between 1 and 10000
      and height_px between 1 and 10000
      and report_id is not null
      and finalized_at is not null
      and attached_at is not null
    )
    or (
      status in ('rejected', 'expired')
      and report_id is null
    )
  ),
  constraint report_evidence_upload_rejection_shape check (
    rejection_code is null
    or (
      char_length(rejection_code) between 2 and 80
      and rejection_code ~ '^[a-zA-Z0-9_:-]+$'
    )
  )
);

create index report_evidence_upload_owner_idx
  on public.report_evidence_uploads (uploader_id, status, created_at desc);
create index report_evidence_upload_expiry_idx
  on public.report_evidence_uploads (expires_at)
  where status in ('pending', 'finalized');

alter table public.report_evidence_uploads enable row level security;
revoke all on public.report_evidence_uploads from public, anon, authenticated, service_role;
grant select on public.report_evidence_uploads to service_role;

alter table public.upload_cleanup_queue
  drop constraint if exists upload_cleanup_queue_bucket_id_check;
alter table public.upload_cleanup_queue
  add constraint upload_cleanup_queue_bucket_id_check check (
    bucket_id in ('listing-image-quarantine', 'listing-images', 'report-evidence')
  ),
  add column report_evidence_upload_id uuid
    references public.report_evidence_uploads(id) on delete set null;

create or replace function public.create_report_evidence_upload(
  source_mime_type text,
  source_byte_size bigint
)
returns table (
  upload_id uuid,
  bucket_id text,
  storage_path text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  generated_id uuid := gen_random_uuid();
  created public.report_evidence_uploads%rowtype;
begin
  if caller_id is null or not private.is_active_beta_user(caller_id) then
    raise exception 'active beta membership is required' using errcode = '42501';
  end if;
  if source_mime_type is null
    or source_byte_size is null
    or source_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
    or source_byte_size not between 1 and 10485760 then
    raise exception 'invalid report evidence declaration' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  update public.report_evidence_uploads u
  set status = 'expired',
      rejection_code = 'allocation_expired',
      updated_at = now()
  where u.uploader_id = caller_id
    and u.status in ('pending', 'finalized')
    and u.expires_at <= now();
  if (
    select count(*)
    from public.report_evidence_uploads u
    where u.uploader_id = caller_id
      and u.status in ('pending', 'finalized')
      and u.expires_at > now()
  ) >= 8 then
    raise exception 'too many active report evidence uploads' using errcode = 'P0004';
  end if;

  insert into public.report_evidence_uploads (
    id, uploader_id, storage_path, source_mime_type, source_byte_size
  ) values (
    generated_id,
    caller_id,
    caller_id::text || '/' || generated_id::text || '.webp',
    source_mime_type,
    source_byte_size
  ) returning * into created;

  return query select created.id, created.bucket_id, created.storage_path, created.expires_at;
end;
$$;

create or replace function public.finalize_report_evidence_upload(
  target_upload_id uuid,
  actual_content_hash text,
  actual_byte_size bigint,
  actual_width_px integer,
  actual_height_px integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.report_evidence_uploads%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  select * into target
  from public.report_evidence_uploads
  where id = target_upload_id
  for update;
  if not found or target.status <> 'pending' or target.expires_at <= now() then
    raise exception 'active report evidence allocation not found' using errcode = 'P0002';
  end if;
  if actual_content_hash is null
    or actual_byte_size is null
    or actual_width_px is null
    or actual_height_px is null
    or actual_content_hash !~ '^[a-f0-9]{64}$'
    or actual_byte_size not between 1 and 10485760
    or actual_width_px not between 1 and 10000
    or actual_height_px not between 1 and 10000 then
    raise exception 'invalid finalized report evidence metadata' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = target.bucket_id and o.name = target.storage_path
  ) then
    raise exception 'final report evidence object is missing' using errcode = 'P0002';
  end if;

  update public.report_evidence_uploads
  set status = 'finalized',
      actual_content_hash = finalize_report_evidence_upload.actual_content_hash,
      actual_byte_size = finalize_report_evidence_upload.actual_byte_size,
      actual_mime_type = 'image/webp',
      width_px = actual_width_px,
      height_px = actual_height_px,
      finalized_at = now(),
      updated_at = now()
  where id = target.id;
end;
$$;

create or replace function public.reject_report_evidence_upload(
  target_upload_id uuid,
  rejection_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if rejection_code is null or rejection_code !~ '^[a-zA-Z0-9_:-]{2,80}$' then
    raise exception 'invalid rejection code' using errcode = '22023';
  end if;

  update public.report_evidence_uploads
  set status = 'rejected',
      rejection_code = reject_report_evidence_upload.rejection_code,
      updated_at = now()
  where id = target_upload_id
    and status in ('pending', 'finalized');
  if not found then
    raise exception 'rejectable report evidence allocation not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.expire_report_evidence_uploads(target_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if target_limit is null or target_limit not between 1 and 100 then
    raise exception 'target_limit must be between 1 and 100' using errcode = '22023';
  end if;

  with candidates as (
    select id
    from public.report_evidence_uploads
    where status in ('pending', 'finalized')
      and expires_at <= now()
    order by expires_at, id
    for update skip locked
    limit target_limit
  )
  update public.report_evidence_uploads u
  set status = 'expired',
      rejection_code = 'allocation_expired',
      updated_at = now()
  from candidates c
  where u.id = c.id;
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.reject_unattached_report_evidence_uploads(
  target_upload_ids uuid[],
  rejection_code text
)
returns table (upload_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if target_upload_ids is null
    or cardinality(target_upload_ids) not between 1 and 4
    or array_position(target_upload_ids, null) is not null
    or rejection_code is null
    or rejection_code !~ '^[a-zA-Z0-9_:-]{2,80}$' then
    raise exception 'invalid report evidence reconciliation' using errcode = '22023';
  end if;

  return query
  update public.report_evidence_uploads u
  set status = 'rejected',
      rejection_code = reject_unattached_report_evidence_uploads.rejection_code,
      updated_at = now()
  where u.id = any(target_upload_ids)
    and u.status in ('pending', 'finalized')
  returning u.id, u.storage_path;
end;
$$;

create or replace function public.queue_report_evidence_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.upload_cleanup_queue (
      bucket_id, storage_path, reason
    ) values (
      old.bucket_id, old.storage_path, 'report_evidence_deleted'
    ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;
    return old;
  end if;
  if new.status in ('rejected', 'expired')
    and old.status is distinct from new.status then
    insert into public.upload_cleanup_queue (
      report_evidence_upload_id, bucket_id, storage_path, reason
    ) values (
      new.id, new.bucket_id, new.storage_path,
      case new.status
        when 'rejected' then 'report_evidence_rejected'
        else 'report_evidence_expired'
      end
    ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;
  end if;
  return new;
end;
$$;

create trigger queue_report_evidence_cleanup_update
after update of status on public.report_evidence_uploads
for each row execute function public.queue_report_evidence_cleanup();
create trigger queue_report_evidence_cleanup_delete
after delete on public.report_evidence_uploads
for each row execute function public.queue_report_evidence_cleanup();

create or replace function public.validate_report_evidence_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  evidence_path text;
  evidence_upload_id uuid;
begin
  if jsonb_array_length(new.evidence_paths) > 4
    or jsonb_array_length(new.evidence_paths) <> (
      select count(distinct value)
      from jsonb_array_elements_text(new.evidence_paths) evidence(value)
    ) then
    raise exception 'invalid report evidence object count' using errcode = '23514';
  end if;

  for evidence_path in select jsonb_array_elements_text(new.evidence_paths)
  loop
    if evidence_path !~ (
      '^' || auth.uid()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '[.]webp$'
    ) then
      raise exception 'report evidence is not a finalized owned object'
        using errcode = '42501';
    end if;

    select u.id into evidence_upload_id
    from public.report_evidence_uploads u
    where u.storage_path = evidence_path
      and u.uploader_id = auth.uid()
      and u.status = 'finalized'
      and u.report_id is null
      and u.expires_at > now()
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = u.bucket_id and o.name = u.storage_path
      )
    for update;
    if evidence_upload_id is null then
      raise exception 'report evidence is not a finalized owned object'
        using errcode = '42501';
    end if;

    update public.report_evidence_uploads
    set status = 'attached',
        report_id = new.id,
        attached_at = now(),
        updated_at = now()
    where id = evidence_upload_id;
  end loop;
  return new;
end;
$$;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/webp']::text[]
where id = 'report-evidence';

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
          public.is_staff(auth.uid())
          and r.status = 'investigating'
          and r.assigned_to = auth.uid()
        )
      )
  );
$$;

drop policy if exists marketplace_report_evidence_read on storage.objects;
create policy marketplace_report_evidence_read on storage.objects
for select to authenticated using (
  bucket_id = 'report-evidence'
  and public.can_read_report_evidence(name)
);
drop policy if exists marketplace_report_evidence_delete on storage.objects;

revoke execute on function public.create_report_evidence_upload(text, bigint)
  from public, anon, service_role;
grant execute on function public.create_report_evidence_upload(text, bigint)
  to authenticated;
revoke execute on function public.finalize_report_evidence_upload(uuid, text, bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_report_evidence_upload(uuid, text, bigint, integer, integer)
  to service_role;
revoke execute on function public.reject_report_evidence_upload(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_report_evidence_upload(uuid, text)
  to service_role;
revoke execute on function public.expire_report_evidence_uploads(integer)
  from public, anon, authenticated;
grant execute on function public.expire_report_evidence_uploads(integer)
  to service_role;
revoke execute on function public.reject_unattached_report_evidence_uploads(uuid[], text)
  from public, anon, authenticated;
grant execute on function public.reject_unattached_report_evidence_uploads(uuid[], text)
  to service_role;
revoke execute on function public.queue_report_evidence_cleanup()
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_report_evidence_ownership()
  from public, anon, authenticated, service_role;
revoke execute on function public.can_read_report_evidence(text)
  from public, anon, service_role;
grant execute on function public.can_read_report_evidence(text)
  to authenticated;

comment on table public.report_evidence_uploads is
  'Service-owned allocation/finalization ledger for sanitized report evidence. Paths become single-use only after attachment to a report.';
comment on function public.create_report_evidence_upload(text, bigint) is
  'Allocates one short-lived WebP report-evidence path for the active authenticated caller.';
comment on function public.finalize_report_evidence_upload(uuid, text, bigint, integer, integer) is
  'Service-only metadata commit after sanitized WebP storage upload.';
comment on function public.reject_report_evidence_upload(uuid, text) is
  'Service-only terminal rejection that queues durable storage cleanup.';
comment on function public.expire_report_evidence_uploads(integer) is
  'Service-only bounded expiry sweep that durably queues abandoned report evidence for cleanup.';
comment on function public.reject_unattached_report_evidence_uploads(uuid[], text) is
  'Service-only failure reconciliation that rejects and queues cleanup only for evidence not already attached to a committed report.';
comment on function public.can_read_report_evidence(text) is
  'Authorizes attached evidence reads for the reporter or the assigned AAL2 moderator of an investigating case.';

commit;
