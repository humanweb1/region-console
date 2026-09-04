const CACHE_KEY = "region-console:administrative-catalog:v3";
let ready = false;
let catalogData = { provinces: [], districts: [], neighborhoods: [] };

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uniqueById(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?.id ?? item?.external_id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function regionCatalogFromAccess() {
  const accessCatalog = window.RegionConsoleRBAC?.access?.regionCatalog;
  return Array.isArray(accessCatalog) ? accessCatalog : [];
}

function buildFromCatalog(catalog) {
  const countries = catalog.filter((item) => String(item?.type || "").toLowerCase() === "country");
  const turkey = countries.find((item) => normalizeName(item?.name) === "turkey" || normalizeName(item?.name) === "türkiye") || null;
  const turkeyId = turkey?.id || null;
  const provinces = catalog
    .filter((item) => String(item?.type || "").toLowerCase() === "province")
    .map((item) => ({ ...item, _countryId: item.parent_id || turkeyId, _countryName: turkey?.name || "Turkey", catalogOnly: true, geometryStatus: "missing" }));
  const provinceById = new Map(provinces.map((item) => [String(item.id), item]));
  const provinceByExternalId = new Map(provinces.map((item) => [String(item.external_id || ""), item]));
  const districts = catalog
    .filter((item) => String(item?.type || "").toLowerCase() === "district")
    .map((item) => {
      const province = provinceById.get(String(item.parent_id || "")) || provinceByExternalId.get(String(item.parent_id || ""));
      return { ...item, _countryId: province?._countryId || turkeyId, _countryName: province?._countryName || turkey?.name || "Turkey", _provinceId: province?.id || item.parent_id || null, _provinceName: province?.name || null, catalogOnly: true, geometryStatus: "missing" };
    });
  const districtById = new Map(districts.map((item) => [String(item.id), item]));
  const districtByExternalId = new Map(districts.map((item) => [String(item.external_id || ""), item]));
  const neighborhoods = catalog
    .filter((item) => String(item?.type || "").toLowerCase() === "neighborhood")
    .map((item) => {
      const district = districtById.get(String(item.parent_id || "")) || districtByExternalId.get(String(item.parent_id || ""));
      return { ...item, _countryId: district?._countryId || turkeyId, _countryName: district?._countryName || turkey?.name || "Turkey", _provinceId: district?._provinceId || null, _provinceName: district?._provinceName || null, _districtId: district?.id || item.parent_id || null, _districtName: district?.name || null, catalogOnly: true, geometryStatus: "missing" };
    });
  return { provinces: uniqueById(provinces), districts: uniqueById(districts), neighborhoods: uniqueById(neighborhoods) };
}

export async function ensureAdministrativeCatalog({ includeNeighborhoods = false } = {}) {
  const catalog = regionCatalogFromAccess();
  if (catalog.length) {
    const next = buildFromCatalog(catalog);
    catalogData = next;
    ready = true;
    return true;
  }

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.provinces?.length || parsed?.districts?.length || parsed?.neighborhoods?.length) {
        catalogData = { provinces: parsed.provinces || [], districts: parsed.districts || [], neighborhoods: parsed.neighborhoods || [] };
        ready = true;
        return true;
      }
    }
  } catch {
    // Cache is optional.
  }

  catalogData = { provinces: [], districts: [], neighborhoods: [] };
  ready = true;
  return true;
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
    loading: false,
    provinces: catalogData.provinces.length,
    districts: catalogData.districts.length,
    neighborhoods: catalogData.neighborhoods.length
  };
}

export { normalizeName };

if (typeof window !== "undefined") {
  window.RegionConsoleRegionCatalog = {
    ensureAdministrativeCatalog,
    getAdministrativeCatalogData,
    catalogStatus,
    normalizeName
  };
}
