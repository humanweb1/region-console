import { config, assertConfig } from "../../core/config.js";

function headers(accessToken, prefer = "") {
  return {
    apikey: config.supabasePublishableKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function request(path, accessToken, options = {}) {
  assertConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: { ...headers(accessToken), ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = data?.message || data?.msg || data?.details || `HTTP ${response.status}`;
    throw new Error(`Mezarlık isteği başarısız (${response.status}): ${detail}`);
  }
  return data;
}

export async function listCemeteries(accessToken) {
  return request(
    "/rest/v1/cemeteries?select=id,region_id,name,code,external_id,geometry,metadata,is_active,geometry_status,geometry_source,geometry_version,geometry_updated_at,created_at,updated_at&is_active=eq.true&order=name.asc&limit=2000",
    accessToken
  );
}

export async function createCemetery(accessToken, payload) {
  const rows = await request("/rest/v1/cemeteries", accessToken, {
    method: "POST",
    headers: headers(accessToken, "return=representation"),
    body: JSON.stringify({
      region_id: payload.regionId,
      name: payload.name,
      code: payload.code || null,
      external_id: payload.externalId || null,
      metadata: payload.metadata || {},
      geometry: payload.geometry || null,
      geometry_status: payload.geometry ? "available" : "missing",
      geometry_source: payload.geometry ? (payload.geometrySource || "manual") : "catalog"
    })
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function updateCemetery(accessToken, id, patch) {
  const body = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!["name", "code", "externalId", "metadata", "geometry", "geometryStatus", "geometrySource", "isActive"].includes(key)) continue;
    const dbKey = { externalId: "external_id", geometryStatus: "geometry_status", geometrySource: "geometry_source", isActive: "is_active" }[key] || key;
    body[dbKey] = value;
  }
  const rows = await request(`/rest/v1/cemeteries?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: "PATCH",
    headers: headers(accessToken, "return=representation"),
    body: JSON.stringify(body)
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function archiveCemetery(accessToken, id) {
  return updateCemetery(accessToken, id, { isActive: false });
}
