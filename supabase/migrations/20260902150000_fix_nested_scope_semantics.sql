create or replace function public.user_has_region_scope(target_region_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
with recursive ancestors as (
  select r.id, r.parent_id from public.regions r where r.id=target_region_id
  union all
  select r.id, r.parent_id from public.regions r join ancestors a on a.parent_id=r.id
)
select public.is_super_admin()
  or exists (
    select 1
    from public.role_scopes rs
    join public.profiles p on p.role_id=rs.role_id
    where p.id=auth.uid() and p.is_active=true
      and (
        (rs.country_id is null and rs.province_id is null and rs.district_id is null)
        or (rs.district_id is not null and exists(select 1 from ancestors a where a.id=rs.district_id))
        or (rs.district_id is null and rs.province_id is not null and exists(select 1 from ancestors a where a.id=rs.province_id))
        or (rs.district_id is null and rs.province_id is null and rs.country_id is not null and exists(select 1 from ancestors a where a.id=rs.country_id))
      )
  );
$$;

create or replace function public.user_has_region_scope_for(p_user_id uuid, target_region_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
with recursive ancestors as (
  select r.id, r.parent_id from public.regions r where r.id=target_region_id
  union all
  select r.id, r.parent_id from public.regions r join ancestors a on a.parent_id=r.id
)
select public.is_super_admin_for(p_user_id)
  or exists (
    select 1
    from public.role_scopes rs
    join public.profiles p on p.role_id=rs.role_id
    where p.id=p_user_id and p.is_active=true
      and (
        (rs.country_id is null and rs.province_id is null and rs.district_id is null)
        or (rs.district_id is not null and exists(select 1 from ancestors a where a.id=rs.district_id))
        or (rs.district_id is null and rs.province_id is not null and exists(select 1 from ancestors a where a.id=rs.province_id))
        or (rs.district_id is null and rs.province_id is null and rs.country_id is not null and exists(select 1 from ancestors a where a.id=rs.country_id))
      )
  );
$$;

revoke all on function public.user_has_region_scope(uuid) from public, anon, authenticated;
grant execute on function public.user_has_region_scope(uuid) to authenticated;
revoke all on function public.user_has_region_scope_for(uuid,uuid) from public, anon, authenticated;
grant execute on function public.user_has_region_scope_for(uuid,uuid) to service_role;
