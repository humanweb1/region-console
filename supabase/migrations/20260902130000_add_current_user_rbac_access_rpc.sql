create or replace function public.get_current_user_rbac_access()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'role_id', p.role_id,
      'is_active', p.is_active
    ),
    'role', case when r.id is null then null else jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'description', r.description
    ) end,
    'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp where rp.role_id = p.role_id), '[]'::jsonb),
    'scopes', coalesce((select jsonb_agg(jsonb_build_object('id', rs.id, 'country_id', rs.country_id, 'province_id', rs.province_id, 'district_id', rs.district_id) order by rs.id) from public.role_scopes rs where rs.role_id = p.role_id), '[]'::jsonb),
    'regionCatalog', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'external_id', c.external_id, 'type', c.type::text, 'name', c.name, 'parent_id', c.parent_id) order by c.type::text, c.name) from public.get_rbac_region_catalog() c), '[]'::jsonb)
  )
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_current_user_rbac_access() from public, anon;
grant execute on function public.get_current_user_rbac_access() to authenticated;