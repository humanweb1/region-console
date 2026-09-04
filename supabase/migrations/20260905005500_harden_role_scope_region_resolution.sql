create or replace function public.resolve_role_scope_region_id(p_external_id text,p_type text,p_name text default null)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare result_id uuid;
begin
  if nullif(btrim(p_external_id),'') is not null then
    select r.id into result_id
    from public.regions r
    where r.external_id = btrim(p_external_id)
      and lower(r.type::text) = lower(btrim(p_type))
      and r.is_active = true
    order by r.created_at desc, r.id
    limit 1;
  end if;
  if result_id is null and nullif(btrim(p_name),'') is not null then
    select r.id into result_id
    from public.regions r
    where lower(r.type::text) = lower(btrim(p_type))
      and lower(trim(r.name)) = lower(trim(p_name))
      and r.is_active = true
    order by r.created_at desc, r.id
    limit 1;
  end if;
  return result_id;
end;
$$;
revoke all on function public.resolve_role_scope_region_id(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_role_scope_region_id(text,text,text) to service_role;
