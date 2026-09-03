create or replace function public.normalize_region_state_hierarchy_ids(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
          when lower(coalesce(item->'hierarchy'->>'type', item->>'type', '')) = 'province' and pr.id is not null then
            item || jsonb_build_object('hierarchy', coalesce(item->'hierarchy','{}'::jsonb) || jsonb_build_object(
              'provinceId', pr.id::text,
              'countryId', pr.parent_id::text,
              'parentId', pr.parent_id::text,
              'parentType', 'country',
              'parentName', pc.name,
              'countryName', pc.name
            ))
          when lower(coalesce(item->'hierarchy'->>'type', item->>'type', '')) = 'district' and dr.id is not null then
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
      left join lateral (
        select p.id, p.parent_id
        from public.regions p
        left join public.regions country on country.id=p.parent_id
        where p.type::text='province'
          and p.is_active
          and (
            p.external_id=item->>'id'
            or p.external_id=item->'importMeta'->'properties'->>'id'
            or lower(p.name)=lower(item->>'name')
          )
          and (
            nullif(item->'hierarchy'->>'countryName','') is null
            or lower(country.name)=lower(item->'hierarchy'->>'countryName')
          )
        order by
          case when p.external_id=item->>'id' then 0
               when p.external_id=item->'importMeta'->'properties'->>'id' then 1
               else 2 end,
          p.updated_at desc
        limit 1
      ) pr on true
      left join public.regions pc on pc.id=pr.parent_id
      left join lateral (
        select d.id, d.parent_id
        from public.regions d
        left join public.regions province on province.id=d.parent_id
        left join public.regions country on country.id=province.parent_id
        where d.type::text='district'
          and d.is_active
          and (
            d.external_id=item->>'id'
            or d.external_id=item->'importMeta'->'properties'->>'id'
            or lower(d.name)=lower(item->>'name')
          )
          and (
            nullif(item->'hierarchy'->>'parentName','') is null
            or lower(province.name)=lower(item->'hierarchy'->>'parentName')
          )
          and (
            nullif(item->'hierarchy'->>'countryName','') is null
            or lower(country.name)=lower(item->'hierarchy'->>'countryName')
          )
        order by
          case when d.external_id=item->>'id' then 0
               when d.external_id=item->'importMeta'->'properties'->>'id' then 1
               else 2 end,
          d.updated_at desc
        limit 1
      ) dr on true
      left join public.regions dp on dp.id=dr.parent_id
      left join public.regions dc on dc.id=dp.parent_id
    ), '[]'::jsonb), true
  );

  return result;
end;
$function$;

update public.region_console_state
set state = public.normalize_region_state_hierarchy_ids(state),
    version = extract(epoch from clock_timestamp())::bigint,
    updated_at = now()
where id='main';