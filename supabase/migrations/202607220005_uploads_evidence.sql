begin;

create type public.upload_quarantine_status as enum (
  'pending', 'processing', 'finalized', 'rejected', 'expired'
);

create table public.upload_quarantine (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  requested_role public.photo_role not null,
  bucket_id text not null default 'listing-image-quarantine'
    check (bucket_id = 'listing-image-quarantine'),
  quarantine_path text not null unique,
  declared_mime_type text not null check (
    declared_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
  ),
  declared_byte_size integer not null check (declared_byte_size between 1 and 10485760),
  status public.upload_quarantine_status not null default 'pending',
  processor_request_id text,
  final_storage_path text unique,
  rejection_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  claimed_at timestamptz,
  finalized_at timestamptz,
  rejected_at timestamptz,
  constraint upload_quarantine_path_shape check (
    quarantine_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/source\.(jpg|png|webp|avif)$'
  ),
  constraint upload_quarantine_window check (expires_at > created_at),
  constraint upload_quarantine_state_shape check (
    (
      status = 'pending'
      and claimed_at is null
      and finalized_at is null
      and rejected_at is null
      and processor_request_id is null
      and final_storage_path is null
      and rejection_code is null
    )
    or (
      status = 'processing'
      and claimed_at is not null
      and processor_request_id is not null
      and finalized_at is null
      and rejected_at is null
      and final_storage_path is null
      and rejection_code is null
    )
    or (
      status = 'finalized'
      and claimed_at is not null
      and processor_request_id is not null
      and finalized_at is not null
      and rejected_at is null
      and final_storage_path is not null
      and rejection_code is null
    )
    or (
      status in ('rejected', 'expired')
      and finalized_at is null
      and rejected_at is not null
      and rejection_code is not null
      and final_storage_path is null
    )
  )
);

create unique index upload_quarantine_processor_request_idx
  on public.upload_quarantine (processor_request_id)
  where processor_request_id is not null;
create index upload_quarantine_owner_idx
  on public.upload_quarantine (uploader_id, status, created_at desc);
create index upload_quarantine_expiry_idx
  on public.upload_quarantine (expires_at)
  where status in ('pending', 'processing');

create table public.upload_cleanup_queue (
  id bigint generated always as identity primary key,
  upload_id uuid references public.upload_quarantine(id) on delete set null,
  bucket_id text not null check (
    bucket_id in ('listing-image-quarantine', 'listing-images')
  ),
  storage_path text not null,
  reason text not null check (char_length(reason) between 2 and 80),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text check (char_length(processing_error) <= 1000)
);

create unique index upload_cleanup_queue_pending_path_idx
  on public.upload_cleanup_queue (bucket_id, storage_path)
  where processed_at is null;
create index upload_cleanup_queue_pending_idx
  on public.upload_cleanup_queue (created_at)
  where processed_at is null;

alter table public.listing_photos
  add column source_upload_id uuid unique
    references public.upload_quarantine(id) on delete restrict;

alter table public.listing_photos
  add constraint listing_photo_requires_quarantine_source
  check (source_upload_id is not null) not valid;

create or replace function public.protect_upload_quarantine_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
    new.expires_at := statement_timestamp() + interval '1 hour';
    if new.status <> 'pending'
       or new.claimed_at is not null
       or new.finalized_at is not null
       or new.rejected_at is not null
       or new.processor_request_id is not null
       or new.final_storage_path is not null
       or new.rejection_code is not null
    then
      raise exception 'new uploads must start in quarantine' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.uploader_id is distinct from old.uploader_id
     or new.listing_id is distinct from old.listing_id
     or new.requested_role is distinct from old.requested_role
     or new.bucket_id is distinct from old.bucket_id
     or new.quarantine_path is distinct from old.quarantine_path
     or new.declared_mime_type is distinct from old.declared_mime_type
     or new.declared_byte_size is distinct from old.declared_byte_size
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
  then
    raise exception 'quarantined upload identity is immutable' using errcode = '23514';
  end if;
  if old.status in ('finalized', 'rejected', 'expired') and new is distinct from old then
    raise exception 'completed upload records are terminal' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('processing', 'rejected', 'expired'))
    or (old.status = 'processing' and new.status in ('finalized', 'rejected', 'expired'))
  ) then
    raise exception 'invalid upload processing transition' using errcode = '23514';
  end if;

  if new.status = 'processing' then
    new.claimed_at := statement_timestamp();
    if new.processor_request_id is null then
      raise exception 'processing uploads require a request id' using errcode = '23514';
    end if;
  elsif new.status = 'finalized' then
    new.finalized_at := statement_timestamp();
    new.rejected_at := null;
    new.rejection_code := null;
    if new.final_storage_path is null then
      raise exception 'finalized uploads require a storage path' using errcode = '23514';
    end if;
  elsif new.status in ('rejected', 'expired') then
    new.rejected_at := statement_timestamp();
    new.finalized_at := null;
    new.final_storage_path := null;
    if new.rejection_code is null then
      new.rejection_code := case
        when new.status = 'expired' then 'quarantine_expired'
        else 'processor_rejected'
      end;
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_upload_quarantine_workflow
before insert or update on public.upload_quarantine
for each row execute function public.protect_upload_quarantine_workflow();

