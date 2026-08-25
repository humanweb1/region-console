import { store } from "../../state/store.js";

const REGION_TYPES = {
  country: { label: "Ülke", level: 0, parentType: null },
  province: { label: "İl", level: 1, parentType: "country" },
  district: { label: "İlçe", level: 2, parentType: "province" },
  neighborhood: { label: "Mahalle", level: 3, parentType: "district" },
  cemetery: { label: "Mezarlık", level: 4, parentType: "neighborhood" },
  independent: { label: "Bağımsız Bölge", level: 0, parentType: null }
};

const REGION_TYPE_OPTIONS = [
  ["country", "Ülke"],
  ["province", "İl"],
  ["district", "İlçe"],
  ["neighborhood", "Mahalle"],
  ["cemetery", "Mezarlık"],
  ["independent", "Bağımsız Bölge"]
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    .replace(/ç/g, "c");
}

function isFiniteCoordinatePair(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;
  const points = ring
    .filter(isFiniteCoordinatePair)
    .map(([lng, lat]) => [Number(lng), Number(lat)]);
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates || []).map(normalizeRing).filter(Boolean);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = (geometry.coordinates || [])
      .map((polygon) => (polygon || []).map(normalizeRing).filter(Boolean))
      .filter((polygon) => polygon.length);
    return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
  }
  return null;
}

function geometryCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function buildBounds(geometry) {
  const points = geometryCoordinates(geometry);
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)]
  ];
}

function featureList(input) {
  if (input?.type === "FeatureCollection" && Array.isArray(input.features)) return input.features;
  if (input?.type === "Feature") return [input];
  if (input?.type === "Polygon" || input?.type === "MultiPolygon") {
    return [{ type: "Feature", geometry: input, properties: {} }];
  }
  if (Array.isArray(input)) return input;
  return [];
}

function isRegionConsoleExport(input) {
  return Boolean(input && typeof input === "object" && input.regions && Array.isArray(input.regions.custom));
}

function stableSourceId(feature, index) {
  const properties = feature?.properties || {};
  return String(
    properties.id
      ?? properties.ID
      ?? properties.code
      ?? properties.Code
      ?? feature?.id
      ?? index
  );
}

function normalizeRegionType(value) {
  const raw = String(value || "").trim().toLocaleLowerCase("tr-TR");
  const aliases = {
    country: "country", countries: "country", ülke: "country",
    il: "province", province: "province", provinces: "province",
    ilçe: "district", ilce: "district", district: "district",
    mahalle: "neighborhood", neighborhood: "neighborhood",
    mezarlık: "cemetery", mezarlik: "cemetery", cemetery: "cemetery",
    bağımsız: "independent", "bağımsız bölge": "independent",
    bagimsiz: "independent", "bagimsiz bolge": "independent", independent: "independent"
  };
  return aliases[raw] || null;
}

function askRegionType() {
  if (typeof window === "undefined" || typeof window.prompt !== "function") return "independent";
  const options = REGION_TYPE_OPTIONS.map(([value, label], index) => `${index + 1}. ${label}`).join("\n");
  const answer = window.prompt(`İçe aktarılan dosyanın bölge tipini seçin:\n\n${options}\n\n1-6 arasında seçim yapın.`, "6");
  if (answer === null) throw new Error("İçe aktarma iptal edildi.");
  const normalized = normalizeRegionType(answer);
  if (normalized) return normalized;
  const numeric = Number.parseInt(String(answer).trim(), 10);
  if (numeric >= 1 && numeric <= REGION_TYPE_OPTIONS.length) return REGION_TYPE_OPTIONS[numeric - 1][0];
  throw new Error("Geçersiz bölge tipi seçildi.");
}

function propertyValue(properties, keys) {
  for (const key of keys) {
    if (properties?.[key] !== undefined && properties?.[key] !== null && String(properties[key]).trim() !== "") return properties[key];
  }
  return null;
}

