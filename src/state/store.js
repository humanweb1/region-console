const initialState = {
  auth: {
    status: "unknown",
    session: null,
    user: null
  },
  cloud: {
    status: "idle",
    version: null,
    error: null,
    updatedAt: null
  },
  regions: {
    countries: [],
    custom: [],
    selectedId: null
  },
  map: {
    drawing: false,
    layer: "standard"
  },
  mapSettings: {
    boundaryColor: "#ffffff",
    boundaryWeight: 1.5,
    outsideColor: "#4b5563",
    outsideOpacity: 0.55,
    campaignColor: "#ffd400",
    campaignOpacity: 0.55
  },
  history: {
    entries: [],
    cursor: -1
  },
  campaigns: [],
  importedFiles: [],
  ui: {
    theme: "dark",
    activeTool: "draw"
  }
};

let state = structuredClone(initialState);
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(state));
}

function snapshotData() {
  return structuredClone({
    regions: { ...state.regions, mapSettings: state.mapSettings },
    campaigns: state.campaigns,
    importedFiles: state.importedFiles,
    mapSettings: state.mapSettings
  });
}

function swapPair([first, second]) {
  return [second, first];
}

function swapGeometryCoordinates(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: (geometry.coordinates || []).map((ring) =>
        (ring || []).map((point) => Array.isArray(point) ? swapPair(point) : point)
      )
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: (geometry.coordinates || []).map((polygon) =>
        (polygon || []).map((ring) =>
          (ring || []).map((point) => Array.isArray(point) ? swapPair(point) : point)
        )
      )
    };
  }
  return geometry;
}

function migrateCustomRegions(custom) {
  return (Array.isArray(custom) ? custom : [])
    .filter((region) => region && typeof region === "object")
    .map((region) => {
      const meta = region.importMeta;
      if (!meta?.format || meta.format !== "GeoJSON" || meta.coordinateOrder) return region;

      return {
        ...region,
        geometry: swapGeometryCoordinates(region.geometry),
        importMeta: {
          ...meta,
          coordinateOrder: "lonlat",
          migratedAt: new Date().toISOString()
        }
      };
    });
}

function regionKey(region) {
  return String(region?.id ?? region?.importMeta?.sourceId ?? "");
}

function sourceKey(region) {
  return String(region?.importMeta?.sourceId ?? region?.id ?? "");
}

function findByKeys(items, ...keys) {
  const wanted = keys.filter((value) => value !== null && value !== undefined && String(value) !== "").map(String);
  if (!wanted.length) return null;
  return (items || []).find((item) => wanted.includes(regionKey(item)) || wanted.includes(sourceKey(item))) || null;
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "").toLowerCase();
}

function regionParentId(region) {
  return region?.hierarchy?.parentId ?? region?.parent_id ?? null;
}

function cloneWithHierarchy(region, hierarchy) {
  return { ...region, hierarchy: { ...(region.hierarchy || {}), ...hierarchy } };
}