create or replace function public.protect_listing_photo_processing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and (
      new.source_upload_id is not null
      or new.content_hash is not null
      or new.mime_type is not null
      or new.byte_size is not null
      or new.width_px is not null
      or new.height_px is not null
      or new.sanitized_at is not null
    ) then
      raise exception 'photo finalization fields are processor-managed'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.storage_path is distinct from old.storage_path
      or new.source_upload_id is distinct from old.source_upload_id
      or new.content_hash is distinct from old.content_hash
      or new.mime_type is distinct from old.mime_type
      or new.byte_size is distinct from old.byte_size
      or new.width_px is distinct from old.width_px
      or new.height_px is distinct from old.height_px
      or new.sanitized_at is distinct from old.sanitized_at
    ) then
      raise exception 'finalized photo identity is processor-managed'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.create_listing_upload(
  target_listing_id uuid,
  requested_role public.photo_role,
  declared_mime_type text,
  declared_byte_size integer
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
  requesting_user uuid := auth.uid();
  created_upload_id uuid := gen_random_uuid();
  target_path text;
  target_extension text;
  target_expiry timestamptz := statement_timestamp() + interval '1 hour';
begin
  perform public.assert_active_beta_user();
  if declared_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
     or declared_byte_size not between 1 and 10485760
  then
    raise exception 'unsupported upload MIME type or declared size'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.listings l
    where l.id = target_listing_id
      and l.seller_id = requesting_user
      and l.kind = 'offer'
      and l.status in ('draft', 'paused')
  ) then
    raise exception 'uploads require an owned draft or paused offer listing'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-upload:' || requesting_user::text, 20260722)
  );
  if (
    select count(*) from public.upload_quarantine q
    where q.uploader_id = requesting_user
      and q.created_at >= statement_timestamp() - interval '1 hour'
  ) >= 20 then
    raise exception 'hourly upload rate limit reached' using errcode = '54000';
  end if;
  if (
    select count(*) from public.upload_quarantine q
    where q.uploader_id = requesting_user
      and q.status in ('pending', 'processing')
      and q.expires_at > statement_timestamp()
  ) >= 8 then
    raise exception 'too many uploads are awaiting processing' using errcode = '54000';
  end if;

  target_extension := case declared_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  target_path := requesting_user::text || '/' || target_listing_id::text || '/'
    || created_upload_id::text || '/source.' || target_extension;

  insert into public.upload_quarantine (
    id, uploader_id, listing_id, requested_role, bucket_id, quarantine_path,
    declared_mime_type, declared_byte_size, expires_at
  ) values (
    created_upload_id, requesting_user, target_listing_id, requested_role,
    'listing-image-quarantine', target_path, declared_mime_type,
    declared_byte_size, target_expiry
  );

  return query
  select created_upload_id, 'listing-image-quarantine'::text, target_path, target_expiry;
end;
$$;

create or replace function public.claim_listing_upload(
  target_upload_id uuid,
  processor_request_id text
)
returns public.upload_quarantine
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_record public.upload_quarantine%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce($2, ''))) not between 8 and 200 then
    raise exception 'processor request id is invalid' using errcode = '22023';
  end if;

  select * into upload_record
  from public.upload_quarantine q
  where q.id = target_upload_id
  for update;
  if not found
     or upload_record.status <> 'pending'
     or upload_record.expires_at <= statement_timestamp()
  then
    raise exception 'pending upload was not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = upload_record.bucket_id
      and o.name = upload_record.quarantine_path
  ) then
    raise exception 'quarantine object was not uploaded' using errcode = 'P0002';
  end if;

  update public.upload_quarantine
  set status = 'processing',
      processor_request_id = btrim($2)
  where id = target_upload_id
  returning * into upload_record;
  return upload_record;
end;
$$;

