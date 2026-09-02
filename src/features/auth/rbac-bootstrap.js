import { store } from "../../state/store.js";
import { getAccess, can, filterRegionTree } from "../../services/rbac.js";

let lastSessionKey = "";
let loading = false;
let lastRefreshAt = 0;
let permissionObserver = null;
let permissionGuardBound = false;

const STATIC_RULES = {
  menuButton: "button.menu.open",
  logoutButton: "button.auth.logout",
  themeButton: "button.theme.toggle",
  regionsToggle: "button.regions.toggle",
  addRegionButton: "button.region.create",
  campaignButton: "button.campaigns.open",
  usersButton: "button.rbac.tab_users",
  filesButton: "button.files.open",
  undoButton: "button.undo",
  redoButton: "button.redo",
  saveButton: "button.save",
  zoomInButton: "button.map.zoom_in",
  zoomOutButton: "button.map.zoom_out",
  resetMapButton: "button.map.reset",
  mapLayerButton: "button.map.layer.standard",
  satelliteLayerButton: "button.map.layer.satellite",
  dialogClose: "button.dialog.close",
  settingsButton: "button.settings.open"
};

const TOOL_RULES = {
  draw: "button.tool.draw",
  edit: "button.tool.edit",
  delete: "button.tool.delete",
  import: "button.tool.import",
  export: "button.tool.export",
  history: "button.tool.history"
};

const SELECTOR_RULES = [
  ["#regionPanelClose", "button.region.panel.close"],
  ["#regionDeleteButton", "button.region.delete"],
  ["#regionCancelButton", "button.region.panel.cancel"],
  ["#regionSaveButton", "button.region.save"],
  ["#regionBoundaryButton", "button.region.boundary.edit"],
  ["#regionServiceButton", "button.region.service.close", (node) => node.textContent.includes("Hizmete kapat")],
  ["#regionServiceButton", "button.region.service.open", (node) => node.textContent.includes("Hizmete aç")],
  ["#regionCampaignButton", "button.region.campaign.manage"],
  ["#regionCampaignEndButton", "button.region.info.campaign_end"],
  ["#serviceCloseCancel", "button.service_dialog.cancel"],
  ["#serviceCloseConfirm", "button.service_dialog.confirm"],
  ["#campaignCancel", "button.campaign_dialog.cancel"],
  ["#campaignSave", "button.campaign_dialog.apply"],
  ["#bulkCampaign", "button.campaigns.bulk_apply"],
  ["#bulkCloseCampaign", "button.campaigns.bulk_close"],
  ["#newCampaign", "button.campaigns.create"],
  ["[data-campaign-action='edit'], .campaign-edit-button", "button.campaigns.edit"],
  ["[data-campaign-action='delete'], .campaign-delete-button", "button.campaigns.delete"],
  ["#bulkSelectAll", "button.bulk.select_all"],
  ["#bulkClearAll", "button.bulk.clear_all"],
  ["#bulkCancel", "button.bulk.cancel"],
  ["#bulkConfirm", "button.bulk.confirm_apply", (node) => node.textContent.includes("uygula")],
  ["#bulkConfirm", "button.bulk.confirm_close", (node) => node.textContent.includes("kapat")],
  ["#cancelCampaignDelete", "button.campaign_delete.cancel"],
  ["#confirmCampaignDelete", "button.campaign_delete.confirm"],
  ["#cancelCampaign", "button.campaign_form.cancel"],
  ["#campaignForm button[type='submit']", "button.campaign_form.create", (node) => node.textContent.includes("oluştur")],
  ["#campaignForm button[type='submit']", "button.campaign_form.edit", (node) => !node.textContent.includes("oluştur")],
  [".files-view-button[data-view-mode='list']", "button.files.view_list"],
  [".files-view-button[data-view-mode='icons']", "button.files.view_icons"],
  [".file-delete", "button.files.delete"],
  ["#cancelDrawSave", "button.draw.cancel"],
  ["#drawRegionForm button[type='submit']", "button.draw.submit"],
  ["#cancelImportSettings", "button.import.cancel"],
  ["#importSettingsForm button[type='submit']", "button.import.continue"],
  [".history-sim-open", "button.history.simulate"],
  ["#historySimBack", "button.history.back"],
  ["#historyLoadMore", "button.history.load_more"],
  ["#resetMapSettings", "button.settings.reset"],
  ["#saveMapSettings", "button.settings.apply"],
  ["#createUserForm button[type='submit']", "button.rbac.create_user"],
  [".rbac-user-save", "button.rbac.save_user"],
  ["#createRoleForm button[type='submit']", "button.rbac.create_role"],
  [".rbac-role-form button[type='submit']", "button.rbac.save_role"],
  [".rbac-scope-add", "button.rbac.add_scope"],
  [".rbac-scope-remove", "button.rbac.remove_scope"],
  [".campaign-tab[data-campaign-tab='upcoming']", "button.campaigns.tab.upcoming"],
  [".campaign-tab[data-campaign-tab='expired']", "button.campaigns.tab.expired"],
  [".campaign-tab[data-campaign-tab='limit']", "button.campaigns.tab.limit"],
  [".campaign-tab[data-campaign-tab='active']", "button.campaigns.tab.active"],
  [".campaign-tab[data-campaign-tab='regions']", "button.campaigns.tab.regions"],
  [".rbac-tabs [data-tab='users']", "button.rbac.tab_users"],
  [".rbac-tabs [data-tab='roles']", "button.rbac.tab_roles"],
  ["input[name='permission']", "button.rbac.permission_toggle"]
];

