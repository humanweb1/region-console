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
      throw new Error(
        data?.message ||
        data?.msg ||
        data?.hint ||
        `Bulut isteği başarısız (${response.status}).`
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadState(accessToken) {
  const rows = await request(
    "/rest/v1/region_console_state?id=eq.main&select=id,state,version,updated_at&limit=1",
    accessToken
  );
  return rows?.[0] || null;
}

export async function saveState(accessToken, state, version = null) {
  const body = {
    state,
    version: version ?? Date.now(),
    updated_at: new Date().toISOString()
  };

  const rows = await request(
    "/rest/v1/region_console_state?id=eq.main",
    accessToken,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    }
  );

  return rows?.[0] || null;
}