create or replace function public.finalize_listing_upload(
  target_upload_id uuid,
  final_storage_path text,
  actual_content_hash text,
  actual_mime_type text,
  actual_byte_size integer,
  actual_width_px integer,
  actual_height_px integer
)
returns public.listing_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_record public.upload_quarantine%rowtype;
  photo_record public.listing_photos%rowtype;
  expected_extension text;
  expected_path text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if actual_mime_type not in ('image/jpeg', 'image/webp', 'image/avif')
     or actual_content_hash !~ '^[a-f0-9]{64}$'
     or actual_byte_size not between 1 and 10485760
     or actual_width_px not between 1 and 10000
     or actual_height_px not between 1 and 10000
  then
    raise exception 'sanitized image metadata is invalid' using errcode = '22023';
  end if;

  select * into upload_record
  from public.upload_quarantine q
  where q.id = target_upload_id
  for update;
  if not found
     or upload_record.status <> 'processing'
     or upload_record.expires_at <= statement_timestamp()
  then
    raise exception 'claimed upload was not found or has expired' using errcode = 'P0002';
  end if;

  expected_extension := case actual_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;
  expected_path := upload_record.uploader_id::text || '/'
    || upload_record.listing_id::text || '/' || upload_record.id::text
    || '.' || expected_extension;
  if final_storage_path is distinct from expected_path then
    raise exception 'final image path is not canonical' using errcode = '23514';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'listing-images' and o.name = expected_path
  ) then
    raise exception 'sanitized final object was not uploaded' using errcode = 'P0002';
  end if;

  insert into public.listing_photos (
    listing_id, storage_path, role, content_hash, mime_type, byte_size,
    width_px, height_px, sanitized_at, source_upload_id, created_at
  ) values (
    upload_record.listing_id, expected_path, upload_record.requested_role,
    actual_content_hash, actual_mime_type, actual_byte_size,
    actual_width_px, actual_height_px, statement_timestamp(),
    upload_record.id, statement_timestamp()
  )
  returning * into photo_record;

  update public.upload_quarantine
  set status = 'finalized', final_storage_path = expected_path
  where id = upload_record.id;

  insert into public.upload_cleanup_queue (
    upload_id, bucket_id, storage_path, reason
  ) values (
    upload_record.id, upload_record.bucket_id,
    upload_record.quarantine_path, 'finalized_source_cleanup'
  ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;

  return photo_record;
end;
$$;

create or replace function public.reject_listing_upload(
  target_upload_id uuid,
  rejection_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_record public.upload_quarantine%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(rejection_code, ''))) not between 2 and 80 then
    raise exception 'rejection code is invalid' using errcode = '22023';
  end if;
  select * into upload_record
  from public.upload_quarantine q where q.id = target_upload_id for update;
  if not found then raise exception 'upload not found' using errcode = 'P0002'; end if;
  if upload_record.status in ('rejected', 'expired') then return; end if;
  if upload_record.status = 'finalized' then
    raise exception 'finalized uploads cannot be rejected' using errcode = '23514';
  end if;

  update public.upload_quarantine
  set status = 'rejected', rejection_code = btrim(rejection_code)
  where id = target_upload_id;
  insert into public.upload_cleanup_queue (upload_id, bucket_id, storage_path, reason)
  values (
    upload_record.id, upload_record.bucket_id,
    upload_record.quarantine_path, 'rejected_source_cleanup'
  ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;
end;
$$;

create or replace function public.cancel_listing_upload(target_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_record public.upload_quarantine%rowtype;
begin
  perform public.assert_active_beta_user();
  select * into upload_record
  from public.upload_quarantine q where q.id = target_upload_id for update;
  if not found
     or upload_record.uploader_id <> auth.uid()
     or upload_record.status <> 'pending'
  then
    raise exception 'pending upload is not available to this user'
      using errcode = '42501';
  end if;
  update public.upload_quarantine
  set status = 'rejected', rejection_code = 'user_cancelled'
  where id = target_upload_id;
  insert into public.upload_cleanup_queue (upload_id, bucket_id, storage_path, reason)
  values (
    upload_record.id, upload_record.bucket_id,
    upload_record.quarantine_path, 'user_cancelled'
  ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;
end;
$$;

create or replace function public.mark_upload_cleanup_complete(
  queue_id bigint,
  error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.upload_cleanup_queue
  set processed_at = case when error_message is null then statement_timestamp() else null end,
      processing_error = nullif(left(btrim(error_message), 1000), '')
  where id = queue_id and processed_at is null;
end;
$$;

create or replace function public.queue_listing_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.upload_cleanup_queue (
    upload_id, bucket_id, storage_path, reason
  ) values (
    old.source_upload_id, 'listing-images', old.storage_path,
    'listing_photo_deleted'
  ) on conflict (bucket_id, storage_path) where processed_at is null do nothing;
  return old;
end;
$$;

create trigger queue_listing_photo_cleanup
after delete on public.listing_photos
for each row execute function public.queue_listing_photo_cleanup();

alter table public.upload_quarantine enable row level security;
alter table public.upload_cleanup_queue enable row level security;

create policy upload_quarantine_owner_read on public.upload_quarantine
for select to authenticated using (uploader_id = auth.uid());

create policy upload_cleanup_service_read on public.upload_cleanup_queue
for select to service_role using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-image-quarantine', 'listing-image-quarantine', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists marketplace_listing_images_create on storage.objects;
drop policy if exists marketplace_listing_images_delete on storage.objects;
drop policy if exists marketplace_listing_images_read on storage.objects;

create policy marketplace_listing_images_read on storage.objects
for select to authenticated using (
  bucket_id = 'listing-images'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|webp|avif)$'
  and exists (
    select 1 from public.listings l
    join public.listing_photos lp on lp.listing_id = l.id
    where l.id = public.safe_uuid(split_part(name, '/', 2))
      and lp.storage_path = name
      and lp.sanitized_at is not null
      and (
        l.seller_id = auth.uid()
        or public.is_staff()
        or (
          public.is_active_beta_user()
          and
          l.status in ('active', 'reserved', 'completed')
          and private.is_active_beta_user(l.seller_id)
        )
      )
  )
);

create policy marketplace_listing_quarantine_create on storage.objects
for insert to authenticated with check (
  bucket_id = 'listing-image-quarantine'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/source\.(jpg|png|webp|avif)$'
  and exists (
    select 1 from public.upload_quarantine q
    where q.quarantine_path = name
      and q.uploader_id = auth.uid()
      and q.listing_id = public.safe_uuid(split_part(name, '/', 2))
      and q.status = 'pending'
      and q.expires_at > now()
      and (
        metadata is null
        or metadata ->> 'size' is null
        or (
          metadata ->> 'size' ~ '^[0-9]+$'
          and (metadata ->> 'size')::bigint <= q.declared_byte_size
        )
      )
  )
);

create policy marketplace_listing_quarantine_read on storage.objects
for select to authenticated using (
  bucket_id = 'listing-image-quarantine'
  and split_part(name, '/', 1) = auth.uid()::text
  and exists (
    select 1 from public.upload_quarantine q
    where q.quarantine_path = name and q.uploader_id = auth.uid()
  )
);

create policy marketplace_listing_quarantine_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'listing-image-quarantine'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
  and exists (
    select 1 from public.upload_quarantine q
    where q.quarantine_path = name
      and q.uploader_id = auth.uid()
      and q.status in ('pending', 'rejected', 'expired')
  )
);

alter policy marketplace_merchant_documents_create on storage.objects
with check (
  bucket_id = 'merchant-documents'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
);

alter policy marketplace_merchant_documents_delete on storage.objects
using (
  bucket_id = 'merchant-documents'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
);

alter policy marketplace_report_evidence_create on storage.objects
with check (
  bucket_id = 'report-evidence'
  and public.is_active_beta_user()
  and split_part(name, '/', 1) = auth.uid()::text
);

revoke insert, update on public.listing_photos from authenticated;
grant select on public.upload_quarantine to authenticated;
grant all on public.upload_quarantine, public.upload_cleanup_queue to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.protect_upload_quarantine_workflow()
  from public, anon, authenticated;
revoke execute on function public.protect_listing_photo_processing()
  from public, anon, authenticated;
revoke execute on function public.queue_listing_photo_cleanup()
  from public, anon, authenticated;

revoke execute on function public.create_listing_upload(uuid, public.photo_role, text, integer)
  from public, anon;
revoke execute on function public.cancel_listing_upload(uuid) from public, anon;
grant execute on function public.create_listing_upload(uuid, public.photo_role, text, integer)
  to authenticated;
grant execute on function public.cancel_listing_upload(uuid) to authenticated;

revoke execute on function public.claim_listing_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_listing_upload(uuid, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.reject_listing_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.mark_upload_cleanup_complete(bigint, text)
  from public, anon, authenticated;
grant execute on function public.claim_listing_upload(uuid, text) to service_role;
grant execute on function public.finalize_listing_upload(uuid, text, text, text, integer, integer, integer)
  to service_role;
grant execute on function public.reject_listing_upload(uuid, text) to service_role;
grant execute on function public.mark_upload_cleanup_complete(bigint, text) to service_role;

comment on table public.upload_quarantine is
  'Untrusted private uploads. Only a service-role processor may promote sanitized output into listing_photos.';
comment on column public.listing_photos.source_upload_id is
  'Immutable provenance link to the quarantined source and processor workflow.';

commit;
