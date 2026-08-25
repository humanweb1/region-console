import { config, assertConfig } from "../core/config.js";

function headers(accessToken) {
  return {
    apikey: config.supabasePublishableKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
}

async function request(path, accessToken, options = {}) {
  assertConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 10000);
  try {
    const response = await fetch(`${config.supabaseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...headers(accessToken), ...(options.headers || {}) }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      throw new Error(data?.message || data?.msg || `HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveHistoryEntry(accessToken, entry) {
  if (!accessToken) return null;
  const result = await request("/rest/v1/rpc/save_region_console_history", accessToken, {
    method: "POST",
    timeout: 10000,
    body: JSON.stringify({ p_entry: entry })
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function loadHistoryEntries(accessToken, limit = 5, offset = 0) {
  if (!accessToken) return [];
  const result = await request("/rest/v1/rpc/load_region_console_history", accessToken, {
    method: "POST",
    timeout: 10000,
    body: JSON.stringify({ p_limit: limit, p_offset: offset })
  });
  return Array.isArray(result) ? result : [];
}
