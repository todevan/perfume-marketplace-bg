-- The owner-approved provisional drafts replace only the exact known current
-- Terms and Marketplace Rules versions. Historical document rows and every
-- append-only consent event remain unchanged and provable.
do $$
declare
  activation_timestamp timestamptz;
  expected_current_count integer;
  retired_count integer;
begin
  lock table public.beta_legal_documents in share row exclusive mode;
  activation_timestamp := statement_timestamp();

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
end;
$$;
