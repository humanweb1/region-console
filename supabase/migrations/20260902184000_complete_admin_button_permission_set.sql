insert into public.role_permissions(role_id, permission)
select r.id, p.permission
from public.roles r
cross join (
  values
    ('button.menu.open'),('button.auth.logout'),('button.theme.toggle'),('button.regions.toggle'),('button.region.create'),
    ('button.tool.draw'),('button.tool.edit'),('button.tool.delete'),('button.tool.import'),('button.tool.export'),('button.tool.history'),
    ('button.map.reset'),('button.map.layer.standard'),('button.map.layer.satellite'),('button.map.zoom_out'),('button.map.zoom_in'),
    ('button.undo'),('button.redo'),('button.save'),('button.footer.service_filter'),('button.footer.campaign_filter'),('button.footer.closed_filter'),
    ('button.dialog.close'),('button.region.panel.close'),('button.region.service.open'),('button.region.service.close'),('button.region.campaign.manage'),
    ('button.region.boundary.edit'),('button.region.delete'),('button.region.panel.cancel'),('button.region.save'),('button.region.info.campaign_end'),
    ('button.service_dialog.cancel'),('button.service_dialog.confirm'),('button.campaign_dialog.cancel'),('button.campaign_dialog.apply'),
    ('button.campaigns.open'),('button.campaigns.bulk_apply'),('button.campaigns.bulk_close'),('button.campaigns.create'),
    ('button.campaigns.tab.upcoming'),('button.campaigns.tab.expired'),('button.campaigns.tab.limit'),('button.campaigns.tab.active'),('button.campaigns.tab.regions'),
    ('button.campaigns.edit'),('button.campaigns.delete'),('button.bulk.select_all'),('button.bulk.clear_all'),('button.bulk.cancel'),
    ('button.bulk.confirm_apply'),('button.bulk.confirm_close'),('button.campaign_delete.cancel'),('button.campaign_delete.confirm'),
    ('button.campaign_form.cancel'),('button.campaign_form.create'),('button.campaign_form.edit'),('button.files.open'),('button.files.view_list'),
    ('button.files.view_icons'),('button.files.delete'),('button.draw.cancel'),('button.draw.submit'),('button.import.cancel'),('button.import.continue'),
    ('button.history.simulate'),('button.history.back'),('button.history.load_more'),('button.settings.open'),('button.settings.reset'),('button.settings.apply'),
    ('button.rbac.tab_users'),('button.rbac.tab_roles'),('button.rbac.create_user'),('button.rbac.save_user'),('button.rbac.create_role'),
    ('button.rbac.save_role'),('button.rbac.permission_toggle'),('button.rbac.add_scope'),('button.rbac.remove_scope')
) as p(permission)
where r.name = 'admin'
on conflict (role_id, permission) do nothing;
