begin;

revoke insert on table public.deal_confirmations from authenticated;

commit;
