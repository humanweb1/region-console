import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { isRegionVisible } from "../../services/rbac.js";

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
}

function collectStateRegions(state) {
  const result = [];
  const visit = (items) => {
    for (const region of Array.isArray(items) ? items : []) {
      if (!region || typeof region !== "object") continue;
      result.push(region);
      visit(region.provinces);
      visit(region.districts);
      visit(region.neighborhoods);
      visit(region.cemeteries);
      visit(region.children);
    }
  };
  visit(state?.regions?.countries);
  visit(state?.regions?.custom);
  return result;
}

function uniqueVisibleRegions(state) {
  const access = window.RegionConsoleRBAC?.access || null;
  const seen = new Set();
  return collectStateRegions(state).filter((region) => {
    if (!region?.id) return false;
    const id = String(region.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return !access?.loaded || isRegionVisible(access, region);
  });
}

function isCampaignRegion(region) {
  return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function updateFooterStats(state) {
  const regions = uniqueVisibleRegions(state);
  const counts = { country: 0, province: 0, district: 0 };
  for (const region of regions) {
    const type = regionType(region);
    if (type === "country") counts.country += 1;
    else if (type === "province") counts.province += 1;
    else if (type === "district") counts.district += 1;
  }

  const access = window.RegionConsoleRBAC?.access || null;
  const custom = (Array.isArray(state?.regions?.custom) ? state.regions.custom : [])
    .filter((region) => region && (!access?.loaded || isRegionVisible(access, region)));
  const service = custom.filter((region) => !["outside", "closed", "campaign"].includes(region?.status) && !isCampaignRegion(region)).length;
  const campaign = custom.filter(isCampaignRegion).length;
  const closed = custom.filter((region) => region?.status === "closed").length;

  setText("statCountries", counts.country);
  setText("statProvinces", counts.province);
  setText("statDistricts", counts.district);
  setText("statArea", custom.length);
  setText("statService", service);
  setText("statCampaign", campaign);
  setText("statClosed", closed);
}

let cleanupInProgress = false;
let cleanupCompleted = false;

async function removeOrphanedCountryTree(state) {
  if (cleanupInProgress || cleanupCompleted) return;
  if (state?.cloud?.status !== "ready") return;

  const countries = Array.isArray(state?.regions?.countries) ? state.regions.countries : [];
  const custom = Array.isArray(state?.regions?.custom) ? state.regions.custom : [];
  const importedFiles = Array.isArray(state?.importedFiles) ? state.importedFiles : [];
  if (!countries.length || importedFiles.length || custom.length) return;

  cleanupInProgress = true;
  try {
    store.update("regions", { countries: [], selectedId: null });
    const session = store.get().auth?.session;
    if (session?.access_token) {
      const current = store.get();
      await upsertState(session.access_token, {
        ...store.dataSnapshot().regions,
        campaigns: current.campaigns,
        history: current.history.entries,
        importedFiles: current.importedFiles,
        mapSettings: current.mapSettings
      });
    }
    cleanupCompleted = true;
  } catch (error) {
    console.error("[Region Console] Stale imported country tree cleanup failed:", error);
  } finally {
    cleanupInProgress = false;
  }
}

function sync() {
  const state = store.get();
  updateFooterStats(state);
  void removeOrphanedCountryTree(state);
}

if (typeof window !== "undefined") {
  const init = () => {
    sync();
    store.subscribe(sync);
    window.addEventListener("region-console:rbac-updated", sync);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}
