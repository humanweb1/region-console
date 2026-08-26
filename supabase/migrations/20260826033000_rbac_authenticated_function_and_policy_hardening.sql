-- RBAC API hardening: helper functions are callable only by signed-in users,
-- and RBAC policies are explicitly scoped to authenticated requests.

revoke execute on function public.has_permission(text, uuid) from public;
revoke execute on function public.is_super_admin() from public;
revoke execute on function public.has_region_scope(uuid) from public;
revoke execute on function public.user_has_region_scope(uuid) from public;
revoke execute on function public.save_region_console_state(jsonb, bigint) from public;

grant execute on function public.has_permission(text, uuid) to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.has_region_scope(uuid) to authenticated;
grant execute on function public.user_has_region_scope(uuid) to authenticated;
grant execute on function public.save_region_console_state(jsonb, bigint) to authenticated;

-- Remove legacy PUBLIC policies that can execute RBAC helpers as anon.
drop policy if exists "rbac read audit logs" on public.audit_logs;
drop policy if exists "rbac manage campaign regions" on public.campaign_regions;
drop policy if exists "rbac read campaign regions" on public.campaign_regions;
drop policy if exists "rbac manage campaigns" on public.campaigns;
drop policy if exists "rbac read campaigns" on public.campaigns;
drop policy if exists "rbac read profiles" on public.profiles;
drop policy if exists "rbac manage regions" on public.regions;
drop policy if exists "rbac read regions" on public.regions;
drop policy if exists "rbac manage permissions" on public.role_permissions;
drop policy if exists "rbac read permissions" on public.role_permissions;
drop policy if exists "rbac manage scopes" on public.role_scopes;
drop policy if exists "rbac read scopes" on public.role_scopes;
drop policy if exists "rbac manage roles" on public.roles;
drop policy if exists "rbac read roles" on public.roles;
drop policy if exists "rbac read service area history" on public.service_area_history;
drop policy if exists "rbac manage service areas" on public.service_areas;
drop policy if exists "rbac read service areas" on public.service_areas;

-- Recreate the read paths needed by the browser for authenticated users.
drop policy if exists "authenticated read own profile" on public.profiles;
create policy "authenticated read own profile"
on public.profiles for select to authenticated
using ((id = auth.uid()) or has_permission('users.manage'));

drop policy if exists "authenticated read roles" on public.roles;
create policy "authenticated read roles"
on public.roles for select to authenticated
using ((id = (select p.role_id from public.profiles p where p.id = auth.uid())) or has_permission('users.manage'));

drop policy if exists "authenticated read role permissions" on public.role_permissions;
create policy "authenticated read role permissions"
on public.role_permissions for select to authenticated
using ((role_id = (select p.role_id from public.profiles p where p.id = auth.uid())) or has_permission('users.manage'));