function applyRule(node, permission) {
  if (!node || !permission) return;
  node.dataset.rbacPermission = permission;
}

function dynamicPermission(node) {
  if (!node) return null;
  if (node.dataset?.rbacPermission) return node.dataset.rbacPermission;
  if (node.id === "regionServiceButton") return node.textContent.includes("Hizmete aç") ? "button.region.service.open" : "button.region.service.close";
  for (const [selector, permission, predicate] of SELECTOR_RULES) {
    if (!node.matches?.(selector)) continue;
    if (typeof predicate === "function" && !predicate(node)) continue;
    return permission;
  }
  return null;
}

function permissionedNodes(root = document) {
  const nodes = [];
  for (const [id, permission] of Object.entries(STATIC_RULES)) {
    const node = document.getElementById(id);
    if (node) { applyRule(node, permission); nodes.push([node, permission]); }
  }
  for (const [tool, permission] of Object.entries(TOOL_RULES)) {
    root.querySelectorAll?.(`.tool[data-tool="${tool}"]`).forEach((node) => { applyRule(node, permission); nodes.push([node, permission]); });
  }
  for (const [selector] of SELECTOR_RULES) {
    root.querySelectorAll?.(selector).forEach((node) => {
      const permission = dynamicPermission(node);
      if (permission) { applyRule(node, permission); nodes.push([node, permission]); }
    });
  }
  return nodes;
}

