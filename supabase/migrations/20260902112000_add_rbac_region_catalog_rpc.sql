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
    and public.user_has_region_scope(r.id)
  order by r.type::text, r.name;
$$;
revoke all on function public.get_rbac_region_catalog() from public, anon;
grant execute on function public.get_rbac_region_catalog() to authenticated;
