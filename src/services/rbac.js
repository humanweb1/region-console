import { config, assertConfig } from "../core/config.js";

function headers(accessToken) {
  return {
    apikey: config.supabasePublishableKey,
    Authorization: accessToken ? `Bearer ${accessToken}` : "",
    "Content-Type": "application/json"
  };
}

async function parse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || data?.msg || "RBAC isteği başarısız.");
  return data;
}

export const PERMISSIONS = [
  ["regions.view", "Bölgeleri görüntüle"],
  ["regions.manage", "Bölgeleri yönet"],
  ["service_areas.view", "Hizmet alanlarını görüntüle"],
  ["service_areas.manage", "Hizmet alanlarını yönet"],
  ["campaigns.view", "Kampanyaları görüntüle"],
  ["campaigns.manage", "Kampanyaları yönet"],
  ["history.view", "Değişiklik geçmişini görüntüle"],
  ["audit.view", "Denetim kayıtlarını görüntüle"],
  ["users.manage", "Kullanıcı ve rol yönetimi"]
];

export function hasPermission(auth, permission) {
  if (!auth) return false;
  if (auth.role?.name === "super_admin") return true;
  return Boolean(auth.permissions?.includes("*") || auth.permissions?.includes(permission));
}

export async function loadMyAccess(accessToken, userId) {
  assertConfig();
  if (!accessToken || !userId) throw new Error("RBAC oturumu bulunamadı.");
  const base = `${config.supabaseUrl}/rest/v1`;
  const profileResponse = await fetch(`${base}/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,is_active,role_id,roles(id,name,description)`, { headers: headers(accessToken) });
  const profileRows = await parse(profileResponse);
  const profile = profileRows?.[0];
  if (!profile) throw new Error("Kullanıcı profili bulunamadı.");
  if (!profile.is_active) throw new Error("Kullanıcı hesabı pasif.");
  const permissionResponse = await fetch(`${base}/role_permissions?role_id=eq.${encodeURIComponent(profile.role_id)}&select=permission`, { headers: headers(accessToken) });
  const permissionRows = await parse(permissionResponse);
  return { profile, role: profile.roles || null, permissions: permissionRows.map((item) => item.permission) };
}

export async function adminRbac(accessToken, payload = {}) {
  assertConfig();
  if (!accessToken) throw new Error("Aktif oturum bulunamadı.");
  const response = await fetch(`${config.supabaseUrl}/functions/v1/admin-rbac`, { method: "POST", headers: headers(accessToken), body: JSON.stringify(payload) });
  return parse(response);
}

export async function createManagedUser(accessToken, { full_name, email, password, role_id }) {
  assertConfig();
  if (!accessToken) throw new Error("Aktif oturum bulunamadı.");
  const response = await fetch(`${config.supabaseUrl}/functions/v1/admin-create-user`, { method: "POST", headers: headers(accessToken), body: JSON.stringify({ full_name, email, password, role_id }) });
  return parse(response);
}
