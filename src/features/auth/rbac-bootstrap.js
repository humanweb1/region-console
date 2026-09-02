import { store } from "../../state/store.js";
import { getAccess, can } from "../../services/rbac.js";

let lastSessionKey = "";
let loading = false;
let lastRefreshAt = 0;

function applyPermissionUI(access) {
  const rules = [
    ["regionsToggle", "regions.view"],
    ["addRegionButton", "regions.manage"],
    ["campaignButton", "campaigns.view"],
    ["usersButton", "users.manage"],
    ["filesButton", "files.view"],
    ["undoButton", "regions.manage"],
    ["redoButton", "regions.manage"],
    ["saveButton", "regions.manage"],
    ["history", "history.view"],
    ["export", "data.export"],
    ["import", "regions.manage"]
  ];

  for (const [target, permission] of rules) {
    const nodes = target.startsWith("#")
      ? document.querySelectorAll(target)
      : target.includes(".")
        ? document.querySelectorAll(target)
        : [document.getElementById(target)].filter(Boolean);
    nodes.forEach((node) => {
      const allowed = can(access, permission);
      node.hidden = !allowed;
      node.setAttribute("aria-hidden", String(!allowed));
      if ("disabled" in node) node.disabled = !allowed;
    });
  }

  document.querySelectorAll('.tool[data-tool="history"]').forEach((node) => {
    node.hidden = !can(access, "history.view");
    node.setAttribute("aria-hidden", String(!can(access, "history.view")));
  });
  document.querySelectorAll('.tool[data-tool="export"]').forEach((node) => {
    node.hidden = !can(access, "data.export");
    node.setAttribute("aria-hidden", String(!can(access, "data.export")));
  });
  document.querySelectorAll('.tool[data-tool="import"], .tool[data-tool="draw"], .tool[data-tool="delete"], .tool[data-tool="edit"]').forEach((node) => {
    node.hidden = !can(access, "regions.manage");
    node.setAttribute("aria-hidden", String(!can(access, "regions.manage")));
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
    return null;
  }
  if (!force && (key === lastSessionKey || loading)) {
    applyPermissionUI(window.RegionConsoleRBAC?.access || null);
    return window.RegionConsoleRBAC?.access || null;
  }
  loading = true;
  try {
    const access = await getAccess(token, userId);
    lastSessionKey = key;
    lastRefreshAt = Date.now();
    applyPermissionUI(access);
    return access;
  } catch (error) {
    console.error("[Region Console] RBAC yüklenemedi:", error);
    window.RegionConsoleRBAC = window.RegionConsoleRBAC || {};
    window.RegionConsoleRBAC.access = null;
    window.RegionConsoleRBAC.error = error;
    applyPermissionUI(null);
    window.dispatchEvent(new CustomEvent("region-console:rbac-error", { detail: { error } }));
    return null;
  } finally {
    loading = false;
  }
}

store.subscribe(() => refresh(false));
window.addEventListener("region-console:rbac-refresh", () => refresh(true));
window.addEventListener("focus", () => {
  if (Date.now() - lastRefreshAt > 15000) refresh(true);
}, { passive: true });
window.addEventListener("pageshow", () => refresh(true), { passive: true });

refresh(true);
