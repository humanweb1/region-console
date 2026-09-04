// The role editor stores the new button-level permissions, while some older
// feature handlers still check the legacy domain permissions. Keep the two
// permission vocabularies equivalent in the in-memory access object so a
// granted button permission cannot be hidden or rejected by a legacy guard.

const BUTTON_TO_LEGACY = {
  "button.region.create": "regions.create",
  "button.tool.draw": "regions.create",
  "button.tool.edit": "regions.edit",
  "button.tool.delete": "regions.delete",
  "button.tool.import": "regions.import",
  "button.tool.export": "data.export",
  "button.tool.history": "history.view",
  "button.undo": "history.undo",
  "button.redo": "history.redo",
  "button.save": "regions.save",
  "button.region.panel.close": "regions.view",
  "button.region.service.open": "service_areas.open",
  "button.region.service.close": "service_areas.close",
  "button.region.campaign.manage": "campaigns.assign",
  "button.region.boundary.edit": "regions.edit",
  "button.region.delete": "regions.delete",
  "button.region.panel.cancel": "regions.view",
  "button.region.save": "regions.save",
  "button.region.info.campaign_end": "campaigns.end",
  "button.service_dialog.confirm": "service_areas.close",
  "button.campaign_dialog.apply": "campaigns.assign",
  "button.campaigns.open": "campaigns.view",
  "button.campaigns.bulk_apply": "campaigns.bulk_apply",
  "button.campaigns.bulk_close": "campaigns.bulk_close",
  "button.campaigns.create": "campaigns.create",
  "button.campaigns.edit": "campaigns.edit",
  "button.campaigns.delete": "campaigns.delete",
  "button.files.open": "files.view",
  "button.files.view_list": "files.view",
  "button.files.view_icons": "files.view",
  "button.files.delete": "files.delete",
  "button.draw.submit": "regions.create",
  "button.import.continue": "regions.import",
  "button.history.simulate": "history.view",
  "button.history.back": "history.view",
  "button.history.load_more": "history.view",
  "button.settings.open": "map.theme",
  "button.settings.reset": "map.theme",
  "button.settings.apply": "map.theme",
  "button.rbac.tab_users": "users.manage",
  "button.rbac.tab_roles": "users.manage",
  "button.rbac.create_user": "users.create",
  "button.rbac.save_user": "users.edit",
  "button.rbac.create_role": "roles.create",
  "button.rbac.save_role": "roles.edit",
  "button.rbac.permission_toggle": "roles.permissions",
  "button.rbac.add_scope": "roles.scopes",
  "button.rbac.remove_scope": "roles.scopes"
};

function syncLegacyPermissions() {
  const access = window.RegionConsoleRBAC?.access;
  if (!access || !Array.isArray(access.permissions)) return;
  const permissions = new Set(access.permissions.map(String));
  let changed = false;
  for (const [buttonPermission, legacyPermission] of Object.entries(BUTTON_TO_LEGACY)) {
    if (!permissions.has(buttonPermission) || permissions.has(legacyPermission)) continue;
    permissions.add(legacyPermission);
    changed = true;
  }
  if (changed) access.permissions = [...permissions];
}

window.addEventListener("region-console:rbac-updated", syncLegacyPermissions);
window.addEventListener("region-console:rbac-refresh", () => setTimeout(syncLegacyPermissions, 0));
window.addEventListener("pageshow", syncLegacyPermissions, { passive: true });
setTimeout(syncLegacyPermissions, 0);
