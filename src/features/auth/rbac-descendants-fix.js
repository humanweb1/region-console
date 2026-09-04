function normalized(value) {
  return value == null ? "" : String(value);
}

function catalogIndex(access) {
  const catalog = Array.isArray(access?.regionCatalog) ? access.regionCatalog : [];
  const byId = new Map();
  const byNameType = new Map();
  for (const region of catalog) {
    const id = normalized(region?.id);
    if (id) byId.set(id, region);
    const key = `${normalized(region?.type).toLowerCase()}:${normalized(region?.name).trim().toLocaleLowerCase("tr-TR")}`;
    if (key !== ":") byNameType.set(key, region);
  }
  return { catalog, byId, byNameType };
}

function resolveRoot(index, scope, type) {
  const idKey = `${type}_id`;
  const nameKey = `${type}_name`;
  const id = normalized(scope?.[idKey]);
  if (id && index.byId.has(id)) return index.byId.get(id);
  const name = normalized(scope?.[nameKey]).trim().toLocaleLowerCase("tr-TR");
  return name ? index.byNameType.get(`${type}:${name}`) || null : null;
}

function descendants(index, root) {
  if (!root?.id) return [];
  const result = [];
  const queue = [normalized(root.id)];
  const seen = new Set(queue);
  while (queue.length) {
    const parentId = queue.shift();
    for (const region of index.catalog) {
      const id = normalized(region?.id);
      const candidateParent = normalized(region?.parent_id);
      if (!id || !candidateParent || candidateParent !== parentId || seen.has(id)) continue;
      seen.add(id);
      result.push(region);
      queue.push(id);
    }
  }
  return result;
}

function descendantScope(scope, region) {
  const type = normalized(region?.type).toLowerCase();
  if (type === "province") return { country_id: scope.country_id || null, province_id: region.id, province_name: region.name || null, district_id: null, district_name: null };
  if (type === "district") return { country_id: scope.country_id || null, province_id: null, district_id: region.id, district_name: region.name || null };
  return null;
}

function expand(access) {
  if (!access?.loaded || access?.role?.name === "super_admin" || (access.permissions || []).includes("*")) return;
  const scopes = Array.isArray(access.scopes) ? access.scopes : [];
  if (!scopes.length) return;
  const index = catalogIndex(access);
  const expanded = [];
  const seen = new Set();

  const add = (scope) => {
    const key = `${normalized(scope?.country_id)}|${normalized(scope?.province_id)}|${normalized(scope?.district_id)}`;
    if (key === "||" || seen.has(key)) return;
    seen.add(key);
    expanded.push({ ...scope });
  };

  for (const scope of scopes) {
    add(scope);
    let rootType = null;
    if (scope?.district_id) rootType = "district";
    else if (scope?.province_id) rootType = "province";
    else if (scope?.country_id) rootType = "country";
    if (!rootType) continue;

    const root = resolveRoot(index, scope, rootType);
    if (!root) continue;
    for (const child of descendants(index, root)) {
      const synthetic = descendantScope(scope, child);
      if (synthetic) add(synthetic);
    }
  }

  access.scopes = expanded;
}

let rebroadcasting = false;
function apply() {
  const access = window.RegionConsoleRBAC?.access || null;
  if (!access?.loaded) return;
  expand(access);
  if (rebroadcasting) return;
  rebroadcasting = true;
  try {
    window.dispatchEvent(new CustomEvent("region-console:rbac-updated"));
  } finally {
    rebroadcasting = false;
  }
}

window.addEventListener("region-console:rbac-updated", () => {
  if (rebroadcasting) return;
  apply();
});

if (window.RegionConsoleRBAC?.access?.loaded) apply();
