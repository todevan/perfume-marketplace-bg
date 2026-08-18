begin;

create or replace function private.is_valid_city(city_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select city_value is not null
    and city_value = private.normalize_city(city_value)
    and char_length(city_value) between 2 and 100
    and city_value ~ '[[:alnum:]]'
    and city_value ~ '^[-[:alnum:] '']+$';
$$;

revoke execute on function private.is_valid_city(text) from public, anon;
grant execute on function private.is_valid_city(text) to authenticated, service_role;

commit;
