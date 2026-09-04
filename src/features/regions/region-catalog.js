const API_BASE = "https://api.turkiyeapi.dev/v2/datasets";
const CACHE_KEY = "region-console:administrative-catalog:v2";
let loading = null;
let ready = false;
let catalogData = { provinces: [], districts: [], neighborhoods: [] };

function readCache() {
  try {
    const value = sessionStorage.getItem(CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function writeCache(value) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* optional cache */ }
}

async function fetchDataset(name) {
  const response = await fetch(`${API_BASE}/${name}.json`, {
    headers: { Accept: "application/json" },
    cache: "force-cache"
  });
  if (!response.ok) throw new Error(`Katalog verisi alınamadı: ${name} (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

export async function ensureAdministrativeCatalog({ includeNeighborhoods = false } = {}) {
  if (ready && (!includeNeighborhoods || catalogData.neighborhoods.length)) return true;
  if (loading) return loading;

  loading = (async () => {
    const cached = readCache();
    if (cached?.provinces?.length && cached?.districts?.length && (!includeNeighborhoods || cached?.neighborhoods?.length)) {
      catalogData = {
        provinces: cached.provinces,
        districts: cached.districts,
        neighborhoods: cached.neighborhoods || []
      };
      ready = true;
      return true;
    }

    const [provinces, districts] = await Promise.all([
      catalogData.provinces.length ? Promise.resolve(catalogData.provinces) : fetchDataset("provinces"),
      catalogData.districts.length ? Promise.resolve(catalogData.districts) : fetchDataset("districts")
    ]);

    let neighborhoods = catalogData.neighborhoods;
    if (includeNeighborhoods && !neighborhoods.length) neighborhoods = await fetchDataset("neighborhoods");

    catalogData = { provinces, districts, neighborhoods };
    writeCache({ ...catalogData, fetchedAt: new Date().toISOString() });
    ready = true;
    return true;
  })().catch((error) => {
    loading = null;
    throw error;
  });

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export function getAdministrativeCatalogData() {
  return {
    provinces: catalogData.provinces,
    districts: catalogData.districts,
    neighborhoods: catalogData.neighborhoods
  };
}

export function catalogStatus() {
  return {
    ready,
    loading: Boolean(loading),
    provinces: catalogData.provinces.length,
    districts: catalogData.districts.length,
    neighborhoods: catalogData.neighborhoods.length
  };
}

export function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

if (typeof window !== "undefined") {
  window.RegionConsoleRegionCatalog = {
    ensureAdministrativeCatalog,
    getAdministrativeCatalogData,
    catalogStatus,
    normalizeName
  };
}
