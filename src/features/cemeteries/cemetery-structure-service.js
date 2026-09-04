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
    throw new Error(`Mezarlık verisi isteği başarısız (${response.status}): ${detail}`);
  }
  return data;
}

const sectionSelect = "id,cemetery_id,name,code,geometry,metadata,is_active,geometry_status,geometry_source,geometry_version,geometry_updated_at,created_at,updated_at";
const graveSelect = "id,cemetery_id,section_id,label,code,latitude,longitude,status,metadata,is_active,created_at,updated_at";

export async function listSections(accessToken, cemeteryId) {
  return request(`/rest/v1/cemetery_sections?select=${sectionSelect}&cemetery_id=eq.${encodeURIComponent(cemeteryId)}&is_active=eq.true&order=name.asc&limit=5000`, accessToken);
}

export async function createSection(accessToken, payload) {
  const rows = await request("/rest/v1/cemetery_sections", accessToken, {
    method: "POST",
    headers: headers(accessToken, "return=representation"),
    body: JSON.stringify({
      cemetery_id: payload.cemeteryId,
      name: payload.name,
      code: payload.code || null,
      geometry: payload.geometry || null,
      geometry_status: payload.geometry ? "manual" : "missing",
      geometry_source: payload.geometry ? (payload.geometrySource || "manual") : "catalog",
      metadata: payload.metadata || {}
    })
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function updateSection(accessToken, id, patch) {
  const body = {};
  const allowed = { name: "name", code: "code", geometry: "geometry", metadata: "metadata", geometryStatus: "geometry_status", geometrySource: "geometry_source", isActive: "is_active" };
  for (const [key, value] of Object.entries(patch || {})) if (allowed[key]) body[allowed[key]] = value;
  const rows = await request(`/rest/v1/cemetery_sections?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: "PATCH", headers: headers(accessToken, "return=representation"), body: JSON.stringify(body)
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function archiveSection(accessToken, id) { return updateSection(accessToken, id, { isActive: false }); }

export async function listGraves(accessToken, cemeteryId) {
  return request(`/rest/v1/graves?select=${graveSelect}&cemetery_id=eq.${encodeURIComponent(cemeteryId)}&is_active=eq.true&order=label.asc&limit=10000`, accessToken);
}

export async function createGrave(accessToken, payload) {
  const rows = await request("/rest/v1/graves", accessToken, {
    method: "POST",
    headers: headers(accessToken, "return=representation"),
    body: JSON.stringify({
      cemetery_id: payload.cemeteryId,
      section_id: payload.sectionId || null,
      label: payload.label,
      code: payload.code || null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      status: payload.status || "available",
      metadata: payload.metadata || {}
    })
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function updateGrave(accessToken, id, patch) {
  const body = {};
  const allowed = { sectionId: "section_id", label: "label", code: "code", latitude: "latitude", longitude: "longitude", status: "status", metadata: "metadata", isActive: "is_active" };
  for (const [key, value] of Object.entries(patch || {})) if (allowed[key]) body[allowed[key]] = value;
  const rows = await request(`/rest/v1/graves?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: "PATCH", headers: headers(accessToken, "return=representation"), body: JSON.stringify(body)
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function archiveGrave(accessToken, id) { return updateGrave(accessToken, id, { isActive: false }); }
