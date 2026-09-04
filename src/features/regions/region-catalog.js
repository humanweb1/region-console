import { store } from "../../state/store.js";

const API_BASE = "https://api.turkiyeapi.dev/v2/datasets";
const CACHE_KEY = "region-console:administrative-catalog:v1";
let loading = null;
let ready = false;

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function idFor(type, id) { return `catalog-${type}-${String(id)}`; }

function catalogRegion(type, item) {
  const provinceId = item?.provinceId ?? item?.province_id ?? null;
  const districtId = item?.districtId ?? item?.district_id ?? null;
  return {
    id: idFor(type, item.id),
    name: String(item.name || "").trim(),
    type: "custom",
    status: "service",
    geometry: null,
    bounds: null,
    catalogOnly: true,
    geometryStatus: "missing",
    geometrySource: "catalog",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hierarchy: {
      type,
      label: type === "province" ? "İl" : type === "district" ? "İlçe" : "Mahalle",
      level: type === "province" ? 1 : type === "district" ? 2 : 3,
      parentType: type === "province" ? "country" : type === "district" ? "province" : "district",
      parentId: type === "province" ? "eded09b2-8966-4b24-8f89-a4ec4a9338a1" : type === "district" ? idFor("province", provinceId) : idFor("district", districtId),
      parentName: null,
      countryId: type === "province" || type === "district" || type === "neighborhood" ? "eded09b2-8966-4b24-8f89-a4ec4a9338a1" : null,
      countryName: "Turkey",
      provinceId: type === "province" ? idFor("province", item.id) : idFor("province", provinceId),
      provinceName: null,
      districtId: type === "district" ? idFor("district", item.id) : type === "neighborhood" ? idFor("district", districtId) : null,
      districtName: null,
      externalCatalogId: String(item.id)
    },
    importMeta: { source: "catalog", sourceId: String(item.id), format: "Catalog" }
  };
}

function readCache() {
  try {
    const value = sessionStorage.getItem(CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function writeCache(value) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* cache is optional */ }
}

async function fetchDataset(name) {
  const response = await fetch(`${API_BASE}/${name}.json`, { headers: { Accept: "application/json" }, cache: "force-cache" });
  if (!response.ok) throw new Error(`Katalog verisi alınamadı: ${name} (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

function mergeCatalog(provinces, districts, neighborhoods) {
  const current = store.get();
  const custom = Array.isArray(current.regions?.custom) ? current.regions.custom : [];
  const existing = new Set(custom.map((item) => String(item?.id || "")));
  const additions = [];
  for (const item of provinces) if (item?.id != null && item?.name && !existing.has(idFor("province", item.id))) additions.push(catalogRegion("province", item));
  for (const item of districts) if (item?.id != null && item?.name && !existing.has(idFor("district", item.id))) additions.push(catalogRegion("district", item));
  for (const item of neighborhoods) if (item?.id != null && item?.name && !existing.has(idFor("neighborhood", item.id))) additions.push(catalogRegion("neighborhood", item));
  if (!additions.length) return;
  store.update("regions", { custom: [...custom, ...additions] });
}

export async function ensureAdministrativeCatalog() {
  if (ready) return true;
  if (loading) return loading;
  loading = (async () => {
    const cached = readCache();
    if (cached?.provinces?.length && cached?.districts?.length && cached?.neighborhoods?.length) {
      mergeCatalog(cached.provinces, cached.districts, cached.neighborhoods);
      ready = true;
      return true;
    }
    const [provinces, districts, neighborhoods] = await Promise.all([
      fetchDataset("provinces"),
      fetchDataset("districts"),
      fetchDataset("neighborhoods")
    ]);
    const payload = { provinces, districts, neighborhoods, fetchedAt: new Date().toISOString() };
    writeCache(payload);
    mergeCatalog(provinces, districts, neighborhoods);
    ready = true;
    return true;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function catalogStatus() {
  return { ready, loading: Boolean(loading) };
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("#saveButton");
    if (!button || button.disabled || button.dataset.catalogReady === "true" || button.dataset.catalogLoading === "true") return;
    button.dataset.catalogLoading = "true";
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await ensureAdministrativeCatalog();
      button.dataset.catalogReady = "true";
      button.click();
    } catch (error) {
      console.error("[Region Console] Administrative catalog load failed:", error);
      window.dispatchEvent(new CustomEvent("region-console:toast", { detail: { message: "Bölge kataloğu yüklenemedi. Mevcut kayıtlarla devam edebilirsiniz." } }));
    } finally {
      delete button.dataset.catalogLoading;
      delete button.dataset.catalogReady;
    }
  }, true);
}

if (typeof window !== "undefined") window.RegionConsoleRegionCatalog = { ensureAdministrativeCatalog, catalogStatus, normalizeName };
