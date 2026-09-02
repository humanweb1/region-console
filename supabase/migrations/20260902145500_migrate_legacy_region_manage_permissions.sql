do $$
declare
  role_row record;
  permission_name text;
begin
  for role_row in select distinct rp.role_id from public.role_permissions rp where rp.permission='regions.manage' loop
    foreach permission_name in array array['regions.create','regions.edit','regions.delete','regions.import','regions.save'] loop
      insert into public.role_permissions(role_id, permission)
      values (role_row.role_id, permission_name)
      on conflict do nothing;
    end loop;
  end loop;
  delete from public.role_permissions rp where rp.permission='regions.manage';
end $$;