function applyPermissionUI(access) {
  const seen = new Set();
  for (const [node, permission] of permissionedNodes(document)) {
    const key = `${permission}:${node}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const allowed = can(access, permission);
    node.hidden = !allowed;
    node.setAttribute("aria-hidden", String(!allowed));
    if ("disabled" in node) node.disabled = !allowed;
    if (!allowed) node.setAttribute("data-rbac-hidden", "true");
    else node.removeAttribute("data-rbac-hidden");
  }
}

function bindPermissionGuard() {
  if (permissionGuardBound) return;
  permissionGuardBound = true;
  document.addEventListener("click", (event) => {
    const node = event.target?.closest?.("[data-rbac-permission]");
    if (!node) return;
    const permission = node.dataset.rbacPermission;
    if (can(window.RegionConsoleRBAC?.access, permission)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  permissionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes?.length) {
        applyPermissionUI(window.RegionConsoleRBAC?.access || null);
        break;
      }
    }
  });
  permissionObserver.observe(document.body, { childList: true, subtree: true });
}

function countTree(items, keyNames) {
  return (items || []).reduce((sum, item) => {
    const children = keyNames.flatMap((key) => Array.isArray(item?.[key]) ? item[key] : []);
    return sum + children.length + countTree(children, keyNames);
  }, 0);
}

function applyFooterVisibility(access) {
  const state = store.get();
  const visible = filterRegionTree(access, state.regions?.countries || [], state.regions?.custom || []);
  const countries = visible.countries || [];
  const custom = visible.custom || [];
  const provinces = countTree(countries, ["provinces", "children"]);
  const districts = countTree(countries, ["districts", "children"]);
  const values = {
    statCountries: countries.length,
    statProvinces: provinces,
    statDistricts: districts,
    statArea: custom.length,
    statService: custom.filter((region) => (region?.status || "service") === "service").length,
    statCampaign: custom.filter((region) => region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId)).length,
    statClosed: custom.filter((region) => region?.status === "closed").length
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }
  const footerRules = {
    service: "button.footer.service_filter",
    campaign: "button.footer.campaign_filter",
    closed: "button.footer.closed_filter"
  };
  document.querySelectorAll(".footer-status-group").forEach((group) => {
    const button = group.querySelector(".footer-status");
    if (!button) return;
    const permission = footerRules[button.dataset.statusFilter];
    if (permission) {
      applyRule(button, permission);
      group.hidden = !can(access, permission);
    }
  });
  document.querySelectorAll("[data-status-popover]").forEach((popover) => {
    if (!popover.hidden) popover.hidden = true;
  });
}

async function refresh(force = false) {
  const session = store.get().auth?.session;
  const userId = session?.user?.id;
  const token = session?.access_token;
  const key = token && userId ? `${userId}:${token}` : "";
  if (!key) {
    lastSessionKey = "";
    window.RegionConsoleRBAC = window.RegionConsoleRBAC || {};
    window.RegionConsoleRBAC.access = null;
    applyPermissionUI(null);
    applyFooterVisibility(null);
    return null;
  }
  if (!force && (key === lastSessionKey || loading)) {
    const current = window.RegionConsoleRBAC?.access || null;
    applyPermissionUI(current);
    applyFooterVisibility(current);
    return current;
  }
  loading = true;
  try {
    const access = await getAccess(token, userId);
    lastSessionKey = key;
    lastRefreshAt = Date.now();
    applyPermissionUI(access);
    applyFooterVisibility(access);
    return access;
  } catch (error) {
    console.error("[Region Console] RBAC yüklenemedi:", error);
    window.RegionConsoleRBAC = window.RegionConsoleRBAC || {};
    window.RegionConsoleRBAC.access = null;
    window.RegionConsoleRBAC.error = error;
    applyPermissionUI(null);
    applyFooterVisibility(null);
    window.dispatchEvent(new CustomEvent("region-console:rbac-error", { detail: { error } }));
    return null;
  } finally {
    loading = false;
  }
}

bindPermissionGuard();
store.subscribe(() => { refresh(false); const access = window.RegionConsoleRBAC?.access || null; if (access?.loaded) applyFooterVisibility(access); });
window.addEventListener("region-console:rbac-refresh", () => refresh(true));
window.addEventListener("region-console:rbac-updated", () => { const access = window.RegionConsoleRBAC?.access || null; applyPermissionUI(access); applyFooterVisibility(access); });
window.addEventListener("focus", () => { if (Date.now() - lastRefreshAt > 15000) refresh(true); }, { passive: true });
window.addEventListener("pageshow", () => refresh(true), { passive: true });
refresh(true);
import "./rbac-ui-fix.js";