function normalizeHierarchy(countries, custom) {
  const byId = new Map();
  const byExternalId = new Map();
  const byNameTypeParent = new Map();
  const register = (region, type, parentId = null) => {
    if (!region || typeof region !== "object") return;
    const id = region.id != null ? String(region.id) : "";
    const externalId = region.importMeta?.properties?.id ?? region.external_id ?? null;
    const name = normalizeName(region.name || region.properties?.name || "");
    if (id) byId.set(id, region);
    if (externalId != null && String(externalId)) byExternalId.set(String(externalId), region);
    if (name) byNameTypeParent.set(`${type}:${name}:${String(parentId || "")}`, region);
  };

  const visit = (items, parent = null) => {
    for (const item of items || []) {
      if (!item || typeof item !== "object") continue;
      const type = regionType(item);
      const parentId = parent?.id ?? regionParentId(item) ?? null;
      register(item, type, parentId);
      const children = [
        ...(Array.isArray(item.provinces) ? item.provinces : []),
        ...(Array.isArray(item.districts) ? item.districts : []),
        ...(Array.isArray(item.neighborhoods) ? item.neighborhoods : []),
        ...(Array.isArray(item.cemeteries) ? item.cemeteries : []),
        ...(Array.isArray(item.children) ? item.children : [])
      ];
      visit(children, item);
    }
  };

  visit(countries);
  visit(custom);

  const resolveParent = (region) => {
    const hierarchy = region?.hierarchy || {};
    const parentId = hierarchy.parentId ?? null;
    const parentName = normalizeName(hierarchy.parentName);
    const parentType = String(hierarchy.parentType || "").toLowerCase();
    if (parentId != null && byId.has(String(parentId))) return byId.get(String(parentId));
    if (parentName && parentType) return byNameTypeParent.get(`${parentType}:${parentName}:${String(hierarchy.countryId || "")}`) || null;
    return null;
  };

  const normalizeNode = (item, parent = null) => {
    if (!item || typeof item !== "object") return null;
    const type = regionType(item);
    const parentRegion = parent || resolveParent(item);
    const parentId = parentRegion?.id ?? item?.hierarchy?.parentId ?? null;
    const parentType = parentRegion ? regionType(parentRegion) : item?.hierarchy?.parentType || null;
    const country = type === "country" ? item : parentRegion?.hierarchy?.countryId ? byId.get(String(parentRegion.hierarchy.countryId)) : null;
    const hierarchy = {
      ...(item.hierarchy || {}),
      type: type || item?.hierarchy?.type || null,
      parentId,
      parentType,
      parentName: parentRegion?.name || item?.hierarchy?.parentName || null,
      countryId: type === "country" ? item.id : country?.id || item?.hierarchy?.countryId || null,
      countryName: type === "country" ? item.name : country?.name || item?.hierarchy?.countryName || null
    };
    const result = cloneWithHierarchy(item, hierarchy);
    for (const key of ["provinces", "districts", "neighborhoods", "cemeteries", "children"]) {
      if (!Array.isArray(item[key])) continue;
      result[key] = item[key].map((child) => normalizeNode(child, result)).filter(Boolean);
    }
    return result;
  };

  return (countries || []).map((country) => normalizeNode(country)).filter(Boolean);
}

const store = {
  get() {
    return state;
  },

  set(patch) {
    state = { ...state, ...patch };
    notify();
  },

  update(section, patch) {
    state = { ...state, [section]: { ...state[section], ...patch } };
    notify();
  },

  dataSnapshot() {
    return snapshotData();
  },

  loadPersisted(remoteState) {
    const data = remoteState || {};
    const custom = migrateCustomRegions(Array.isArray(data.custom) ? data.custom : []);
    let importedFiles = Array.isArray(data.importedFiles) ? data.importedFiles.filter((file) => file && typeof file === "object") : [];

    if (!importedFiles.length) {
      const legacyGroups = new Map();
      custom.forEach((region) => {
        const fileName = region?.importMeta?.sourceFile;
        if (!fileName) return;
        const key = String(fileName);
        if (!legacyGroups.has(key)) {
          legacyGroups.set(key, {
            id: `legacy-file-${key}`,
            name: key,
            size: null,
            importedAt: region.importMeta.importedAt || region.createdAt || new Date().toISOString(),
            regionCount: 0
          });
        }
        legacyGroups.get(key).regionCount += 1;
      });
      importedFiles = [...legacyGroups.values()];
    }

    const countries = normalizeHierarchy(
      Array.isArray(data.countries) ? data.countries.filter((region) => region && typeof region === "object") : [],
      custom
    );
    state = {
      ...state,
      regions: {
        countries,
        custom,
        selectedId: null
      },
      mapSettings: {
        ...initialState.mapSettings,
        ...(data.mapSettings || data.regions?.mapSettings || {})
      },
      campaigns: Array.isArray(data.campaigns) ? data.campaigns.filter((campaign) => campaign && typeof campaign === "object") : [],
      importedFiles,
      history: {
        entries: Array.isArray(data.history) ? data.history.filter((entry) => entry && typeof entry === "object").slice(-50) : [],
        cursor: Array.isArray(data.history) ? Math.min(data.history.length - 1, 49) : -1
      }
    };
    notify();
  },

  reset() {
    state = structuredClone(initialState);
    notify();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

export { store };