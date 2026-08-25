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
  return (Array.isArray(custom) ? custom : []).map((region) => {
    const meta = region?.importMeta;
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

function normalizeHierarchy(countries, custom) {
  const nextCountries = structuredClone(Array.isArray(countries) ? countries : []);
  const safeCustom = Array.isArray(custom) ? custom : [];

  const countryFor = (region) => {
    const hierarchy = region?.hierarchy || {};
    return nextCountries.find((country) =>
      String(country.id ?? "") === String(hierarchy.countryId ?? "")
      || String(country.name ?? "").trim().toLocaleLowerCase("tr-TR") === String(hierarchy.countryName ?? "").trim().toLocaleLowerCase("tr-TR")
    );
  };

  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "province").forEach((region) => {
    const country = countryFor(region);
    if (!country) return;
    const list = Array.isArray(country.provinces) ? country.provinces : (Array.isArray(country.children) ? country.children : []);
    if (!findByKeys(list, region.id, region.importMeta?.sourceId)) {
      country.provinces = [...list, structuredClone(region)];
    } else if (!Array.isArray(country.provinces)) {
      country.provinces = list;
    }
    country.count = country.provinces.length;
  });

  const allProvinces = nextCountries.flatMap((country) => Array.isArray(country.provinces) ? country.provinces : []);
  safeCustom.filter((region) => (region?.hierarchy?.type || region?.type) === "district").forEach((region) => {
    const hierarchy = region?.hierarchy || {};
    const province = findByKeys(allProvinces, hierarchy.parentId, region.importMeta?.parentId);
    if (!province) return;
    const list = Array.isArray(province.districts) ? province.districts : (Array.isArray(province.children) ? province.children : []);
    if (!findByKeys(list, region.id, region.importMeta?.sourceId)) province.districts = [...list, structuredClone(region)];
  });

  return nextCountries;
}

export const store = {
  get() {
    return state;
  },

  set(patch) {
    state = { ...state, ...patch };
    notify();
  },

  update(key, patch) {
    state = {
      ...state,
      [key]: {
        ...state[key],
        ...patch
      }
    };
    notify();
  },

  replaceData(data, { recordHistory = false, label = "Güncelleme" } = {}) {
    const before = snapshotData();
    const regions = structuredClone(data.regions || state.regions);
    regions.countries = normalizeHierarchy(regions.countries, regions.custom);
    state = {
      ...state,
      regions,
      campaigns: structuredClone(data.campaigns || state.campaigns),
      importedFiles: structuredClone(data.importedFiles || state.importedFiles),
      mapSettings: structuredClone({ ...state.mapSettings, ...(data.mapSettings || data.regions?.mapSettings || {}) })
    };
    if (recordHistory) {
      this.recordHistory(label, before, snapshotData());
    } else {
      notify();
    }
  },

  recordHistory(label, before, after) {
    const entries = state.history.entries.slice(0, state.history.cursor + 1);
    entries.push({
      id: crypto.randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      before: structuredClone(before),
      after: structuredClone(after)
    });
    const trimmed = entries.slice(-50);
    state = {
      ...state,
      history: {
        entries: trimmed,
        cursor: trimmed.length - 1
      }
    };
    notify();
  },

  undo() {
    const entry = state.history.entries[state.history.cursor];
    if (!entry) return false;
    state = {
      ...state,
      regions: structuredClone(entry.before.regions),
      campaigns: structuredClone(entry.before.campaigns),
      importedFiles: structuredClone(entry.before.importedFiles || []),
      mapSettings: structuredClone({ ...initialState.mapSettings, ...(entry.before.mapSettings || entry.before.regions?.mapSettings || {}) }),
      history: { ...state.history, cursor: state.history.cursor - 1 }
    };
    notify();
    return true;
  },

  redo() {
    const next = state.history.entries[state.history.cursor + 1];
    if (!next) return false;
    state = {
      ...state,
      regions: structuredClone(next.after.regions),
      campaigns: structuredClone(next.after.campaigns),
      importedFiles: structuredClone(next.after.importedFiles || []),
      mapSettings: structuredClone({ ...initialState.mapSettings, ...(next.after.mapSettings || next.after.regions?.mapSettings || {}) }),
      history: { ...state.history, cursor: state.history.cursor + 1 }
    };
    notify();
    return true;
  },

  dataSnapshot() {
    return snapshotData();
  },

  loadPersisted(remoteState) {
    const data = remoteState || {};
    const custom = migrateCustomRegions(Array.isArray(data.custom) ? data.custom : []);
    let importedFiles = Array.isArray(data.importedFiles) ? data.importedFiles : [];

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

    const countries = normalizeHierarchy(Array.isArray(data.countries) ? data.countries : [], custom);
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
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      importedFiles,
      history: {
        entries: Array.isArray(data.history) ? data.history.slice(-50) : [],
        cursor: Array.isArray(data.history) ? data.history.length - 1 : -1
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
