import { config, assertConfig } from "../core/config.js";

function headers(accessToken) { return { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }; }
async function request(path, accessToken, options = {}) {
  assertConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, headers: { ...headers(accessToken), ...(options.headers || {}) } });
  const text = await response.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error_description || data?.error || `Supabase isteği başarısız (${response.status}).`);
  return data;
}

// Every business action exposed by the console has its own permission.
// Parent/umbrella permissions are kept only for backward-compatible roles;
// UI actions themselves always check their concrete permission.
export const PERMISSIONS = [
  ["regions.view", "Bölgeleri görüntüle"],
  ["regions.create", "Bölge ekle / çiz"],
  ["regions.edit", "Alanı düzenle"],
  ["regions.delete", "Alanı sil"],
  ["regions.import", "Bölge içe aktar"],
  ["regions.save", "Bölge değişikliklerini kaydet"],
  ["service_areas.view", "Hizmet alanlarını görüntüle"],
  ["service_areas.open", "Hizmete aç"],
  ["service_areas.close", "Hizmete kapat"],
  ["service_areas.manage", "Hizmet alanlarını yönet (üst yetki)"],
  ["campaigns.view", "Kampanyaları görüntüle"],
  ["campaigns.create", "Kampanya oluştur"],
  ["campaigns.edit", "Kampanya düzenle"],
  ["campaigns.delete", "Kampanya sil"],
  ["campaigns.assign", "Kampanyayı alana uygula"],
  ["campaigns.remove", "Kampanyayı alandan kaldır"],
  ["campaigns.bulk_apply", "Toplu kampanya uygula"],
  ["campaigns.bulk_close", "Toplu kampanya kapat"],
  ["campaigns.end", "Bölge kampanyasını sonlandır"],
  ["history.view", "Değişiklik geçmişini görüntüle"],
  ["history.undo", "Geri al"],
  ["history.redo", "İleri al"],
  ["files.view", "Dosyaları görüntüle"],
  ["files.delete", "İçe aktarılan dosyayı sil"],
  ["files.manage", "Dosyaları yönet (üst yetki)"],
  ["users.manage", "Kullanıcı ve rol yönetimine eriş"],
  ["users.create", "Kullanıcı oluştur"],
  ["users.edit", "Kullanıcı düzenle"],
  ["roles.create", "Rol oluştur"],
  ["roles.edit", "Rol düzenle"],
  ["roles.permissions", "Rol izinlerini düzenle"],
  ["roles.scopes", "Rol kapsamlarını düzenle"],
  ["data.export", "Veri dışa aktarımı"],
  ["map.view", "Haritayı görüntüle"],
  ["map.zoom", "Haritayı yakınlaştır / uzaklaştır"],
  ["map.reset", "Haritayı sıfırla"],
  ["map.layer", "Harita / uydu katmanı"],
  ["map.theme", "Harita temasını değiştir"],
  ["stats.view", "Durum özetini görüntüle"],
  ["stats.filter", "Durum özetini filtrele"]
];

export async function getAccess(accessToken, userId) {
  if (!accessToken || !userId) return null;
  const result = await request("/rest/v1/rpc/get_current_user_rbac_access", accessToken, { method: "POST", body: "{}" });
  const payload = Array.isArray(result) ? result[0] : result;
  if (!payload?.profile?.id) throw new Error("Kullanıcı profili bulunamadı.");
  const access = {
    profile: payload.profile,
    role: payload.role || null,
    permissions: [...new Set(Array.isArray(payload.permissions) ? payload.permissions.map(String) : [])],
    scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    regionCatalog: Array.isArray(payload.regionCatalog) ? payload.regionCatalog : [],
    loaded: true
  };
  if (typeof window !== "undefined") {
    window.RegionConsoleRBAC = window.RegionConsoleRBAC || {};
    window.RegionConsoleRBAC.access = access;
    window.RegionConsoleRBAC.error = null;
    window.dispatchEvent(new CustomEvent("region-console:rbac-updated"));
  }
  return access;
}

export function can(access, permission) {
  if (!access?.loaded || !access?.profile?.is_active) return false;
  const permissions = access.permissions || [];
  return access.role?.name === "super_admin" || permissions.includes("*") || permissions.includes(permission);
}
export function canAny(access, permissions) { return permissions.some((permission) => can(access, permission)); }

export function hasScope(access, target = {}) {
  if (!access?.loaded || !access?.profile?.is_active) return false;
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return true;
  const scopes = access.scopes || []; if (!scopes.length) return false;
  const targetCountry = target.countryId ? String(target.countryId) : null;
  const targetProvince = target.provinceId ? String(target.provinceId) : null;
  const targetDistrict = target.districtId ? String(target.districtId) : null;
  return scopes.some((scope) => {
    const country = scope.country_id ? String(scope.country_id) : null;
    const province = scope.province_id ? String(scope.province_id) : null;
    const district = scope.district_id ? String(scope.district_id) : null;
    if (!country && !province && !district) return true;
    if (country && targetCountry && country === targetCountry && !province && !district) return true;
    if (province && targetProvince && (!district || (targetDistrict && district === targetDistrict))) return true;
    if (district && targetDistrict && district === targetDistrict) return true;
    return false;
  });
}

