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
export const PERMISSIONS = [
  ["regions.view", "Bölgeleri görüntüle"], ["regions.manage", "Bölgeleri yönet"], ["service_areas.view", "Hizmet alanlarını görüntüle"], ["service_areas.manage", "Hizmet alanlarını yönet"],
  ["campaigns.view", "Kampanyaları görüntüle"], ["campaigns.manage", "Kampanyaları yönet"], ["history.view", "Değişiklik geçmişini görüntüle"], ["files.view", "Dosyaları görüntüle"],
  ["files.manage", "Dosyaları yönet"], ["users.manage", "Kullanıcı ve rol yönetimi"], ["data.export", "Veri dışa aktarımı"], ["map.view", "Haritayı görüntüle"]
];
async function loadRegionCatalog(accessToken) { return request("/rest/v1/rpc/get_rbac_region_catalog?select=id,external_id,type,name,parent_id", accessToken, { method: "GET" }); }
export async function getAccess(accessToken, userId) {
  if (!accessToken || !userId) return null;
  const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,role_id,is_active,roles(id,name,description)&limit=1`, accessToken);
  const profile = profiles?.[0] || null;
  if (!profile) throw new Error("Kullanıcı profili bulunamadı.");
  const permissions = profile.role_id ? await request(`/rest/v1/role_permissions?role_id=eq.${encodeURIComponent(profile.role_id)}&select=permission`, accessToken) : [];
  const scopes = profile.role_id ? await request(`/rest/v1/role_scopes?role_id=eq.${encodeURIComponent(profile.role_id)}&select=id,country_id,province_id,district_id`, accessToken) : [];
  const regionCatalog = await loadRegionCatalog(accessToken);
  const access = { profile, role: profile.roles || null, permissions: [...new Set((permissions || []).map((item) => item.permission))], scopes: scopes || [], regionCatalog: regionCatalog || [], loaded: true };
  if (typeof window !== "undefined") { window.RegionConsoleRBAC = window.RegionConsoleRBAC || {}; window.RegionConsoleRBAC.access = access; window.RegionConsoleRBAC.error = null; window.dispatchEvent(new CustomEvent("region-console:rbac-updated")); }
  return access;
}
export function can(access, permission) { if (!access?.loaded || !access?.profile?.is_active) return false; const permissions = access.permissions || []; return access.role?.name === "super_admin" || permissions.includes("*") || permissions.includes(permission); }
export function canAny(access, permissions) { return permissions.some((permission) => can(access, permission)); }
export function hasScope(access, target = {}) {
  if (!access?.loaded || !access?.profile?.is_active) return false;
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return true;
  const scopes = access.scopes || []; if (!scopes.length) return false;
  const targetCountry = target.countryId ? String(target.countryId) : null; const targetProvince = target.provinceId ? String(target.provinceId) : null; const targetDistrict = target.districtId ? String(target.districtId) : null;
  return scopes.some((scope) => { const country = scope.country_id ? String(scope.country_id) : null; const province = scope.province_id ? String(scope.province_id) : null; const district = scope.district_id ? String(scope.district_id) : null; if (!country && !province && !district) return true; if (country && targetCountry && country === targetCountry && !province && !district) return true; if (province && targetProvince && province === targetProvince && (!district || (targetDistrict && district === targetDistrict))) return true; if (district && targetDistrict && district === targetDistrict) return true; return false; });
}
function catalogRegionId(region) { return region?.id == null ? null : String(region.id); }
function catalogExternalId(region) { return region?.external_id == null ? null : String(region.external_id); }
function scopeCatalogMatch(catalog, value, type) { const normalized = value == null ? "" : String(value); if (!normalized) return null; return catalog.find((region) => String(region.type) === String(type) && (catalogRegionId(region) === normalized || catalogExternalId(region) === normalized)) || null; }
function descendantsOf(catalog, rootIds) { const allowed = new Set(rootIds.filter(Boolean).map(String)); let changed = true; while (changed) { changed = false; for (const region of catalog) { const id = catalogRegionId(region); const parent = region?.parent_id == null ? null : String(region.parent_id); if (id && parent && allowed.has(parent) && !allowed.has(id)) { allowed.add(id); changed = true; } } } return allowed; }
export function getVisibleRegionIds(access) {
  if (!access?.loaded || !access?.profile?.is_active) return new Set();
  if (access.role?.name === "super_admin" || (access.permissions || []).includes("*")) return null;
  const catalog = access.regionCatalog || []; const rootIds = [];
  for (const scope of access.scopes || []) { const country = scopeCatalogMatch(catalog, scope.country_id, "country"); const province = scopeCatalogMatch(catalog, scope.province_id, "province"); const district = scopeCatalogMatch(catalog, scope.district_id, "district"); if (country) rootIds.push(country.id); else if (province) rootIds.push(province.id); else if (district) rootIds.push(district.id); else if (!scope.country_id && !scope.province_id && !scope.district_id) return null; }
  return descendantsOf(catalog, rootIds);
}
function regionCandidates(region, explicitType = null) { const hierarchy = region?.hierarchy || {}; const type = explicitType || String(hierarchy.type || region?.type || ""); return [[region?.id, type], [hierarchy.countryId, "country"], [hierarchy.provinceId, "province"], [hierarchy.districtId, "district"]]; }
export function isRegionVisible(access, region) { const visible = getVisibleRegionIds(access); if (visible === null) return true; if (!region) return false; const catalog = access?.regionCatalog || []; return regionCandidates(region).some(([value, type]) => { if (value == null || !String(value) || !type) return false; const match = scopeCatalogMatch(catalog, value, type); return Boolean(match && visible.has(catalogRegionId(match))); }); }
export function filterRegionTree(access, countries = [], custom = []) {
  const visible = getVisibleRegionIds(access);
  if (visible === null) return { countries, custom };
  if (!access?.loaded) return { countries: [], custom: [] };
  const catalog = access?.regionCatalog || [];
  const isVisible = (region, explicitType = null) => regionCandidates(region, explicitType).some(([value, type]) => { if (value == null || !String(value) || !type) return false; const match = scopeCatalogMatch(catalog, value, type); return Boolean(match && visible.has(catalogRegionId(match))); });
  const filterNode = (node, childKeys, explicitType = null) => { if (!isVisible(node, explicitType)) return null; const childrenKey = childKeys.find((key) => Array.isArray(node?.[key])); if (!childrenKey) return node; const children = node[childrenKey].map((child) => filterNode(child, childKeys)).filter(Boolean); return { ...node, [childrenKey]: children }; };
  return { countries: (countries || []).map((country) => filterNode(country, ["provinces", "districts", "neighborhoods", "children"], "country")).filter(Boolean), custom: (custom || []).filter((region) => isVisible(region)) };
}
export function canManageInScope(access, permission, target) { return can(access, permission) && hasScope(access, target); }
export async function listUsers(accessToken) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "list" }) }); }
export async function createUser(accessToken, payload) { return request("/functions/v1/admin-create-user", accessToken, { method: "POST", body: JSON.stringify(payload) }); }
export async function updateUser(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-user", ...payload }) }); }
export async function createRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "create-role", ...payload }) }); }
export async function updateRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-role", ...payload }) }); }
export async function setRoleScopes(accessToken, roleId, scopes) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "set-role-scopes", role_id: roleId, scopes }) }); }
