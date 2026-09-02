revoke execute on function public.admin_save_role(uuid,text,text,text[],jsonb) from public, anon, authenticated;
revoke execute on function public.sync_region_catalog(jsonb) from public, anon, authenticated;
revoke execute on function public.resolve_region_catalog_id(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_save_role(uuid,text,text,text[],jsonb) to service_role;
grant execute on function public.sync_region_catalog(jsonb) to service_role;
grant execute on function public.resolve_region_catalog_id(text,text,text,text,text) to service_role;
