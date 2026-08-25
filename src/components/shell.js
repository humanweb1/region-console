import { store } from "../state/store.js";

export function getElements() {
  const ids = [
    "loginView", "consoleView", "cloudStatus", "versionLabel",
    "logoutButton", "themeButton", "menuButton", "headerMenu", "regionTree", "sidebar", "regionsToggle", "addRegionButton", "editBar",
    "selectedArea", "statCountries", "statProvinces", "statDistricts",
    "statArea", "statService", "statOutside", "statClosed", "stats", "toast", "appDialog",
    "dialogTitle", "dialogBody", "dialogClose", "campaignButton", "usersButton", "filesButton"
  ];
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

export function showLogin(elements) {
  elements.loginView.hidden = false;
  elements.consoleView.hidden = true;
}

export function showConsole(elements) {
  elements.loginView.hidden = true;
  elements.consoleView.hidden = false;
}

export function setCloudStatus(elements, text, state = "idle") {
  elements.cloudStatus.textContent = text;
  elements.cloudStatus.dataset.state = state;
}

export function toast(elements, message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getStatusRegions(status) {
  const custom = store.get().regions?.custom || [];
  return custom.filter((region) => {
    const current = region?.status || "service";
    return current === status;
  });
}

function renderFooterStatusList(status) {
  const popover = document.querySelector(`[data-status-popover="${status}"]`);
  if (!popover) return;
  const regions = getStatusRegions(status);
  popover.innerHTML = regions.length
    ? `<strong>${regions.length} alan</strong>${regions.map((region) => `<button class="footer-status-item" type="button" data-footer-region-id="${escapeHtml(region.id)}"><span>${escapeHtml(region.name || region.properties?.name || "Adsız alan")}</span>${region.closeReason ? `<small>${escapeHtml(region.closeReason)}</small>` : ""}</button>`).join("")}`
    : `<span class="footer-status-empty">Bu durumda alan yok.</span>`;
}

function bindFooterStatusControls() {
  document.querySelectorAll(".footer-status[data-status-filter]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", (event) => {
      const status = event.currentTarget.dataset.statusFilter;
      document.querySelectorAll(".footer-status-popover").forEach((popover) => {
        if (popover.dataset.statusPopover !== status) popover.hidden = true;
      });
      const popover = document.querySelector(`[data-status-popover="${status}"]`);
      if (!popover) return;
      renderFooterStatusList(status);
      popover.hidden = !popover.hidden;
    });
  });
}

function renderFooterStatusCounts() {
  const custom = store.get().regions?.custom || [];
  const service = custom.filter((region) => !["outside", "closed"].includes(region?.status)).length;
  const outside = custom.filter((region) => region?.status === "outside").length;
  const closed = custom.filter((region) => region?.status === "closed").length;
  const serviceElement = document.getElementById("statService");
  const outsideElement = document.getElementById("statOutside");
  const closedElement = document.getElementById("statClosed");
  if (serviceElement) serviceElement.textContent = service;
  if (outsideElement) outsideElement.textContent = outside;
  if (closedElement) closedElement.textContent = closed;
  ["service", "outside", "closed"].forEach((status) => {
    const popover = document.querySelector(`[data-status-popover="${status}"]`);
    if (popover && !popover.hidden) renderFooterStatusList(status);
  });
}

if (typeof document !== "undefined") {
  const initFooter = () => {
    bindFooterStatusControls();
    renderFooterStatusCounts();
    store.subscribe(() => {
      renderFooterStatusCounts();
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFooter, { once: true });
  else initFooter();
  document.addEventListener("click", (event) => {
    if (event.target.closest(".footer-status") || event.target.closest(".footer-status-popover")) return;
    document.querySelectorAll(".footer-status-popover").forEach((popover) => { popover.hidden = true; });
  });
}

export function openDialog(elements, title, body) {
  elements.dialogTitle.textContent = title;
  elements.dialogBody.innerHTML = body;
  elements.appDialog.showModal();
}

export function closeDialog(elements) {
  if (elements.appDialog.open) elements.appDialog.close();
}
