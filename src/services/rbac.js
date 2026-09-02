import { config, assertConfig } from "../core/config.js";

function headers(accessToken) {
  return { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}
async function request(path, accessToken, options = {}) {
  assertConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, headers: { ...headers(accessToken), ...(options.headers || {}) } });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error_description || data?.error || `Supabase isteği başarısız (${response.status}).`);
  return data;
}

export const PERMISSIONS = [
  ["regions.view", "Bölgeleri görüntüle"], ["regions.manage", "Bölgeleri yönet"],
  ["service_areas.view", "Hizmet alanlarını görüntüle"], ["service_areas.manage", "Hizmet alanlarını yönet"],
  ["campaigns.view", "Kampanyaları görüntüle"], ["campaigns.manage", "Kampanyaları yönet"],
  ["history.view", "Değişiklik geçmişini görüntüle"], ["files.view", "Dosyaları görüntüle"],
  ["files.manage", "Dosyaları yönet"], ["users.manage", "Kullanıcı ve rol yönetimi"],
  ["data.export", "Veri dışa aktarımı"], ["map.view", "Haritayı görüntüle"]
];

async function loadRegionCatalog(accessToken) {
  try {
    return await request("/rest/v1/regions?select=id,external_id,type,name,parent_id&is_active=eq.true", accessToken);
  } catch (error) {
    console.error("RBAC region catalog", error);
    return [];
  }
}

export async function getAccess(accessToken, userId) {
  if (!accessToken || !userId) return null;
  const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,role_id,is_active,roles(id,name,description)&limit=1`, accessToken);
  const profile = profiles?.[0] || null;
  if (!profile) return null;
  const permissions = profile.role_id ? await request(`/rest/v1/role_permissions?role_id=eq.${encodeURIComponent(profile.role_id)}&select=permission`, accessToken) : [];
  const scopes = profile.role_id ? await request(`/rest/v1/role_scopes?role_id=eq.${encodeURIComponent(profile.role_id)}&select=id,country_id,province_id,district_id`, accessToken) : [];
  const regionCatalog = await loadRegionCatalog(accessToken);
  return { profile, role: profile.roles || null, permissions: [...new Set((permissions || []).map((item) => item.permission))], scopes: scopes || [], regionCatalog };
}
export function can(access, permission) {
  if (!access?.profile?.is_active) return false;
  const permissions = access.permissions || [];
  return access.role?.name === "super_admin" || permissions.includes("*") || permissions.includes(permission);
}
export function canAny(access, permissions) { return permissions.some((permission) => can(access, permission)); }

export function hasScope(access, target = {}) {
  if (!access?.profile?.is_active) return false;
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return true;
  const scopes = access.scopes || [];
  if (!scopes.length) return false;
  const targetCountry = target.countryId ? String(target.countryId) : null;
  const targetProvince = target.provinceId ? String(target.provinceId) : null;
  const targetDistrict = target.districtId ? String(target.districtId) : null;
  return scopes.some((scope) => {
    const country = scope.country_id ? String(scope.country_id) : null;
    const province = scope.province_id ? String(scope.province_id) : null;
    const district = scope.district_id ? String(scope.district_id) : null;
    if (!country && !province && !district) return true;
    if (country && targetCountry && country === targetCountry && !province && !district) return true;
    if (province && targetProvince && province === targetProvince && (!district || (targetDistrict && district === targetDistrict))) return true;
    if (district && targetDistrict && district === targetDistrict) return true;
    return false;
  });
}

function catalogRegionId(region) {
  return region?.id == null ? null : String(region.id);
}
function catalogExternalId(region) {
  return region?.external_id == null ? null : String(region.external_id);
}
function descendantsOf(catalog, rootIds) {
  const allowed = new Set(rootIds.filter(Boolean).map(String));
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of catalog) {
      const id = catalogRegionId(region);
      const parent = region?.parent_id == null ? null : String(region.parent_id);
      if (id && parent && allowed.has(parent) && !allowed.has(id)) {
        allowed.add(id);
        changed = true;
      }
    }
  }
  return allowed;
}

export function getVisibleRegionIds(access) {
  if (!access?.profile?.is_active) return new Set();
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return null;
  const catalog = access.regionCatalog || [];
  const rootIds = [];
  for (const scope of access.scopes || []) {
    const country = scope.country_id ? String(scope.country_id) : null;
    const province = scope.province_id ? String(scope.province_id) : null;
    const district = scope.district_id ? String(scope.district_id) : null;
    if (!country && !province && !district) return null;
    if (country) {
      const match = catalog.find((region) => catalogExternalId(region) === country && String(region.type) === "country");
      if (match) rootIds.push(match.id);
    } else if (province) {
      const match = catalog.find((region) => catalogExternalId(region) === province && String(region.type) === "province");
      if (match) rootIds.push(match.id);
    } else if (district) {
      const match = catalog.find((region) => catalogExternalId(region) === district && String(region.type) === "district");
      if (match) rootIds.push(match.id);
    }
  }
  return descendantsOf(catalog, rootIds);
}

export function isRegionVisible(access, region) {
  const visible = getVisibleRegionIds(access);
  if (visible === null) return true;
  const externalId = region?.id == null ? null : String(region.id);
  const catalog = access?.regionCatalog || [];
  if (externalId && visible.has(externalId)) return true;
  const match = catalog.find((item) => catalogExternalId(item) === externalId);
  return Boolean(match && visible.has(catalogRegionId(match)));
}

export function filterRegionTree(access, countries = [], custom = []) {
  if (getVisibleRegionIds(access) === null) return { countries, custom };
  const visible = getVisibleRegionIds(access);
  const catalog = access?.regionCatalog || [];
  const isVisible = (region) => {
    const externalId = region?.id == null ? null : String(region.id);
    if (!externalId) return false;
    const match = catalog.find((item) => catalogExternalId(item) === externalId);
    return Boolean(match && visible.has(catalogRegionId(match)));
  };
  const filterNode = (node, childKeys) => {
    const childrenKey = childKeys.find((key) => Array.isArray(node?.[key]));
    const children = childrenKey ? node[childrenKey].filter((child) => isVisible(child)).map((child) => filterNode(child, childKeys)) : undefined;
    if (!isVisible(node)) return null;
    if (childrenKey) return { ...node, [childrenKey]: children };
    return node;
  };
  const filteredCountries = (countries || []).map((country) => filterNode(country, ["provinces", "children"])).filter(Boolean);
  const filteredCustom = (custom || []).filter((region) => isVisible(region));
  return { countries: filteredCountries, custom: filteredCustom };
}

export function canManageInScope(access, permission, target) { return can(access, permission) && hasScope(access, target); }
export async function listUsers(accessToken) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "list" }) }); }
export async function createUser(accessToken, payload) { return request("/functions/v1/admin-create-user", accessToken, { method: "POST", body: JSON.stringify(payload) }); }
export async function updateUser(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-user", ...payload }) }); }
export async function createRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "create-role", ...payload }) }); }
export async function updateRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-role", ...payload }) }); }
export async function setRoleScopes(accessToken, roleId, scopes) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "set-role-scopes", role_id: roleId, scopes }) }); }
