create or replace function public.normalize_region_state_hierarchy_ids(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
  result := coalesce(p_state, '{}'::jsonb);

  result := jsonb_set(
    result,
    '{custom}',
    coalesce((
      select jsonb_agg(
        case
          when lower(coalesce(item->'hierarchy'->>'type', item->>'type',''))='province' and pr.id is not null then
            item || jsonb_build_object('hierarchy', coalesce(item->'hierarchy','{}'::jsonb) || jsonb_build_object(
              'provinceId', pr.id::text,
              'countryId', pr.parent_id::text,
              'parentId', pr.parent_id::text,
              'parentType', 'country',
              'parentName', pc.name,
              'countryName', pc.name
            ))
          when lower(coalesce(item->'hierarchy'->>'type', item->>'type',''))='district' and dr.id is not null then
            item || jsonb_build_object('hierarchy', coalesce(item->'hierarchy','{}'::jsonb) || jsonb_build_object(
              'districtId', dr.id::text,
              'provinceId', dr.parent_id::text,
              'countryId', dp.parent_id::text,
              'parentId', dr.parent_id::text,
              'parentType', 'province',
              'parentName', dp.name,
              'countryName', dc.name
            ))
          else item
        end order by ord
      )
      from jsonb_array_elements(coalesce(result->'custom','[]'::jsonb)) with ordinality as a(item,ord)
      left join public.regions pr on pr.type::text='province' and pr.external_id=a.item->>'id'
      left join public.regions pc on pc.id=pr.parent_id
      left join public.regions dr on dr.type::text='district' and dr.external_id=a.item->>'id'
      left join public.regions dp on dp.id=dr.parent_id
      left join public.regions dc on dc.id=dp.parent_id
    ), '[]'::jsonb), true
  );

  return result;
end;
$$;

create or replace function public.normalize_region_console_state_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.state := public.normalize_region_state_hierarchy_ids(new.state);
  return new;
end;
$$;

drop trigger if exists trg_normalize_region_console_state_hierarchy on public.region_console_state;
create trigger trg_normalize_region_console_state_hierarchy
before insert or update of state on public.region_console_state
for each row execute function public.normalize_region_console_state_trigger();

update public.region_console_state
set state=public.normalize_region_state_hierarchy_ids(state)
where id='main';
