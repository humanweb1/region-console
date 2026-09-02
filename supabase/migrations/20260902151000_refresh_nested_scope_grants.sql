revoke all on function public.user_has_region_scope(uuid) from public, anon, authenticated;
grant execute on function public.user_has_region_scope(uuid) to authenticated;
revoke all on function public.user_has_region_scope_for(uuid,uuid) from public, anon, authenticated;
grant execute on function public.user_has_region_scope_for(uuid,uuid) to service_role;
