do $$
declare
  admin_id uuid;
  manager_id uuid;
  editor_id uuid;
begin
  select id into admin_id from public.roles where name='admin' limit 1;
  select id into manager_id from public.roles where name='manager' limit 1;
  select id into editor_id from public.roles where name='editor' limit 1;

  if admin_id is not null then
    insert into public.role_permissions(role_id, permission)
    select admin_id, p from unnest(array[
      'regions.create','regions.edit','regions.delete','regions.import','regions.save',
      'service_areas.view','service_areas.open','service_areas.close',
      'campaigns.view','campaigns.create','campaigns.edit','campaigns.delete','campaigns.assign','campaigns.remove','campaigns.bulk_apply','campaigns.bulk_close','campaigns.end',
      'history.view','history.undo','history.redo',
      'files.view','files.delete',
      'users.manage','users.create','users.edit','roles.create','roles.edit','roles.permissions','roles.scopes',
      'data.export','stats.view','stats.filter'
    ]::text[]) p
    on conflict (role_id, permission) do nothing;
    delete from public.role_permissions where role_id=admin_id and permission in ('regions.manage','service_areas.manage','files.manage');
  end if;

  if manager_id is not null then
    insert into public.role_permissions(role_id, permission)
    select manager_id, p from unnest(array[
      'regions.view','regions.create','regions.edit','regions.delete','regions.import','regions.save',
      'service_areas.view','service_areas.open','service_areas.close',
      'campaigns.view','campaigns.create','campaigns.edit','campaigns.delete','campaigns.assign','campaigns.remove','campaigns.bulk_apply','campaigns.bulk_close','campaigns.end',
      'history.view',
      'map.view','map.zoom','map.reset','map.layer','map.theme',
      'stats.view','stats.filter'
    ]::text[]) p
    on conflict (role_id, permission) do nothing;
    delete from public.role_permissions where role_id=manager_id and permission in ('regions.manage','service_areas.manage');
  end if;

  if editor_id is not null then
    insert into public.role_permissions(role_id, permission)
    select editor_id, p from unnest(array['service_areas.view','service_areas.open','service_areas.close']::text[]) p
    on conflict (role_id, permission) do nothing;
    delete from public.role_permissions where role_id=editor_id and permission='service_areas.manage';
  end if;
end $$;