function hierarchyMeta(regionType, properties = {}) {
  const definition = REGION_TYPES[regionType] || REGION_TYPES.independent;
  const directId = propertyValue(properties, [
    "parentId", "parent_id", "parentID", "parentCode", "parent_code", "parent_id_1",
    ...(regionType === "district" ? ["provinceId", "province_id", "provinceCode", "province_code"] : []),
    ...(regionType === "neighborhood" ? ["districtId", "district_id", "districtCode", "district_code"] : []),
    ...(regionType === "cemetery" ? ["neighborhoodId", "neighborhood_id", "neighborhoodCode", "neighborhood_code"] : [])
  ]);
  const directName = propertyValue(properties, [
    "parentName", "parent_name", "parentTitle", "parent_title",
    ...(regionType === "district" ? ["provinceName", "province_name", "province", "il"] : []),
    ...(regionType === "neighborhood" ? ["districtName", "district_name", "district", "ilce"] : []),
    ...(regionType === "cemetery" ? ["neighborhoodName", "neighborhood_name", "neighborhood", "mahalle"] : [])
  ]);
  const countryId = propertyValue(properties, ["countryId", "country_id", "countryCode", "country_code"]);
  const countryName = propertyValue(properties, ["countryName", "country_name", "country"]);

  return {
    type: regionType,
    label: definition.label,
    level: definition.level,
    parentType: definition.parentType,
    parentId: directId == null ? null : String(directId),
    parentName: directName == null ? null : String(directName).trim(),
    countryId: countryId == null ? null : String(countryId),
    countryName: countryName == null ? null : String(countryName).trim(),
    rootType: definition.level === 0 ? regionType : "country"
  };
}

function countryList() {
  return Array.isArray(store.get().regions?.countries) ? store.get().regions.countries : [];
}

function provinceList() {
  return countryList().flatMap((country) => (Array.isArray(country.provinces) ? country.provinces : Array.isArray(country.children) ? country.children : []).map((province) => ({ ...province, _countryId: country.id, _countryName: country.name })));
}

