import { store } from "../../state/store.js";
import { isRegionVisible } from "../../services/rbac.js";

const CHILD_KEYS = ["provinces", "districts", "neighborhoods", "cemeteries", "children"];

function visibleTree(access, node) {
  if (!node) return null;
  const result = { ...node };
  let hasVisibleChild = false;
  for (const key of CHILD_KEYS) {
    if (!Array.isArray(node[key])) continue;
    const children = node[key].map((child) => visibleTree(access, child)).filter(Boolean);
    result[key] = children;
    hasVisibleChild ||= children.length > 0;
  }
  return isRegionVisible(access, node) || hasVisibleChild ? result : null;
}

function flatten(nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node);
    for (const key of CHILD_KEYS) if (Array.isArray(node[key])) flatten(node[key], output);
  }
  return output;
}

function apply() {
  const access = window.RegionConsoleRBAC?.access || null;
  if (!access?.loaded) return;
  const state = store.get();
  const countries = (state.regions?.countries || []).map((node) => visibleTree(access, node)).filter(Boolean);
  const all = flatten(countries);
  const custom = (state.regions?.custom || []).filter((region) => isRegionVisible(access, region));
  const count = (type) => all.filter((region) => String(region?.hierarchy?.type || region?.type || "").toLowerCase() === type).length;

  const values = {
    statCountries: count("country"),
    statProvinces: count("province"),
    statDistricts: count("district"),
    statArea: custom.length,
    statService: custom.filter((region) => !["outside", "closed", "campaign"].includes(region?.status) && !region?.campaign && !region?.campaignId).length,
    statCampaign: custom.filter((region) => region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId)).length,
    statClosed: custom.filter((region) => region?.status === "closed").length
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }
}

store.subscribe(apply);
window.addEventListener("region-console:rbac-updated", apply);
apply();
