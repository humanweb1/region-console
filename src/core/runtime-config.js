window.REGION_CONSOLE_CONFIG = {
  supabase: {
    url: "https://knmkbjtutzitugntszpq.supabase.co",
    publishableKey: "sb_publishable_d9upGIlNtY6G10-oHACw9Q_23d81Ni8"
  }
};

// Shared map-region type resolver used by the bundled map module.
// Keep this global until map.js can own the helper directly without a generated-bundle compatibility layer.
globalThis.regionType = (region) => {
  const value = String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
  if (["country", "countries", "ülke"].includes(value)) return "country";
  if (["province", "provinces", "il"].includes(value)) return "province";
  if (["district", "districts", "ilce", "ilçe"].includes(value)) return "district";
  if (["neighborhood", "neighbourhood", "mahalle"].includes(value)) return "neighborhood";
  return value;
};