function customList(type) {
  return (store.get().regions?.custom || []).filter((region) => (region?.hierarchy?.type || region?.type) === type);
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id ?? item?.importMeta?.sourceId ?? item?.name ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function countryIdForProvince(province) {
  return province?._countryId || province?.hierarchy?.countryId || province?.hierarchy?.countryName || null;
}

function provinceIdForRegion(region) {
  return region?.hierarchy?.parentId || null;
}

function regionMatchesParent(region, parent) {
  const parentId = String(parent?.id ?? "");
  const parentName = normalizeName(parent?.name);
  const hierarchy = region?.hierarchy || {};
  return (hierarchy.parentId && String(hierarchy.parentId) === parentId)
    || (hierarchy.parentName && normalizeName(hierarchy.parentName) === parentName);
}

function getParentOptions(regionType, selectedCountryId, selectedProvinceId, selectedDistrictId) {
  if (regionType === "province") return countryList();
  if (regionType === "district") {
    return provinceList().filter((province) => String(countryIdForProvince(province)) === String(selectedCountryId));
  }
  if (regionType === "neighborhood") {
    return customList("district").filter((district) => {
      const provinceId = provinceIdForRegion(district);
      if (selectedProvinceId && provinceId && String(provinceId) !== String(selectedProvinceId)) return false;
      return true;
    });
  }
  if (regionType === "cemetery") {
    return customList("neighborhood").filter((neighborhood) => {
      const districtId = provinceIdForRegion(neighborhood);
      if (selectedDistrictId && districtId && String(districtId) !== String(selectedDistrictId)) return false;
      return true;
    });
  }
  return [];
}

function installImportDialogEnhancer() {
  if (typeof document === "undefined") return;
  const observer = new MutationObserver(() => {
    const form = document.querySelector("#importSettingsForm");
    if (!form || form.dataset.hierarchyEnhanced === "true") return;
    form.dataset.hierarchyEnhanced = "true";

    const typeSelect = form.querySelector("#importRegionType");
    const countryFields = form.querySelector("#importCountryFields");
    const countrySelect = form.querySelector("#importCountryId");
    const newCountryWrap = form.querySelector("#newCountryNameWrap");
    const countryName = form.querySelector("#importCountryName");
    const countryOnly = form.querySelector("#importCountryOnly");
    const rootCountryName = form.querySelector("#importRootCountryName");
    if (!typeSelect || !countrySelect) return;

    const parentHost = document.createElement("div");
    parentHost.id = "importHierarchyFields";
    parentHost.className = "import-hierarchy-fields";
    parentHost.innerHTML = `
      <div id="importProvinceWrap" hidden><label>İl<select id="importProvinceSelect"></select></label></div>
      <div id="importDistrictWrap" hidden><label>İlçe<select id="importDistrictSelect"></select></label></div>
      <div id="importNeighborhoodWrap" hidden><label>Mahalle<select id="importNeighborhoodSelect"></select></label></div>`;
    form.querySelector(".dialog-muted")?.after(parentHost);

    const provinceWrap = parentHost.querySelector("#importProvinceWrap");
    const districtWrap = parentHost.querySelector("#importDistrictWrap");
    const neighborhoodWrap = parentHost.querySelector("#importNeighborhoodWrap");
    const provinceSelect = parentHost.querySelector("#importProvinceSelect");
    const districtSelect = parentHost.querySelector("#importDistrictSelect");
    const neighborhoodSelect = parentHost.querySelector("#importNeighborhoodSelect");

    const fill = (select, items, placeholder, value = "") => {
      select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${uniqueById(items).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "İsimsiz")}</option>`).join("")}`;
      if ([...select.options].some((option) => option.value === String(value))) select.value = String(value);
    };

    const setCountryValue = (id) => {
      if (!id) return;
      countrySelect.value = String(id);
      if (countrySelect.value !== String(id)) {
        const country = countryList().find((item) => String(item.id) === String(id));
        if (country) {
          countrySelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(country.id)}">${escapeHtml(country.name)}</option>`);
          countrySelect.value = String(country.id);
        }
      }
    };

    const sync = () => {
      const type = typeSelect.value;
      const countries = countryList();
      const isCountry = type === "country";
      const isIndependent = type === "independent";
      countryOnly.hidden = !isCountry;
      countryFields.hidden = isCountry || isIndependent || type !== "province";
      newCountryWrap.hidden = true;
      countryName.required = false;
      rootCountryName.required = isCountry;
      provinceWrap.hidden = !["district", "neighborhood", "cemetery"].includes(type);
      districtWrap.hidden = !["neighborhood", "cemetery"].includes(type);
      neighborhoodWrap.hidden = type !== "cemetery";

      if (type === "province") {
        const isNew = countrySelect.value === "__new__";
        newCountryWrap.hidden = !isNew;
        countryName.required = isNew;
      }

      if (type === "district") {
        const selectedCountryId = countrySelect.value;
        fill(provinceSelect, getParentOptions("district", selectedCountryId, "", ""), "İl seçin");
      }

      if (type === "neighborhood") {
        const selectedProvinceId = provinceSelect.value;
        const districts = getParentOptions("neighborhood", countrySelect.value, selectedProvinceId, "");
        fill(districtSelect, districts, "İlçe seçin");
      }

      if (type === "cemetery") {
        const selectedProvinceId = provinceSelect.value;
        const districts = getParentOptions("neighborhood", countrySelect.value, selectedProvinceId, "");
        fill(districtSelect, districts, "İlçe seçin", districtSelect.value);
        const neighborhoods = getParentOptions("cemetery", countrySelect.value, selectedProvinceId, districtSelect.value);
        fill(neighborhoodSelect, neighborhoods, "Mahalle seçin", neighborhoodSelect.value);
      }

      if (type === "neighborhood" || type === "cemetery") {
        const district = customList("district").find((item) => String(item.id) === String(districtSelect.value));
        const provinceId = district?.hierarchy?.parentId || provinceSelect.value;
        const province = provinceList().find((item) => String(item.id) === String(provinceId));
        if (province) {
          provinceSelect.value = String(province.id);
          setCountryValue(countryIdForProvince(province));
        }
      }

      if (type === "cemetery") {
        const neighborhood = customList("neighborhood").find((item) => String(item.id) === String(neighborhoodSelect.value));
        const districtId = neighborhood?.hierarchy?.parentId || districtSelect.value;
        const district = customList("district").find((item) => String(item.id) === String(districtId));
        if (district) districtSelect.value = String(district.id);
      }
    };

    typeSelect.addEventListener("change", sync);
    countrySelect.addEventListener("change", sync);
    provinceSelect.addEventListener("change", () => {
      const province = provinceList().find((item) => String(item.id) === String(provinceSelect.value));
      if (province) setCountryValue(countryIdForProvince(province));
      sync();
    });
    districtSelect.addEventListener("change", sync);
    neighborhoodSelect.addEventListener("change", sync);

    document.addEventListener("submit", (event) => {
      if (event.target !== form) return;
      const type = typeSelect.value;
      let context = {
        regionType: type,
        countryId: countrySelect.value === "__new__" ? null : countrySelect.value,
        countryName: null,
        parentId: null,
        parentName: null,
        parentType: REGION_TYPES[type]?.parentType || null
      };

      const countries = countryList();
      const selectedCountry = countries.find((country) => String(country.id) === String(context.countryId));
      context.countryName = selectedCountry?.name || (countryName?.value || rootCountryName?.value || null);

      if (type === "province") {
        context.parentId = context.countryId;
        context.parentName = context.countryName;
      } else if (type === "district") {
        const province = provinceList().find((item) => String(item.id) === String(provinceSelect.value));
        if (!province) return;
        context.parentId = province.id;
        context.parentName = province.name;
        context.countryId = countryIdForProvince(province);
        context.countryName = province._countryName || selectedCountry?.name || context.countryName;
        setCountryValue(context.countryId);
      } else if (type === "neighborhood") {
        const district = customList("district").find((item) => String(item.id) === String(districtSelect.value));
        if (!district) return;
        const provinceId = district.hierarchy?.parentId;
        const province = provinceList().find((item) => String(item.id) === String(provinceId));
        context.parentId = district.id;
        context.parentName = district.name;
        context.countryId = province ? countryIdForProvince(province) : context.countryId;
        context.countryName = province?._countryName || context.countryName;
        setCountryValue(context.countryId);
      } else if (type === "cemetery") {
        const neighborhood = customList("neighborhood").find((item) => String(item.id) === String(neighborhoodSelect.value));
        if (!neighborhood) return;
        const district = customList("district").find((item) => String(item.id) === String(neighborhood.hierarchy?.parentId));
        const province = provinceList().find((item) => String(item.id) === String(district?.hierarchy?.parentId));
        context.parentId = neighborhood.id;
        context.parentName = neighborhood.name;
        context.countryId = province ? countryIdForProvince(province) : context.countryId;
        context.countryName = province?._countryName || context.countryName;
        setCountryValue(context.countryId);
      }

      if (!["country", "independent"].includes(type) && !context.parentId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const message = form.querySelector(".import-hierarchy-error") || document.createElement("p");
        message.className = "form-error import-hierarchy-error";
        message.textContent = `Lütfen ${REGION_TYPES[type].label.toLocaleLowerCase("tr-TR")} için bağlı ${REGION_TYPES[type].parentType} seçin.`;
        form.appendChild(message);
        return;
      }

      window.__regionImportContext = context;
    }, true);

    sync();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

installImportDialogEnhancer();

export function getRegionTypeOptions() {
  return REGION_TYPE_OPTIONS.map(([value, label]) => ({ value, label }));
}

export function importRegionData(input, fileName = "", regionType = null) {
  if (isRegionConsoleExport(input)) {
    return {
      mode: "region-console",
      regions: {
        countries: Array.isArray(input.regions.countries) ? input.regions.countries : [],
        custom: Array.isArray(input.regions.custom) ? input.regions.custom : [],
        selectedId: null
      },
      campaigns: Array.isArray(input.campaigns) ? input.campaigns : [],
      importedCount: Array.isArray(input.regions.custom) ? input.regions.custom.length : 0,
      skippedCount: 0
    };
  }

  const selectedType = normalizeRegionType(regionType) || askRegionType();
  const features = featureList(input);
  if (!features.length) throw new Error("Dosyada FeatureCollection, Feature, Polygon veya MultiPolygon bulunamadı.");

  if (selectedType === "country" && features.length > 1) {
    throw new Error(`Bu dosyada ${features.length} ayrı geometri var. Her geometri Türkiye'nin bir ili ise bölge tipini “İl” seçin. “Ülke” yalnızca ülke geometrisinin içe aktarılması içindir.`);
  }

  const context = typeof window !== "undefined" ? window.__regionImportContext : null;
  if (typeof window !== "undefined") delete window.__regionImportContext;

  const imported = [];
  let skippedCount = 0;

  features.forEach((feature, index) => {
    const geometry = normalizeGeometry(feature?.geometry || feature);
    if (!geometry) {
      skippedCount += 1;
      return;
    }

    const properties = feature?.properties && typeof feature.properties === "object" ? feature.properties : {};
    const sourceId = stableSourceId(feature, index);
    const name = String(
      properties.name ?? properties.NAME ?? properties.title ?? properties.label ?? `İçe Aktarılan Alan ${index + 1}`
    ).trim() || `İçe Aktarılan Alan ${index + 1}`;

    const hierarchy = hierarchyMeta(selectedType, properties);
    if (context?.regionType === selectedType) {
      hierarchy.countryId = context.countryId || hierarchy.countryId || null;
      hierarchy.countryName = context.countryName || hierarchy.countryName || null;
      hierarchy.parentId = context.parentId || hierarchy.parentId || null;
      hierarchy.parentName = context.parentName || hierarchy.parentName || null;
      hierarchy.parentType = context.parentType || hierarchy.parentType;
    }

    const now = new Date().toISOString();
    imported.push({
      id: `import-${sourceId}-${crypto.randomUUID()}`,
      type: selectedType,
      name,
      status: "service",
      geometry,
      bounds: buildBounds(geometry),
      createdAt: now,
      updatedAt: now,
      hierarchy,
      importMeta: {
        format: "GeoJSON",
        coordinateOrder: "lonlat",
        sourceId,
        sourceFile: fileName || null,
        properties
      }
    });
  });

  if (!imported.length) throw new Error("Geçerli Polygon veya MultiPolygon bulunamadı.");

  return {
    mode: "geojson",
    regionType: selectedType,
    regionTypeLabel: REGION_TYPES[selectedType].label,
    regions: { countries: [], custom: imported, selectedId: null },
    campaigns: [],
    importedCount: imported.length,
    skippedCount
  };
}
