import { config, assertConfig } from "../core/config.js";

function authHeaders(accessToken) {
  return {
    apikey: config.supabasePublishableKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
}

async function request(path, accessToken, options = {}) {
  assertConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 10000);

  try {
    const response = await fetch(`${config.supabaseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders(accessToken),
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const detail = data?.message || data?.msg || data?.hint || data?.error_description || data?.details || `HTTP ${response.status}`;
      const error = new Error(`Bulut isteği başarısız (${response.status}): ${detail}`);
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Bulut isteği zaman aşımına uğradı.");
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadState(accessToken) {
  const rows = await request(
    "/rest/v1/region_console_state?id=eq.main&select=id,state,version,updated_at&limit=1",
    accessToken,
    { timeout: 30000 }
  );
  return rows?.[0] || null;
}

function stripCatalogOnly(value) {
  if (Array.isArray(value)) return value.filter((item) => !item?.catalogOnly).map(stripCatalogOnly);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "catalogOnly") continue;
    result[key] = stripCatalogOnly(child);
  }
  return result;
}

export async function saveState(accessToken, state, version = null) {
  const cloudState = state && typeof state === "object"
    ? stripCatalogOnly({ ...state, history: [] })
    : state;

  const payload = {
    p_state: cloudState,
    p_version: version ?? Date.now()
  };

  const result = await request(
    "/rest/v1/rpc/save_region_console_state",
    accessToken,
    {
      method: "POST",
      timeout: 30000,
      body: JSON.stringify(payload)
    }
  );

  return Array.isArray(result) ? result[0] || null : result || null;
}

export async function upsertState(accessToken, state) {
  return saveState(accessToken, state);
}
