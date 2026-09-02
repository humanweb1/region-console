create or replace function public.has_permission(required_permission text, target_user uuid default auth.uid())
returns boolean
language sql
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id=p.role_id
    left join public.role_permissions rp on rp.role_id=r.id
    where p.id=target_user
      and p.is_active=true
      and (
        r.name='super_admin'
        or rp.permission='*'
        or rp.permission=required_permission
        or rp.permission = any(
          case required_permission
            when 'regions.view' then array['button.regions.toggle']
            when 'regions.create' then array['button.region.create','button.tool.draw','button.draw.submit']
            when 'regions.edit' then array['button.tool.edit','button.region.boundary.edit']
            when 'regions.delete' then array['button.tool.delete','button.region.delete']
            when 'regions.import' then array['button.tool.import','button.import.continue']
            when 'regions.save' then array['button.save','button.region.save']
            when 'regions.manage' then array['button.region.create','button.tool.draw','button.tool.edit','button.tool.delete','button.tool.import','button.save','button.region.save']
            when 'service_areas.view' then array['button.regions.toggle','button.footer.service_filter']
            when 'service_areas.open' then array['button.region.service.open']
            when 'service_areas.close' then array['button.region.service.close','button.service_dialog.confirm']
            when 'service_areas.manage' then array['button.region.service.open','button.region.service.close','button.service_dialog.confirm']
            when 'campaigns.view' then array['button.campaigns.open','button.campaigns.tab.upcoming','button.campaigns.tab.expired','button.campaigns.tab.limit','button.campaigns.tab.active','button.campaigns.tab.regions']
            when 'campaigns.create' then array['button.campaigns.create','button.campaign_form.create']
            when 'campaigns.edit' then array['button.campaigns.edit','button.campaign_form.edit']
            when 'campaigns.delete' then array['button.campaigns.delete','button.campaign_delete.confirm']
            when 'campaigns.assign' then array['button.region.campaign.manage','button.campaign_dialog.apply']
            when 'campaigns.remove' then array['button.region.campaign.manage','button.campaign_dialog.apply']
            when 'campaigns.bulk_apply' then array['button.campaigns.bulk_apply','button.bulk.confirm_apply']
            when 'campaigns.bulk_close' then array['button.campaigns.bulk_close','button.bulk.confirm_close']
            when 'campaigns.end' then array['button.region.info.campaign_end']
            when 'campaigns.manage' then array['button.campaigns.open','button.campaigns.create','button.campaigns.edit','button.campaigns.delete','button.region.campaign.manage','button.campaign_dialog.apply','button.campaigns.bulk_apply','button.campaigns.bulk_close','button.region.info.campaign_end']
            when 'history.view' then array['button.tool.history','button.history.simulate','button.history.back','button.history.load_more']
            when 'history.undo' then array['button.undo']
            when 'history.redo' then array['button.redo']
            when 'files.view' then array['button.files.open','button.files.view_list','button.files.view_icons']
            when 'files.delete' then array['button.files.delete']
            when 'files.manage' then array['button.files.open','button.files.delete']
            when 'users.manage' then array['button.rbac.tab_users','button.rbac.tab_roles']
            when 'users.create' then array['button.rbac.create_user']
            when 'users.edit' then array['button.rbac.save_user']
            when 'roles.create' then array['button.rbac.create_role']
            when 'roles.edit' then array['button.rbac.save_role']
            when 'roles.permissions' then array['button.rbac.permission_toggle','button.rbac.save_role']
            when 'roles.scopes' then array['button.rbac.add_scope','button.rbac.remove_scope','button.rbac.save_role']
            when 'data.export' then array['button.tool.export']
            when 'map.view' then array['button.regions.toggle']
            when 'map.zoom' then array['button.map.zoom_in','button.map.zoom_out']
            when 'map.reset' then array['button.map.reset']
            when 'map.layer' then array['button.map.layer.standard','button.map.layer.satellite']
            when 'map.theme' then array['button.theme.toggle','button.settings.open','button.settings.reset','button.settings.apply']
            when 'stats.view' then array['button.footer.service_filter','button.footer.campaign_filter','button.footer.closed_filter']
            when 'stats.filter' then array['button.footer.service_filter','button.footer.campaign_filter','button.footer.closed_filter']
            else array[]::text[]
          end
        )
      )
  );
$$;

revoke all on function public.has_permission(text, uuid) from public, anon;
grant execute on function public.has_permission(text, uuid) to authenticated, service_role;
