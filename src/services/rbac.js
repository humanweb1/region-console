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

export async function getAccess(accessToken, userId) {
  if (!accessToken || !userId) return null;
  const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,role_id,is_active,roles(id,name,description)&limit=1`, accessToken);
  const profile = profiles?.[0] || null;
  if (!profile) return null;
  const permissions = profile.role_id ? await request(`/rest/v1/role_permissions?role_id=eq.${encodeURIComponent(profile.role_id)}&select=permission`, accessToken) : [];
  const scopes = profile.role_id ? await request(`/rest/v1/role_scopes?role_id=eq.${encodeURIComponent(profile.role_id)}&select=id,country_id,province_id,district_id`, accessToken) : [];
  return { profile, role: profile.roles || null, permissions: [...new Set((permissions || []).map((item) => item.permission))], scopes: scopes || [] };
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
  return scopes.some((scope) => {
    if (target.countryId && scope.country_id && target.countryId === scope.country_id) return !target.provinceId;
    if (target.provinceId && scope.province_id && target.provinceId === scope.province_id) return !target.districtId;
    return Boolean(target.districtId && scope.district_id && target.districtId === scope.district_id);
  });
}
export function canManageInScope(access, permission, target) { return can(access, permission) && hasScope(access, target); }
export async function listUsers(accessToken) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "list" }) }); }
export async function createUser(accessToken, payload) { return request("/functions/v1/admin-create-user", accessToken, { method: "POST", body: JSON.stringify(payload) }); }
export async function updateUser(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-user", ...payload }) }); }
export async function createRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "create-role", ...payload }) }); }
export async function updateRole(accessToken, payload) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "update-role", ...payload }) }); }
export async function setRoleScopes(accessToken, roleId, scopes) { return request("/functions/v1/admin-rbac", accessToken, { method: "POST", body: JSON.stringify({ action: "set-role-scopes", role_id: roleId, scopes }) }); }
