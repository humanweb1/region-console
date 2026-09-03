do $$
declare
  turkey_id uuid;
  istanbul_id uuid;
  role_id uuid;
begin
  select id into turkey_id from public.regions where type='country' and is_active and lower(name)='turkey' order by updated_at desc limit 1;
  select id into istanbul_id from public.regions where type='province' and is_active and lower(name)='istanbul' and parent_id=turkey_id order by updated_at desc limit 1;

  if turkey_id is null or istanbul_id is null then
    raise exception 'Canonical Turkey/Istanbul catalog rows not found';
  end if;

  update public.role_scopes rs
     set country_id = turkey_id,
         province_id = istanbul_id,
         district_id = null
   where rs.role_id = (select id from public.roles where name='istanbul_city_manager' limit 1);

  update public.region_console_state s
     set state = jsonb_set(
       s.state,
       '{custom}',
       coalesce((
         select jsonb_agg(
           case
             when r->'hierarchy'->>'type' = 'province' then
               jsonb_set(
                 jsonb_set(
                   r,
                   '{hierarchy,provinceId}',
                   to_jsonb(coalesce((
                     select cat.id::text
                     from public.regions cat
                     where cat.type='province'
                       and cat.is_active
                       and lower(cat.name)=lower(r->>'name')
                       and cat.parent_id=turkey_id
                     order by cat.updated_at desc
                     limit 1
                   ), r->'hierarchy'->>'provinceId'))
                 ),
                 '{hierarchy,countryId}',
                 to_jsonb(turkey_id::text)
               )
             else r
           end
         )
         from jsonb_array_elements(coalesce(s.state->'custom','[]'::jsonb)) r
       ), '[]'::jsonb),
       true
     ),
     version = extract(epoch from clock_timestamp())::bigint,
     updated_at = now()
   where s.id='main';

  update public.regions orphan
     set is_active=false,
         updated_at=now()
   where orphan.type='province'
     and orphan.is_active
     and orphan.parent_id is null
     and exists (
       select 1
       from public.regions canonical
       where canonical.type='province'
         and canonical.is_active
         and canonical.parent_id is not null
         and lower(canonical.name)=lower(orphan.name)
     );
end $$;