function catalogRegionId(region) { return region?.id == null ? null : String(region.id); }
function catalogExternalId(region) { return region?.external_id == null ? null : String(region.external_id); }
function scopeCatalogMatch(catalog, value, type) {
  const normalized = value == null ? "" : String(value); if (!normalized) return null;
  return catalog.find((region) => String(region.type) === String(type) && (catalogRegionId(region) === normalized || catalogExternalId(region) === normalized)) || null;
}
function descendantsOf(catalog, rootIds) {
  const allowed = new Set(rootIds.filter(Boolean).map(String));
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of catalog) {
      const id = catalogRegionId(region);
      const parent = region?.parent_id == null ? null : String(region.parent_id);
      if (id && parent && allowed.has(parent) && !allowed.has(id)) { allowed.add(id); changed = true; }
    }
  }
  return allowed;
}

export function getVisibleRegionIds(access) {
  if (!access?.loaded || !access?.profile?.is_active) return new Set();
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return null;
  const catalog = access.regionCatalog || [];
  const rootIds = [];
  for (const scope of access.scopes || []) {
    const country = scopeCatalogMatch(catalog, scope.country_id, "country");
    const province = scopeCatalogMatch(catalog, scope.province_id, "province");
    const district = scopeCatalogMatch(catalog, scope.district_id, "district");
    if (country && !scope.province_id && !scope.district_id) rootIds.push(country.id);
    else if (province && !scope.district_id) rootIds.push(province.id);
    else if (district) rootIds.push(district.id);
    else if (!scope.country_id && !scope.province_id && !scope.district_id) return null;
  }
  return descendantsOf(catalog, rootIds);
}

function regionCandidates(region, explicitType = null) {
  const hierarchy = region?.hierarchy || {};
  const type = explicitType || String(hierarchy.type || region?.type || "");
  return [[region?.id, type], [hierarchy.countryId, "country"], [hierarchy.provinceId, "province"], [hierarchy.districtId, "district"]];
}

export function isRegionVisible(access, region) {
  const visible = getVisibleRegionIds(access);
  if (visible === null) return true;
  if (!region) return false;
  const catalog = access?.regionCatalog || [];
  return regionCandidates(region).some(([value, type]) => {
    if (value == null || !String(value) || !type) return false;
    const match = scopeCatalogMatch(catalog, value, type);
    return Boolean(match && visible.has(catalogRegionId(match)));
  });
}

function scopeRootTypes(access) {
  if (!access?.loaded) return new Set();
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return new Set(["country"]);
  const types = new Set();
  for (const scope of access.scopes || []) {
    if (scope.district_id) types.add("district");
    else if (scope.province_id) types.add("province");
    else if (scope.country_id) types.add("country");
  }
  return types;
}

export function filterRegionTree(access, countries = [], custom = []) {
  const visible = getVisibleRegionIds(access);
  if (visible === null) return { countries, custom };
  if (!access?.loaded) return { countries: [], custom: [] };
  const catalog = access?.regionCatalog || [];
  const roots = scopeRootTypes(access);
  const isVisible = (region, explicitType = null) => regionCandidates(region, explicitType).some(([value, type]) => {
    if (value == null || !String(value) || !type) return false;
    const match = scopeCatalogMatch(catalog, value, type);
    return Boolean(match && visible.has(catalogRegionId(match)));
  });
  const filterNode = (node, childKeys, explicitType = null) => {
    if (!isVisible(node, explicitType)) return null;
    const childrenKey = childKeys.find((key) => Array.isArray(node?.[key]));
    if (!childrenKey) return node;
    const children = node[childrenKey].map((child) => filterNode(child, childKeys)).filter(Boolean);
    return { ...node, [childrenKey]: children };
  };
  if (roots.has("country")) {
    return {
      countries: (countries || []).map((country) => filterNode(country, ["provinces", "districts", "neighborhoods", "children"], "country")).filter(Boolean),
      custom: (custom || []).filter((region) => isVisible(region))
    };
  }
  const scopedCustom = (custom || []).filter((region) => isVisible(region));
  const promoted = scopedCustom.filter((region) => {
    const type = String(region?.hierarchy?.type || region?.type || "").toLowerCase();
    if (roots.has("province") && type === "province") return true;
    if (roots.has("district") && type === "district") return true;
    return false;
  });
  return { countries: [], custom: promoted.length ? promoted : scopedCustom };
}

export function canManageInScope(access, permission, target) { return can(access, permission) && hasScope(access, target); }
export async function listUsers(accessToken) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "list" }) }); }
export async function createUser(accessToken, payload) { return request("/functions/v1/admin-create-user", accessToken, { method: "POST", body: JSON.stringify(payload) }); }
export async function updateUser(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-user", ...payload }) }); }
export async function createRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "create-role", ...payload }) }); }
export async function updateRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-role", ...payload }) }); }
export async function setRoleScopes(accessToken, roleId, scopes) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "set-role-scopes", role_id: roleId, scopes }) }); }