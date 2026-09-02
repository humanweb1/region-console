import { store } from "../../state/store.js";
import { filterRegionTree, getVisibleRegionIds } from "../../services/rbac.js";

const TOOL_ICONS = {
  draw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M5 19h5M14 5h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m14 7 3 3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 10v8M12 10v8M16 10v8M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const STYLE = `
.tool[data-tool="edit"], .tool[data-tool="delete"] { display: grid; }
.tool[hidden] { display: none !important; }
.tool { cursor: pointer; }
.tool .tool-icon { display: grid; place-items: center; width: 17px; height: 17px; }
.tool .tool-icon svg { display: block; width: 17px; height: 17px; }
.footer-status-group[data-rbac-filter-hidden="true"] { display: none; }
.footer-status-popover { min-width: 220px; }
.footer-status-item.is-selected { background: var(--panel-2); }
`;

function ensureStyles() {
  if (document.getElementById("rbacUiFixStyles")) return;
  const style = document.createElement("style");
  style.id = "rbacUiFixStyles";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "").toLowerCase();
}

function regionLabel(region) {
  const type = regionType(region);
  if (type === "province" || type === "il") return "İl";
  if (type === "district" || type === "ilce" || type === "ilçe") return "İlçe";
  if (type === "country" || type === "ülke") return "Ülke";
  return "Alan";
}

function visibleCatalog(access) {
  const catalog = access?.regionCatalog || [];
  const ids = getVisibleRegionIds(access);
  if (ids === null) return catalog;
  return catalog.filter((region) => ids.has(String(region.id)));
}

function visibleCustom(access) {
  const state = store.get();
  const result = filterRegionTree(access, state.regions?.countries || [], state.regions?.custom || []);
  return Array.isArray(result.custom) ? result.custom : [];
}

function summary(access) {
  if (!access?.loaded) return { countries: 0, provinces: 0, districts: 0, custom: [], service: [], campaign: [], closed: [] };
  const allCatalog = access.regionCatalog || [];
  const catalog = visibleCatalog(access);
  const visibleIds = new Set(catalog.map((r) => String(r.id)));
  const byId = new Map(allCatalog.map((r) => [String(r.id), r]));
  const countryIds = new Set();
  const provinceIds = new Set();
  const districtIds = new Set();
  const addAncestors = (region) => {
    let current = region;
    const seen = new Set();
    while (current && !seen.has(String(current.id))) {
      const id = String(current.id);
      seen.add(id);
      const type = String(current.type || "");
      if (type === "country") countryIds.add(id);
      if (type === "province") provinceIds.add(id);
      if (type === "district") districtIds.add(id);
      current = current.parent_id ? byId.get(String(current.parent_id)) : null;
    }
  };
  for (const region of catalog) addAncestors(region);
  const custom = visibleCustom(access);
  const service = custom.filter((r) => r?.status !== "outside" && r?.status !== "closed");
  const campaign = custom.filter((r) => r?.status === "campaign" || r?.campaign === true || Boolean(r?.campaignId));
  const closed = custom.filter((r) => r?.status === "closed");
  return { countries: countryIds.size, provinces: provinceIds.size, districts: districtIds.size, custom, service, campaign, closed, visibleIds };
}

function setCount(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function renderPopover(button, items, title) {
  const popover = document.querySelector(`[data-status-popover="${button.dataset.statusFilter}"]`);
  if (!popover) return;
  const selectedId = store.get().regions?.selectedId;
  popover.innerHTML = items.length
    ? `<strong>${escapeHtml(title)} (${items.length})</strong>${items.map((region) => `<button type="button" class="footer-status-item${String(region.id) === String(selectedId) ? " is-selected" : ""}" data-footer-region-id="${escapeHtml(region.id)}"><span>${escapeHtml(region.name || "İsimsiz")}</span><small>${escapeHtml(regionLabel(region))}</small></button>`).join("")}`
    : `<strong>${escapeHtml(title)} (0)</strong><div class="footer-status-empty">Yetkiniz dahilinde kayıt yok.</div>`;
  popover.querySelectorAll("[data-footer-region-id]").forEach((item) => item.addEventListener("click", () => {
    const id = item.dataset.footerRegionId;
    const region = (store.get().regions?.custom || []).find((candidate) => String(candidate.id) === String(id));
    if (!region) return;
    store.update("regions", { selectedId: region.id });
    document.dispatchEvent(new CustomEvent("region-console:region-selected", { detail: { region, mapState: window.__regionConsoleMapState } }));
    popover.hidden = true;
  }));
}

function apply() {
  ensureStyles();
  const access = window.RegionConsoleRBAC?.access || null;
  const data = summary(access);
  setCount("statCountries", data.countries);
  setCount("statProvinces", data.provinces);
  setCount("statDistricts", data.districts);
  setCount("statArea", data.custom.length);
  setCount("statService", data.service.length);
  setCount("statCampaign", data.campaign.length);
  setCount("statClosed", data.closed.length);

  document.querySelectorAll(".tool[data-tool]").forEach((button) => {
    const tool = button.dataset.tool;
    if (!TOOL_ICONS[tool]) return;
    if (!button.querySelector(".tool-icon")) button.insertAdjacentHTML("afterbegin", `<span class="tool-icon">${TOOL_ICONS[tool]}</span>`);
    const title = { draw: "Çizim", edit: "Düzenle", delete: "Sil", import: "İçe aktar", export: "Dışa aktar", history: "Geçmiş" }[tool] || tool;
    button.title = title;
    button.setAttribute("aria-label", title);
  });

  const groups = [
    ["service", data.service, "Hizmet verilen alanlar"],
    ["campaign", data.campaign, "Kampanyalı alanlar"],
    ["closed", data.closed, "Hizmete kapalı alanlar"]
  ];
  for (const [status, items, title] of groups) {
    const button = document.querySelector(`.footer-status[data-status-filter="${status}"]`);
    const group = button?.closest(".footer-status-group");
    if (!button || !group) continue;
    group.dataset.rbacFilterHidden = "false";
    renderPopover(button, items, title);
    if (button.dataset.rbacBound !== "true") {
      button.dataset.rbacBound = "true";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const popover = document.querySelector(`[data-status-popover="${status}"]`);
        if (!popover) return;
        document.querySelectorAll("[data-status-popover]").forEach((node) => { if (node !== popover) node.hidden = true; });
        popover.hidden = !popover.hidden;
        if (!popover.hidden) {
          const rect = button.getBoundingClientRect();
          popover.style.left = `${Math.max(6, Math.min(window.innerWidth - popover.offsetWidth - 6, rect.left))}px`;
          popover.style.bottom = `${Math.max(6, window.innerHeight - rect.top + 6)}px`;
        }
      });
    }
  }
}

ensureStyles();
store.subscribe(() => apply());
window.addEventListener("region-console:rbac-updated", apply);
window.addEventListener("resize", () => document.querySelectorAll("[data-status-popover]").forEach((node) => { node.hidden = true; }), { passive: true });
apply();
