import { store } from "../../state/store.js";
import { filterRegionTree, getVisibleRegionIds, isRegionVisible } from "../../services/rbac.js";

const TOOL_ICONS = {
  draw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.7-5.3L15.8 4.6a2.3 2.3 0 0 1 3.3 3.3L9 18l-5 2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.8 6.6l3.6 3.6M5.7 14.7l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5 6 14.8 16.3 4.5a2.1 2.1 0 0 1 3 3L8.9 17.8l-4.4 1.7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m14 7 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 11a7.5 7.5 0 1 1 2.2 5.3M4.5 5.5V11h5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const STYLE = `
.tool[data-tool="edit"], .tool[data-tool="delete"] { display: grid; }
.tool[hidden] { display: none !important; }
.tool { cursor: pointer; }
.tool > .tool-icon { display: grid !important; place-items: center; width: 18px; height: 18px; margin: 0; }
.tool > .tool-icon svg { display: block; width: 18px; height: 18px; }
.tool > .tool-icon + span:not(.tool-icon) { display: none; }
.footer-status-group[data-rbac-filter-hidden="true"] { display: none; }
.footer-status-popover { min-width: 220px; }
.footer-status-item.is-selected { background: var(--panel-2); }
`;
function ensureStyles() { if (document.getElementById("rbacUiFixStyles")) return; const style = document.createElement("style"); style.id = "rbacUiFixStyles"; style.textContent = STYLE; document.head.appendChild(style); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function regionType(region) { return String(region?.hierarchy?.type || region?.type || "").toLowerCase(); }
function regionLabel(region) { const type = regionType(region); if (type === "province" || type === "il") return "İl"; if (type === "district" || type === "ilce" || type === "ilçe") return "İlçe"; if (type === "country" || type === "ülke") return "Ülke"; return "Alan"; }
function visibleCatalog(access) { const catalog = Array.isArray(access?.regionCatalog) ? access.regionCatalog.filter((region) => region && typeof region === "object" && region.id != null) : []; const ids = getVisibleRegionIds(access); return ids === null ? catalog : catalog.filter((region) => ids.has(String(region.id))); }
function visibleCustom(access) { const state = store.get(); const result = filterRegionTree(access, state.regions?.countries || [], state.regions?.custom || []); return Array.isArray(result.custom) ? result.custom.filter((region) => region && typeof region === "object" && region.id != null) : []; }
function summary(access) {
  if (!access?.loaded) return { countries: 0, provinces: 0, districts: 0, custom: [], service: [], campaign: [], closed: [] };
  const allCatalog = Array.isArray(access.regionCatalog) ? access.regionCatalog.filter((region) => region && typeof region === "object" && region.id != null) : [];
  const catalog = visibleCatalog(access);
  const byId = new Map(allCatalog.map((region) => [String(region.id), region]));
  const countryIds = new Set(); const provinceIds = new Set(); const districtIds = new Set();
  for (const item of catalog) {
    let current = item; const seen = new Set();
    while (current && !seen.has(String(current.id))) {
      const id = String(current.id); seen.add(id); const type = String(current.type || "").toLowerCase();
      if (type === "country") countryIds.add(id); if (type === "province") provinceIds.add(id); if (type === "district") districtIds.add(id);
      current = current.parent_id ? byId.get(String(current.parent_id)) : null;
    }
  }
  const custom = visibleCustom(access); const isCampaign = (region) => region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId);
  const service = custom.filter((region) => !["outside", "closed", "campaign"].includes(region.status) && !isCampaign(region));
  const campaign = custom.filter(isCampaign); const closed = custom.filter((region) => region.status === "closed");
  return { countries: countryIds.size, provinces: provinceIds.size, districts: districtIds.size, custom, service, campaign, closed };
}
function setCount(id, value) { const node = document.getElementById(id); if (node) node.textContent = String(value); }
function renderPopover(button, items, title) {
  const popover = document.querySelector(`[data-status-popover="${button.dataset.statusFilter}"]`); if (!popover) return;
  const selectedId = store.get().regions?.selectedId;
  const safeItems = (Array.isArray(items) ? items : []).filter((region) => region && typeof region === "object" && region.id != null);
  popover.innerHTML = safeItems.length ? `<strong>${escapeHtml(title)} (${safeItems.length})</strong>${safeItems.map((region) => `<button type="button" class="footer-status-item${String(region.id) === String(selectedId) ? " is-selected" : ""}" data-footer-region-id="${escapeHtml(region.id)}"><span>${escapeHtml(region.name || "İsimsiz")}</span><small>${escapeHtml(regionLabel(region))}</small></button>`).join("")}` : `<strong>${escapeHtml(title)} (0)</strong><div class="footer-status-empty">Yetkiniz dahilinde kayıt yok.</div>`;
  popover.querySelectorAll("[data-footer-region-id]").forEach((item) => item.addEventListener("click", () => {
    const id = item.dataset.footerRegionId; const region = (store.get().regions?.custom || []).find((candidate) => candidate && String(candidate.id) === String(id));
    if (!region || !isRegionVisible(window.RegionConsoleRBAC?.access || null, region)) return;
    store.update("regions", { selectedId: region.id }); document.dispatchEvent(new CustomEvent("region-console:region-selected", { detail: { region, mapState: window.__regionConsoleMapState } })); popover.hidden = true;
  }));
}
function apply() {
  ensureStyles(); const access = window.RegionConsoleRBAC?.access || null; const data = summary(access);
  setCount("statCountries", data.countries); setCount("statProvinces", data.provinces); setCount("statDistricts", data.districts); setCount("statArea", data.custom.length); setCount("statService", data.service.length); setCount("statCampaign", data.campaign.length); setCount("statClosed", data.closed.length);
  const titles = { draw: "Çizim", edit: "Düzenle", delete: "Sil", import: "İçe aktar", export: "Dışa aktar", history: "Geçmiş" };
  document.querySelectorAll(".tool[data-tool]").forEach((button) => { const tool = button.dataset.tool; const icon = TOOL_ICONS[tool]; if (!icon) return; let holder = button.querySelector(":scope > .tool-icon"); if (!holder) { holder = document.createElement("span"); holder.className = "tool-icon"; button.prepend(holder); } holder.innerHTML = icon; button.title = titles[tool] || tool; button.setAttribute("aria-label", titles[tool] || tool); });
  const groups = [["service", data.service, "Hizmet verilen alanlar"], ["campaign", data.campaign, "Kampanyalı alanlar"], ["closed", data.closed, "Hizmete kapalı alanlar"]];
  for (const [status, items, title] of groups) { const button = document.querySelector(`.footer-status[data-status-filter="${status}"]`); const group = button?.closest(".footer-status-group"); if (!button || !group) continue; group.dataset.rbacFilterHidden = "false"; renderPopover(button, items, title); }
}
ensureStyles(); store.subscribe(() => apply()); window.addEventListener("region-console:rbac-updated", apply); window.addEventListener("resize", () => document.querySelectorAll("[data-status-popover]").forEach((node) => { node.hidden = true; }), { passive: true }); apply();
