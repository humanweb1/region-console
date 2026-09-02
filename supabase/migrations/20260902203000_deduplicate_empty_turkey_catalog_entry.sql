update public.regions
set is_active=false
where id='871442ae-ac8f-47ac-9c49-ec6cb36f1c15'
  and type::text='country'
  and lower(name)='turkey'
  and not exists (
    select 1 from public.regions child
    where child.parent_id=public.regions.id
      and child.is_active=true
  );

create or replace function public.get_rbac_region_catalog()
returns table(id uuid, external_id text, type text, name text, parent_id uuid)
language sql
stable
security definer
set search_path=public
as $$
  select r.id, r.external_id, r.type::text, r.name, r.parent_id
  from public.regions r
  where r.is_active=true
    and (
      r.type::text <> 'country'
      or exists (
        select 1 from public.regions child
        where child.parent_id=r.id
          and child.is_active=true
      )
    )
  order by r.type::text, r.name;
$$;

revoke all on function public.get_rbac_region_catalog() from public, anon;
grant execute on function public.get_rbac_region_catalog() to authenticated;
