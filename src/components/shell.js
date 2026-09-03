import { store } from "../state/store.js";
import { isRegionVisible } from "../services/rbac.js";

export function getElements() {
  const ids = [
    "loginView", "startupView", "consoleView", "startupTitle", "startupSubtitle", "startupProgress", "startupPercent",
    "cloudStatus", "versionLabel", "logoutButton", "themeButton", "menuButton", "headerMenu", "regionTree", "sidebar", "regionsToggle", "addRegionButton", "editBar",
    "selectedArea", "statCountries", "statProvinces", "statDistricts",
    "statArea", "statService", "statCampaign", "statClosed", "stats", "toast", "appDialog",
    "dialogTitle", "dialogBody", "dialogClose", "campaignButton", "usersButton", "filesButton"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  elements.statOutside = document.getElementById("statOutside") || document.createElement("span");
  bindDialogClose(elements);
  return elements;
}

function bindDialogClose(elements) {
  const button = elements?.dialogClose;
  const dialog = elements?.appDialog;
  if (!button || !dialog) return;

  button.onclick = (event) => {
    event.preventDefault();
    closeDialog(elements);
  };
  dialog.oncancel = (event) => {
    event.preventDefault();
    closeDialog(elements);
  };
}

export function showLogin(elements) {
  elements.loginView.hidden = false;
  if (elements.startupView) elements.startupView.hidden = true;
  elements.consoleView.hidden = true;
}

export function showStartup(elements) {
  elements.loginView.hidden = true;
  if (elements.startupView) elements.startupView.hidden = false;
  // Keep the console mounted and measurable behind the startup overlay. This
  // lets Leaflet render at its real dimensions before the loading screen ends.
  elements.consoleView.hidden = false;
}

export function showConsole(elements) {
  if (window.RegionConsoleStartup && window.RegionConsoleStartup.ready !== true) {
    const session = store.get().auth?.session;
    window.RegionConsoleStartup.begin?.(session);
    showStartup(elements);
    return;
  }
  elements.loginView.hidden = true;
  if (elements.startupView) elements.startupView.hidden = true;
  elements.consoleView.hidden = false;
}

export function releaseStartup(elements) {
  elements.loginView.hidden = true;
  if (elements.startupView) elements.startupView.hidden = true;
  elements.consoleView.hidden = false;
}

export function setCloudStatus(elements, text, state = "idle") { elements.cloudStatus.textContent = text; elements.cloudStatus.dataset.state = state; }
export function toast(elements, message) {
  if (typeof elements === "string" && message === undefined) {
    message = elements;
    elements = getElements();
  }
  if (!elements?.toast) return;
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function isCampaignRegion(region) { return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId); }
function matchesStatus(region, status) { if (status === "campaign") return isCampaignRegion(region); return (region?.status || "service") === status; }
function getStatusRegions(status) {
  const access = window.RegionConsoleRBAC?.access || null;
  const custom = store.get().regions?.custom || [];
  return custom.filter((region) => matchesStatus(region, status) && isRegionVisible(access, region));
}
function renderFooterStatusList(status) {
  const popover = document.querySelector(`[data-status-popover="${status}"]`);
  if (!popover) return;
  const regions = getStatusRegions(status);
  popover.innerHTML = regions.length
    ? `<strong>${regions.length} alan</strong>${regions.map((region) => `<button class="footer-status-item" type="button" data-footer-region-id="${escapeHtml(region.id)}"><span>${escapeHtml(region.name || region.properties?.name || "Adsız alan")}</span>${region.closeReason ? `<small>${escapeHtml(region.closeReason)}</small>` : ""}</button>`).join("")}`
    : `<span class="footer-status-empty">Yetkiniz dahilinde alan yok.</span>`;
}
function positionFooterPopover(button, popover) {
  const rect = button.getBoundingClientRect(); const gap = 8; const width = Math.min(300, window.innerWidth * 0.7);
  let left = rect.left + (rect.width / 2) - (width / 2); left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  popover.style.width = `${width}px`; popover.style.left = `${left}px`; popover.style.bottom = `${Math.max(8, window.innerHeight - rect.top + gap)}px`;
}
function repositionOpenFooterPopovers() {
  document.querySelectorAll(".footer-status-popover:not([hidden])").forEach((popover) => { const status = popover.dataset.statusPopover; const button = document.querySelector(`.footer-status[data-status-filter="${status}"]`); if (button) positionFooterPopover(button, popover); });
}
function bindFooterStatusControls() {
  document.querySelectorAll(".footer-status[data-status-filter]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", (event) => {
      const status = event.currentTarget.dataset.statusFilter;
      document.querySelectorAll(".footer-status-popover").forEach((popover) => { if (popover.dataset.statusPopover !== status) popover.hidden = true; });
      const popover = document.querySelector(`[data-status-popover="${status}"]`);
      if (!popover) return;
      renderFooterStatusList(status);
      const shouldOpen = popover.hidden; popover.hidden = !shouldOpen;
      if (shouldOpen) positionFooterPopover(button, popover);
    });
  });
}
function renderFooterStatusCounts() {
  const access = window.RegionConsoleRBAC?.access || null;
  const custom = (store.get().regions?.custom || []).filter((region) => isRegionVisible(access, region));
  const service = custom.filter((region) => !["outside", "closed", "campaign"].includes(region?.status) && !isCampaignRegion(region)).length;
  const campaign = custom.filter((region) => isCampaignRegion(region)).length;
  const closed = custom.filter((region) => region?.status === "closed").length;
  const serviceElement = document.getElementById("statService");
  const campaignElement = document.getElementById("statCampaign") || document.getElementById("statOutside");
  const closedElement = document.getElementById("statClosed");
  if (serviceElement) serviceElement.textContent = service;
  if (campaignElement) campaignElement.textContent = campaign;
  if (closedElement) closedElement.textContent = closed;
  ["service", "campaign", "closed"].forEach((status) => { const popover = document.querySelector(`[data-status-popover="${status}"]`); if (popover && !popover.hidden) renderFooterStatusList(status); });
}
if (typeof document !== "undefined") {
  const initFooter = () => {
    bindFooterStatusControls(); renderFooterStatusCounts();
    store.subscribe(() => { renderFooterStatusCounts(); repositionOpenFooterPopovers(); });
    window.addEventListener("resize", repositionOpenFooterPopovers);
    window.addEventListener("scroll", repositionOpenFooterPopovers, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFooter, { once: true }); else initFooter();
  document.addEventListener("click", (event) => { if (event.target.closest(".footer-status") || event.target.closest(".footer-status-popover")) return; document.querySelectorAll(".footer-status-popover").forEach((popover) => { popover.hidden = true; }); });
}
export function openDialog(elements, title, body) {
  elements.dialogTitle.textContent = title;
  elements.dialogBody.innerHTML = body;
  bindDialogClose(elements);
  if (!elements.appDialog.open) elements.appDialog.showModal();
}
export function closeDialog(elements) {
  const dialog = elements?.appDialog;
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.removeAttribute("open");
}
