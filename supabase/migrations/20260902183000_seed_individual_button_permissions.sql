with defs(permission, legacy_permission) as (
  values
    ('button.menu.open', null),
    ('button.auth.logout', null),
    ('button.theme.toggle', 'map.theme'),
    ('button.regions.toggle', 'regions.view'),
    ('button.region.create', 'regions.create'),
    ('button.tool.draw', 'regions.create'),
    ('button.tool.edit', 'regions.edit'),
    ('button.tool.delete', 'regions.delete'),
    ('button.tool.import', 'regions.import'),
    ('button.tool.export', 'data.export'),
    ('button.tool.history', 'history.view'),
    ('button.map.reset', 'map.reset'),
    ('button.map.layer.standard', 'map.layer'),
    ('button.map.layer.satellite', 'map.layer'),
    ('button.map.zoom_out', 'map.zoom'),
    ('button.map.zoom_in', 'map.zoom'),
    ('button.undo', 'history.undo'),
    ('button.redo', 'history.redo'),
    ('button.save', 'regions.save'),
    ('button.footer.service_filter', 'service_areas.view'),
    ('button.footer.campaign_filter', 'campaigns.view'),
    ('button.footer.closed_filter', 'service_areas.view'),
    ('button.dialog.close', null),
    ('button.region.panel.close', 'regions.view'),
    ('button.region.service.open', 'service_areas.open'),
    ('button.region.service.close', 'service_areas.close'),
    ('button.region.campaign.manage', 'campaigns.assign'),
    ('button.region.boundary.edit', 'regions.edit'),
    ('button.region.delete', 'regions.delete'),
    ('button.region.panel.cancel', null),
    ('button.region.save', 'regions.save'),
    ('button.region.info.campaign_end', 'campaigns.end'),
    ('button.service_dialog.cancel', null),
    ('button.service_dialog.confirm', 'service_areas.close'),
    ('button.campaign_dialog.cancel', null),
    ('button.campaign_dialog.apply', 'campaigns.assign'),
    ('button.campaigns.open', 'campaigns.view'),
    ('button.campaigns.bulk_apply', 'campaigns.bulk_apply'),
    ('button.campaigns.bulk_close', 'campaigns.bulk_close'),
    ('button.campaigns.create', 'campaigns.create'),
    ('button.campaigns.tab.upcoming', 'campaigns.view'),
    ('button.campaigns.tab.expired', 'campaigns.view'),
    ('button.campaigns.tab.limit', 'campaigns.view'),
    ('button.campaigns.tab.active', 'campaigns.view'),
    ('button.campaigns.tab.regions', 'campaigns.view'),
    ('button.campaigns.edit', 'campaigns.edit'),
    ('button.campaigns.delete', 'campaigns.delete'),
    ('button.bulk.select_all', 'campaigns.bulk_apply'),
    ('button.bulk.clear_all', 'campaigns.bulk_apply'),
    ('button.bulk.cancel', null),
    ('button.bulk.confirm_apply', 'campaigns.bulk_apply'),
    ('button.bulk.confirm_close', 'campaigns.bulk_close'),
    ('button.campaign_delete.cancel', null),
    ('button.campaign_delete.confirm', 'campaigns.delete'),
    ('button.campaign_form.cancel', null),
    ('button.campaign_form.create', 'campaigns.create'),
    ('button.campaign_form.edit', 'campaigns.edit'),
    ('button.files.open', 'files.view'),
    ('button.files.view_list', 'files.view'),
    ('button.files.view_icons', 'files.view'),
    ('button.files.delete', 'files.delete'),
    ('button.draw.cancel', null),
    ('button.draw.submit', 'regions.create'),
    ('button.import.cancel', null),
    ('button.import.continue', 'regions.import'),
    ('button.history.simulate', 'history.view'),
    ('button.history.back', null),
    ('button.history.load_more', 'history.view'),
    ('button.settings.open', 'map.theme'),
    ('button.settings.reset', 'map.theme'),
    ('button.settings.apply', 'map.theme'),
    ('button.rbac.tab_users', 'users.manage'),
    ('button.rbac.tab_roles', 'users.manage'),
    ('button.rbac.create_user', 'users.create'),
    ('button.rbac.save_user', 'users.edit'),
    ('button.rbac.create_role', 'roles.create'),
    ('button.rbac.save_role', 'roles.edit'),
    ('button.rbac.permission_toggle', 'roles.permissions'),
    ('button.rbac.add_scope', 'roles.scopes'),
    ('button.rbac.remove_scope', 'roles.scopes')
)
insert into public.role_permissions(role_id, permission)
select r.id, d.permission
from public.roles r
cross join defs d
where r.name <> 'super_admin'
  and (d.legacy_permission is null or exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = r.id
      and existing.permission = d.legacy_permission
  ))
on conflict (role_id, permission) do nothing;

insert into public.role_permissions(role_id, permission)
select r.id, 'button.region.campaign.manage'
from public.roles r
where r.name <> 'super_admin'
  and exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = r.id
      and existing.permission in ('campaigns.assign','campaigns.remove')
  )
on conflict (role_id, permission) do nothing;
