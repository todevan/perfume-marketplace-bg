begin;

create or replace function private.normalize_profile_city(raw_city text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  city_character text;
  code_point integer;
  mapped_city text := '';
  normalized_city text;
begin
  -- A valid 100-code-point city occupies at most 400 bytes in UTF-8.
  if pg_catalog.octet_length(raw_city) > 400 then
    return null;
  end if;

  for city_character in
    select parts.city_character
    from pg_catalog.regexp_split_to_table(raw_city, '') as parts(city_character)
  loop
    code_point := pg_catalog.ascii(city_character);

    if code_point between x'0000'::integer and x'001F'::integer
       or code_point between x'007F'::integer and x'009F'::integer
       or code_point = x'00AD'::integer
       or code_point between x'0600'::integer and x'0605'::integer
       or code_point = x'061C'::integer
       or code_point = x'06DD'::integer
       or code_point = x'070F'::integer
       or code_point between x'0890'::integer and x'0891'::integer
       or code_point = x'08E2'::integer
       or code_point = x'180E'::integer
       or code_point between x'200B'::integer and x'200F'::integer
       or code_point between x'202A'::integer and x'202E'::integer
       or code_point between x'2060'::integer and x'2064'::integer
       or code_point between x'2066'::integer and x'206F'::integer
       or code_point = x'FEFF'::integer
       or code_point between x'FFF9'::integer and x'FFFB'::integer
       or code_point = x'110BD'::integer
       or code_point = x'110CD'::integer
       or code_point between x'13430'::integer and x'1343F'::integer
       or code_point between x'1BCA0'::integer and x'1BCA3'::integer
       or code_point between x'1D173'::integer and x'1D17A'::integer
       or code_point = x'E0001'::integer
       or code_point between x'E0020'::integer and x'E007F'::integer
    then
      return null;
    end if;

    if code_point in (
      x'0020'::integer,
      x'00A0'::integer,
      x'1680'::integer,
      x'2000'::integer,
      x'2001'::integer,
      x'2002'::integer,
      x'2003'::integer,
      x'2004'::integer,
      x'2005'::integer,
      x'2006'::integer,
      x'2007'::integer,
      x'2008'::integer,
      x'2009'::integer,
      x'200A'::integer,
      x'202F'::integer,
      x'205F'::integer,
      x'3000'::integer
    ) then
      mapped_city := mapped_city || ' ';
    else
      mapped_city := mapped_city || city_character;
    end if;
  end loop;

  normalized_city := pg_catalog.btrim(
    pg_catalog.regexp_replace(mapped_city, ' +', ' ', 'g')
  );

  if pg_catalog.char_length(normalized_city) not between 2 and 100
     or normalized_city !~ '[[:alnum:]]'
  then
    return null;
  end if;

  return normalized_city;
end;
$$;

revoke all on function private.normalize_profile_city(text)
  from public, anon, authenticated, service_role;

commit;
