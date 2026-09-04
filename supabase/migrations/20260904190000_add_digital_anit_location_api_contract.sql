create or replace function public.resolve_memorial_location(p_grave_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  g record;
  cemetery record;
  section record;
  neighborhood record;
  district record;
  province record;
  country record;
  inside_cemetery boolean;
  inside_section boolean;
begin
  select gr.id, gr.cemetery_id, gr.section_id, gr.sequence_no, gr.label, gr.code,
         gr.latitude, gr.longitude, gr.status
    into g
  from public.graves gr
  where gr.id = p_grave_id and gr.is_active;
  if not found then raise exception 'GRAVE_NOT_FOUND'; end if;

  select c.id, c.region_id, c.name, c.code, c.external_id, c.geometry,
         c.geometry_status, c.geometry_source, c.geometry_version
    into cemetery
  from public.cemeteries c
  where c.id = g.cemetery_id and c.is_active;
  if not found then raise exception 'CEMETERY_NOT_FOUND'; end if;

  if g.section_id is not null then
    select s.id, s.cemetery_id, s.name, s.code, s.geometry,
           s.geometry_status, s.geometry_source, s.geometry_version
      into section
    from public.cemetery_sections s
    where s.id = g.section_id and s.cemetery_id = g.cemetery_id and s.is_active;
  end if;

  select r.* into neighborhood from public.regions r
    where r.id = cemetery.region_id and r.is_active and r.type = 'neighborhood';
  if found then
    select r.* into district from public.regions r where r.id = neighborhood.parent_id and r.is_active and r.type = 'district';
  end if;
  if district.id is not null then
    select r.* into province from public.regions r where r.id = district.parent_id and r.is_active and r.type = 'province';
  end if;
  if province.id is not null then
    select r.* into country from public.regions r where r.id = province.parent_id and r.is_active and r.type = 'country';
  end if;

  inside_cemetery := null;
  inside_section := null;
  if g.latitude is not null and g.longitude is not null and cemetery.geometry is not null then
    inside_cemetery := public.region_console_point_in_geometry(g.longitude, g.latitude, cemetery.geometry);
  end if;
  if g.latitude is not null and g.longitude is not null and section.geometry is not null then
    inside_section := public.region_console_point_in_geometry(g.longitude, g.latitude, section.geometry);
  end if;

  result := jsonb_build_object(
    'grave', jsonb_build_object(
      'id', g.id, 'sequence_no', g.sequence_no, 'label', g.label, 'code', g.code,
      'latitude', g.latitude, 'longitude', g.longitude, 'status', g.status,
      'inside_cemetery', inside_cemetery, 'inside_section', inside_section
    ),
    'cemetery', jsonb_build_object(
      'id', cemetery.id, 'name', cemetery.name, 'code', cemetery.code, 'external_id', cemetery.external_id,
      'geometry', cemetery.geometry, 'geometry_status', cemetery.geometry_status,
      'geometry_source', cemetery.geometry_source, 'geometry_version', cemetery.geometry_version
    ),
    'section', case when section.id is null then null else jsonb_build_object(
      'id', section.id, 'name', section.name, 'code', section.code,
      'geometry', section.geometry, 'geometry_status', section.geometry_status,
      'geometry_source', section.geometry_source, 'geometry_version', section.geometry_version
    ) end,
    'hierarchy', jsonb_build_object(
      'country', case when country.id is null then null else jsonb_build_object('id', country.id, 'external_id', country.external_id, 'name', country.name) end,
      'province', case when province.id is null then null else jsonb_build_object('id', province.id, 'external_id', province.external_id, 'name', province.name) end,
      'district', case when district.id is null then null else jsonb_build_object('id', district.id, 'external_id', district.external_id, 'name', district.name) end,
      'neighborhood', case when neighborhood.id is null then null else jsonb_build_object('id', neighborhood.id, 'external_id', neighborhood.external_id, 'name', neighborhood.name) end
    )
  );
  return result;
end;
$$;

revoke all on function public.resolve_memorial_location(uuid) from public, anon, authenticated;
grant execute on function public.resolve_memorial_location(uuid) to service_role;

insert into public.roles (name, description)
values ('digital_anit_api', 'Digital Anıt backend entegrasyonu için salt-okunur API rolü')
on conflict (name) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission)
select id, 'integrations.digital_anit.resolve'
from public.roles where name = 'digital_anit_api'
on conflict (role_id, permission) do nothing;
