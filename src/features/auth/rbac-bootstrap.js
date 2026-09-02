import { store } from "../../state/store.js";
import { getAccess, can, filterRegionTree } from "../../services/rbac.js";

let lastSessionKey = "";
let loading = false;
let lastRefreshAt = 0;
let permissionObserver = null;
let permissionGuardBound = false;

const STATIC_RULES = {
  regionsToggle: "regions.view",
  addRegionButton: "regions.create",
  campaignButton: "campaigns.view",
  usersButton: "users.manage",
  filesButton: "files.view",
  undoButton: "history.undo",
  redoButton: "history.redo",
  saveButton: "regions.save",
  zoomInButton: "map.zoom",
  zoomOutButton: "map.zoom",
  resetMapButton: "map.reset",
  mapLayerButton: "map.layer",
  satelliteLayerButton: "map.layer",
  themeButton: "map.theme"
};

const TOOL_RULES = {
  draw: "regions.create",
  edit: "regions.edit",
  delete: "regions.delete",
  import: "regions.import",
  export: "data.export",
  history: "history.view"
};

function dynamicPermission(node) {
  if (!node) return null;
  if (node.dataset?.rbacPermission) return node.dataset.rbacPermission;
  if (node.matches?.(".file-delete")) return "files.delete";
  if (node.matches?.(".files-view-button")) return "files.view";
  if (node.matches?.("[data-campaign-action='edit'], .campaign-edit-button")) return "campaigns.edit";
  if (node.matches?.("[data-campaign-action='delete'], .campaign-delete-button")) return "campaigns.delete";
  if (node.matches?.("#newCampaign")) return "campaigns.create";
  if (node.matches?.("#bulkCampaign")) return "campaigns.bulk_apply";
  if (node.matches?.("#bulkCloseCampaign")) return "campaigns.bulk_close";
  if (node.matches?.("#createUserForm button[type='submit']")) return "users.create";
  if (node.matches?.(".rbac-user-save")) return "users.edit";
  if (node.matches?.("#createRoleForm button[type='submit']")) return "roles.create";
  if (node.matches?.(".rbac-role-form button[type='submit']")) return "roles.edit";
  if (node.matches?.(".rbac-scope-add, .rbac-scope-remove")) return "roles.scopes";
  if (node.matches?.("input[name='permission']")) return "roles.permissions";
  if (node.matches?.(".campaign-tab")) return "campaigns.view";
  return null;
}

function permissionedNodes(root = document) {
  const nodes = [];
  for (const [id, permission] of Object.entries(STATIC_RULES)) {
    const node = document.getElementById(id);
    if (node) nodes.push([node, permission]);
  }
  for (const [tool, permission] of Object.entries(TOOL_RULES)) {
    root.querySelectorAll?.(`.tool[data-tool="${tool}"]`).forEach((node) => nodes.push([node, permission]));
  }
  root.querySelectorAll?.("[data-rbac-permission], .file-delete, .files-view-button, [data-campaign-action], .campaign-edit-button, .campaign-delete-button, #newCampaign, #bulkCampaign, #bulkCloseCampaign, #createUserForm button[type='submit'], .rbac-user-save, #createRoleForm button[type='submit'], .rbac-role-form button[type='submit'], .rbac-scope-add, .rbac-scope-remove, input[name='permission'], .campaign-tab").forEach((node) => {
    const permission = dynamicPermission(node);
    if (permission) nodes.push([node, permission]);
  });
  return nodes;
}

function applyPermissionUI(access) {
  for (const [node, permission] of permissionedNodes(document)) {
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
      if (mutation.addedNodes?.length) { applyPermissionUI(window.RegionConsoleRBAC?.access || null); break; }
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
  const service = custom.filter((region) => (region?.status || "service") === "service").length;
  const campaign = custom.filter((region) => region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId)).length;
  const closed = custom.filter((region) => region?.status === "closed").length;
  const values = { statCountries: countries.length, statProvinces: provinces, statDistricts: districts, statArea: custom.length, statService: service, statCampaign: campaign, statClosed: closed };
  for (const [id, value] of Object.entries(values)) { const node = document.getElementById(id); if (node) node.textContent = String(value); }
  document.querySelectorAll(".footer-status-group").forEach((group) => {
    const button = group.querySelector(".footer-status");
    if (!button) return;
    const status = button.dataset.statusFilter;
    const permission = status === "campaign" ? "campaigns.view" : "service_areas.view";
    group.hidden = !can(access, permission) || !can(access, "stats.filter");
  });
  document.querySelectorAll("[data-status-popover]").forEach((popover) => { if (!popover.hidden) popover.hidden = true; });
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
  } finally { loading = false; }
}

bindPermissionGuard();
store.subscribe(() => {
  refresh(false);
  const access = window.RegionConsoleRBAC?.access || null;
  if (access?.loaded) applyFooterVisibility(access);
});
window.addEventListener("region-console:rbac-refresh", () => refresh(true));
window.addEventListener("region-console:rbac-updated", () => { const access = window.RegionConsoleRBAC?.access || null; applyPermissionUI(access); applyFooterVisibility(access); });
window.addEventListener("focus", () => { if (Date.now() - lastRefreshAt > 15000) refresh(true); }, { passive: true });
window.addEventListener("pageshow", () => refresh(true), { passive: true });
refresh(true);