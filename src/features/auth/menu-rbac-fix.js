import { can } from "../../services/rbac.js";

const MENU_CHILD_PERMISSIONS = [
  "button.regions.toggle",
  "button.campaigns.open",
  "button.rbac.tab_users",
  "button.files.open",
  "button.settings.open"
];

function applyMenuContainerAccess() {
  const button = document.getElementById("menuButton");
  if (!button) return;
  const access = window.RegionConsoleRBAC?.access || null;
  const canOpen = can(access, "button.menu.open") || MENU_CHILD_PERMISSIONS.some((permission) => can(access, permission));
  button.hidden = !canOpen;
  button.setAttribute("aria-hidden", String(!canOpen));
  if (canOpen) {
    button.removeAttribute("data-rbac-hidden");
    // The menu button is a navigation container. Child permissions are the
    // actual controls, so a child grant must not be blocked by button.menu.open.
    button.removeAttribute("data-rbac-permission");
  } else {
    button.dataset.rbacPermission = "button.menu.open";
    button.setAttribute("data-rbac-hidden", "true");
  }
}

window.addEventListener("region-console:rbac-updated", applyMenuContainerAccess);
window.addEventListener("region-console:rbac-refresh", () => setTimeout(applyMenuContainerAccess, 0));
window.addEventListener("pageshow", applyMenuContainerAccess, { passive: true });
setTimeout(applyMenuContainerAccess, 0);
