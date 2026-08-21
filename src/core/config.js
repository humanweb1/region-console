const defaults = {
  version: "0.1.0",
  supabaseUrl: "",
  supabasePublishableKey: "",
  map: {
    center: [39.0, 35.0],
    zoom: 5
  }
};

const runtime = window.REGION_CONSOLE_CONFIG || {};
const supabase = runtime.supabase || {};

export const config = Object.freeze({
  ...defaults,
  ...runtime,
  supabaseUrl: supabase.url || runtime.supabaseUrl || defaults.supabaseUrl,
  supabasePublishableKey:
    supabase.publishableKey ||
    runtime.supabasePublishableKey ||
    defaults.supabasePublishableKey
});

export function assertConfig() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error("Supabase yapılandırması eksik. src/core/config.js ayarlanmalı.");
  }
}
