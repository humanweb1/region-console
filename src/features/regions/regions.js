import { store } from "../../state/store.js";
import { filterRegionTree } from "../../services/rbac.js";

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "custom").toLowerCase();
}

function regionLabel(region) {
  const type = regionType(region);
  if (type === "province" || type === "il") return "İl";
  if (type === "district" || type === "ilce" || type === "ilçe") return "İlçe";
  return "Alan";
}

export function renderRegions(container, countries = [], query = "", custom = []) {
  const access = window.RegionConsoleRBAC?.access || null;
  const visible = filterRegionTree(access, countries, custom);
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const safeCountries = Array.isArray(visible.countries) ? visible.countries : [];
  const safeCustom = Array.isArray(visible.custom) ? visible.custom : [];
  const matches = (region) => !normalized || JSON.stringify(region).toLocaleLowerCase("tr-TR").includes(normalized);
  const entries = [
    ...safeCountries.filter(matches).map((country) => ({ type: "country", data: country })),
    ...safeCustom.filter(matches).map((region) => ({ type: "custom", data: region }))
  ].sort((a, b) => String(a.data?.name || "").localeCompare(String(b.data?.name || ""), "tr-TR", { sensitivity: "base" }));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">Yetkiniz dahilinde görüntülenebilecek bölge yok.</div>`;
    return;
  }

  container.innerHTML = entries.map(({ type, data }) => {
    if (type === "custom") {
      const kind = regionLabel(data);
      const status = data.status === "outside" ? "Dış" : data.status === "closed" ? "Kapalı" : kind;
      const id = data.id || data.importMeta?.sourceId || "";
      return `<div class="region-item region-item-custom"><button type="button" class="region-row" data-region-id="${escapeHtml(id)}"><span class="region-name">⌂ &nbsp;${escapeHtml(data.name || "İsimsiz")}</span><b>${escapeHtml(status)}</b></button></div>`;
    }
    return `<div class="region-item"><button type="button" class="region-row" data-country-id="${escapeHtml(data.id || "")}"><span class="region-name">› &nbsp;▱ ${escapeHtml(data.name || "İsimsiz")}</span><b>${Number(data.count || 0)}</b></button></div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

window.addEventListener("region-console:rbac-updated", () => {
  const container = document.getElementById("regionTree");
  if (!container) return;
  const state = store.get();
  renderRegions(container, state.regions?.countries || [], "", state.regions?.custom || []);
});
