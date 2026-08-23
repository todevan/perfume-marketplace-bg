create or replace function public.claim_notification_email_delivery(
  target_notification_id uuid,
  worker_request_id text
)
returns public.notification_email_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_email_deliveries%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce($2, ''))) not between 8 and 200 then
    raise exception 'worker request id is invalid' using errcode = '22023';
  end if;

  select * into delivery
  from public.notification_email_deliveries d
  where d.notification_id = target_notification_id
  for update;
  if not found then
    raise exception 'notification email delivery was not found'
      using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.notifications n
    where n.id = target_notification_id
      and n.kind = 'deal_confirmation_needed'
  ) then
    raise exception 'legacy deal confirmation email delivery is suppressed'
      using errcode = '42501';
  end if;
  if delivery.status = 'sent'
     or (
       delivery.status = 'processing'
       and delivery.worker_request_id = btrim($2)
     )
  then
    return delivery;
  end if;
  if delivery.status = 'processing'
     and delivery.claimed_at > statement_timestamp() - interval '15 minutes'
  then
    raise exception 'notification email delivery is already claimed'
      using errcode = '55P03';
  end if;

  update public.notification_email_deliveries
  set status = 'processing',
      attempts = attempts + 1,
      worker_request_id = btrim($2),
      last_error_code = null,
      claimed_at = statement_timestamp(),
      last_attempt_at = statement_timestamp(),
      sent_at = null,
      failed_at = null,
      updated_at = statement_timestamp()
  where notification_id = target_notification_id
  returning * into delivery;
  return delivery;
end;
$$;

revoke execute on function public.claim_notification_email_delivery(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_notification_email_delivery(uuid, text)
  to service_role;
