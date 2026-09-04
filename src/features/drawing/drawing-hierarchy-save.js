import { store } from "../../state/store.js";
import { getElements, openDialog, toast } from "../../components/shell.js";
import { getRegionTypeOptions } from "../regions/importer.js";
import { renderRegions } from "../regions/regions.js";
import { renderRegionsOnMap, fitToCoordinates } from "../map/map.js";
import { upsertState } from "../../services/cloud.js";
import { ensureAdministrativeCatalog, getAdministrativeCatalogData } from "../regions/region-catalog.js";

const elements = getElements();
const API_BASE = "https://api.turkiyeapi.dev/v2";
const MANUAL_PREFIX = "manual-catalog-";

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

function idFor(type, name) {
  return `${MANUAL_PREFIX}${type}-${normalizeName(name).replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID()}`;
}

function childList(node, keys) {
  for (const key of keys) if (Array.isArray(node?.[key])) return node[key];
  return [];
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(String(item.id))) return false;
    seen.add(String(item.id));
    return true;
  });
}

function collectStateHierarchy() {
  const state = store.get();
  const countries = Array.isArray(state.regions?.countries) ? state.regions.countries : [];
  const custom = Array.isArray(state.regions?.custom) ? state.regions.custom : [];
  const provinces = [];
  const districts = [];
  const neighborhoods = [];

  for (const country of countries) {
    for (const province of childList(country, ["provinces", "children"])) {
      provinces.push({ ...province, _countryId: country.id, _countryName: country.name });
      for (const district of childList(province, ["districts", "children"])) {
        districts.push({ ...district, _countryId: country.id, _countryName: country.name, _provinceId: province.id, _provinceName: province.name });
        for (const neighborhood of childList(district, ["neighborhoods", "children"])) {
          neighborhoods.push({
            ...neighborhood,
            _countryId: country.id,
            _countryName: country.name,
            _provinceId: province.id,
            _provinceName: province.name,
            _districtId: district.id,
            _districtName: district.name
          });
        }
      }
    }
  }

  for (const region of custom) {
    const type = String(region?.hierarchy?.type || region?.type || "").toLowerCase();
    if (type === "province") provinces.push({ ...region, _countryId: region.hierarchy?.countryId, _countryName: region.hierarchy?.countryName });
    if (type === "district") districts.push({ ...region, _countryId: region.hierarchy?.countryId, _countryName: region.hierarchy?.countryName, _provinceId: region.hierarchy?.provinceId || region.hierarchy?.parentId, _provinceName: region.hierarchy?.provinceName || region.hierarchy?.parentName });
    if (type === "neighborhood") neighborhoods.push({ ...region, _countryId: region.hierarchy?.countryId, _countryName: region.hierarchy?.countryName, _provinceId: region.hierarchy?.provinceId, _provinceName: region.hierarchy?.provinceName, _districtId: region.hierarchy?.districtId || region.hierarchy?.parentId, _districtName: region.hierarchy?.districtName || region.hierarchy?.parentName });
  }

  const overrides = Array.isArray(state.regions?.catalogOverrides) ? state.regions.catalogOverrides : [];
  for (const item of overrides) {
    const type = String(item?.type || "").toLowerCase();
    if (type === "country") countries.push(item);
    if (type === "province") provinces.push(item);
    if (type === "district") districts.push(item);
    if (type === "neighborhood") neighborhoods.push(item);
  }

  return {
    countries: unique(countries),
    provinces: unique(provinces),
    districts: unique(districts),
    neighborhoods: unique(neighborhoods)
  };
}

function catalogHierarchy(catalog = {}) {
  const stateData = collectStateHierarchy();
  const countries = stateData.countries;
  const provinces = [...stateData.provinces];
  const districts = [...stateData.districts];
  const neighborhoods = [...stateData.neighborhoods];
  const turkey = countries.find((item) => normalizeName(item?.name) === "turkey") || null;
  const turkeyId = turkey?.id || "catalog-country-turkey";

  const catalogProvinces = Array.isArray(catalog.provinces) ? catalog.provinces : [];
  const catalogDistricts = Array.isArray(catalog.districts) ? catalog.districts : [];
  const provinceByCatalogId = new Map(catalogProvinces.map((item) => [String(item?.id), item]));
  const stateProvinceByName = new Map(provinces.map((item) => [normalizeName(item?.name), item]));

  for (const item of catalogProvinces) {
    if (!item?.id || !item?.name) continue;
    const existing = stateProvinceByName.get(normalizeName(item.name));
    provinces.push({
      ...item,
      id: existing?.id || `catalog-province-${item.id}`,
      _countryId: existing?._countryId || turkeyId,
      _countryName: existing?._countryName || turkey?.name || "Turkey",
      catalogOnly: true,
      geometryStatus: "missing"
    });
  }

  const allProvinces = unique(provinces);
  const provinceByName = new Map(allProvinces.map((item) => [normalizeName(item?.name), item]));
  for (const item of catalogDistricts) {
    if (!item?.id || !item?.name) continue;
    const province = provinceByCatalogId.get(String(item.provinceId));
    const stateProvince = province ? provinceByName.get(normalizeName(province.name)) : null;
    districts.push({
      ...item,
      id: `catalog-district-${item.id}`,
      _countryId: stateProvince?._countryId || turkeyId,
      _countryName: stateProvince?._countryName || turkey?.name || "Turkey",
      _provinceId: stateProvince?.id || `catalog-province-${item.provinceId}`,
      _provinceName: province?.name || null,
      catalogOnly: true,
      geometryStatus: "missing"
    });
  }

  return { countries, provinces: unique(provinces), districts: unique(districts), neighborhoods: unique(neighborhoods) };
}

function optionMarkup(items, placeholder, newLabel) {
  return `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "İsimsiz")}</option>`).join("")}<option value="__manual__">＋ ${escapeHtml(newLabel)}</option>`;
}

function findById(items, value) {
  return items.find((item) => String(item?.id) === String(value)) || null;
}

async function loadDistricts(provinceId, current = []) {
  const stateMatch = current.filter((item) => String(item._provinceId ?? item.hierarchy?.parentId ?? "") === String(provinceId));
  const catalogProvinceId = String(provinceId || "").replace(/^catalog-province-/, "");
  if (!/^\d+$/.test(catalogProvinceId)) return stateMatch;
  try {
    const response = await fetch(`${API_BASE}/provinces/${catalogProvinceId}/districts?fields=id,name,provinceId&limit=1000`, { headers: { Accept: "application/json" }, cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return unique([...stateMatch, ...rows.map((item) => ({ ...item, id: `catalog-district-${item.id}`, _provinceId: provinceId, _provinceName: current.find((p) => String(p.id) === String(provinceId))?.name || null, catalogOnly: true, geometryStatus: "missing" }))]);
  } catch (error) {
    console.warn("[Region Console] District catalog unavailable:", error);
    return stateMatch;
  }
}

async function loadNeighborhoods(districtId, current = []) {
  const stateMatch = current.filter((item) => String(item._districtId ?? item.hierarchy?.parentId ?? "") === String(districtId));
  const catalogDistrictId = String(districtId || "").replace(/^catalog-district-/, "");
  if (!/^\d+$/.test(catalogDistrictId)) return stateMatch;
  try {
    const response = await fetch(`${API_BASE}/districts/${catalogDistrictId}/neighborhoods?fields=id,name,districtId,provinceId&limit=1000`, { headers: { Accept: "application/json" }, cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return unique([...stateMatch, ...rows.map((item) => ({ ...item, id: `catalog-neighborhood-${item.id}`, _districtId: districtId, _provinceId: `catalog-province-${item.provinceId}`, catalogOnly: true, geometryStatus: "missing" }))]);
  } catch (error) {
    console.warn("[Region Console] Neighborhood catalog unavailable:", error);
    return stateMatch;
  }
}

function manualRow(id, label, placeholder) {
  return `<div class="draw-manual-row" id="${id}Wrap" hidden><input id="${id}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"><button type="button" class="button" data-manual-cancel="${id}">Seçimden vazgeç</button><small>${escapeHtml(label)} sisteme isim olarak kaydedilir; sınır daha sonra çizilebilir.</small></div>`;
}

function setOptions(select, items, placeholder, newLabel, currentValue = "") {
  select.innerHTML = optionMarkup(items, placeholder, newLabel);
  if (items.some((item) => String(item.id) === String(currentValue))) select.value = currentValue;
}

async function buildDialog(draft) {
  let catalog = {};
  try {
    await ensureAdministrativeCatalog({ includeNeighborhoods: false });
    catalog = getAdministrativeCatalogData();
  } catch (error) {
    console.warn("[Region Console] Administrative catalog unavailable:", error);
  }

  const data = catalogHierarchy(catalog);
  const typeOptions = getRegionTypeOptions().map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  openDialog(elements, "Yeni alan bilgileri", `<form id="drawRegionForm" class="dialog-form draw-region-form">
    <p class="dialog-muted">Eksik bir idari kayıt varsa listeden “Yeni …” seçerek ismini elle ekleyebilirsiniz. Bu kayıt sınır olmadan katalogda tutulur.</p>
    <label>Alan adı<input id="drawRegionName" name="name" required placeholder="Örn. İstanbul Merkez Mezarlığı"></label>
    <label>Bölge tipi<select id="drawRegionType" name="regionType" required>${typeOptions}</select></label>
    <div id="drawCountryWrap" hidden><label>Ülke<select id="drawCountry" name="countryId">${optionMarkup(data.countries, "Ülke seçin", "Yeni ülke ekle")}</select></label>${manualRow("drawNewCountry", "Yeni ülke", "Örn. Almanya")}</div>
    <div id="drawProvinceWrap" hidden><label>İl<select id="drawProvince" name="provinceId"><option value="">İl seçin</option></select></label>${manualRow("drawNewProvince", "Yeni il", "Örn. Berlin")}</div>
    <div id="drawDistrictWrap" hidden><label>İlçe<select id="drawDistrict" name="districtId"><option value="">İlçe seçin</option></select></label>${manualRow("drawNewDistrict", "Yeni ilçe", "Örn. Mitte")}</div>
    <div id="drawNeighborhoodWrap" hidden><label>Mahalle<select id="drawNeighborhood" name="neighborhoodId"><option value="">Mahalle seçin</option></select></label>${manualRow("drawNewNeighborhood", "Yeni mahalle", "Örn. Mahalle adı")}</div>
    <label>Durum<select id="drawStatus" name="status"><option value="service">Hizmet Verilen</option><option value="outside">Hizmet Dışı</option><option value="closed">Hizmete Kapalı</option></select></label>
    <label id="drawClosedReasonWrap" hidden>Hizmete kapalı nedeni<input id="drawClosedReason" name="closedReason" placeholder="Örn. geçici operasyon durumu"></label>
    <div class="dialog-actions"><button type="button" class="button" id="cancelDrawSave">İptal</button><button type="submit" class="button button-primary">Alanı kaydet</button></div>
  </form>`);

  const form = elements.dialogBody.querySelector("#drawRegionForm");
  const typeSelect = form.querySelector("#drawRegionType");
  const countrySelect = form.querySelector("#drawCountry");
  const provinceSelect = form.querySelector("#drawProvince");
  const districtSelect = form.querySelector("#drawDistrict");
  const neighborhoodSelect = form.querySelector("#drawNeighborhood");
  const statusSelect = form.querySelector("#drawStatus");
  const reasonWrap = form.querySelector("#drawClosedReasonWrap");
  const manual = {
    country: form.querySelector("#drawNewCountry"),
    province: form.querySelector("#drawNewProvince"),
    district: form.querySelector("#drawNewDistrict"),
    neighborhood: form.querySelector("#drawNewNeighborhood")
  };
  const manualWrap = (key) => form.querySelector(`#drawNew${key[0].toUpperCase()}${key.slice(1)}Wrap`);

  const showManual = (key, visible) => {
    const wrap = manualWrap(key);
    if (wrap) wrap.hidden = !visible;
    if (!visible && manual[key]) manual[key].value = "";
  };

  typeSelect.value = "independent";
  let districts = data.districts;
  let neighborhoods = data.neighborhoods;

  const refresh = async () => {
    const type = typeSelect.value;
    const needsCountry = !["country", "independent"].includes(type);
    const needsProvince = ["district", "neighborhood", "cemetery"].includes(type);
    const needsDistrict = ["neighborhood", "cemetery"].includes(type);
    const needsNeighborhood = type === "cemetery";
    form.querySelector("#drawCountryWrap").hidden = !needsCountry;
    form.querySelector("#drawProvinceWrap").hidden = !needsProvince;
    form.querySelector("#drawDistrictWrap").hidden = !needsDistrict;
    form.querySelector("#drawNeighborhoodWrap").hidden = !needsNeighborhood;

    if (needsProvince && countrySelect.value !== "__manual__") {
      const provinces = data.provinces.filter((item) => String(item._countryId ?? item.hierarchy?.countryId ?? "") === String(countrySelect.value));
      setOptions(provinceSelect, provinces, "İl seçin", "Yeni il ekle", provinceSelect.value);
    } else if (!needsProvince) {
      provinceSelect.innerHTML = "<option value=\"\">İl seçin</option>";
    }

    if (needsDistrict && provinceSelect.value !== "__manual__") {
      districts = await loadDistricts(provinceSelect.value, data.districts);
      setOptions(districtSelect, districts.filter((item) => String(item._provinceId ?? item.hierarchy?.parentId ?? "") === String(provinceSelect.value)), "İlçe seçin", "Yeni ilçe ekle", districtSelect.value);
    } else if (!needsDistrict) {
      districtSelect.innerHTML = "<option value=\"\">İlçe seçin</option>";
    }

    if (needsNeighborhood && districtSelect.value !== "__manual__") {
      neighborhoods = await loadNeighborhoods(districtSelect.value, data.neighborhoods);
      setOptions(neighborhoodSelect, neighborhoods.filter((item) => String(item._districtId ?? item.hierarchy?.parentId ?? "") === String(districtSelect.value)), "Mahalle seçin", "Yeni mahalle ekle", neighborhoodSelect.value);
    } else if (!needsNeighborhood) {
      neighborhoodSelect.innerHTML = "<option value=\"\">Mahalle seçin</option>";
    }

    countrySelect.required = needsCountry;
    provinceSelect.required = needsProvince;
    districtSelect.required = needsDistrict;
    neighborhoodSelect.required = needsNeighborhood;
    showManual("country", countrySelect.value === "__manual__");
    showManual("province", provinceSelect.value === "__manual__");
    showManual("district", districtSelect.value === "__manual__");
    showManual("neighborhood", neighborhoodSelect.value === "__manual__");
  };

  typeSelect.addEventListener("change", refresh);
  countrySelect.addEventListener("change", refresh);
  provinceSelect.addEventListener("change", refresh);
  districtSelect.addEventListener("change", refresh);
  statusSelect.addEventListener("change", () => { reasonWrap.hidden = statusSelect.value !== "closed"; });
  for (const [key, input] of Object.entries(manual)) {
    input?.addEventListener("input", () => showManual(key, true));
  }
  for (const button of form.querySelectorAll("[data-manual-cancel]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.manualCancel.replace(/^drawNew/, "").toLowerCase();
      showManual(key, false);
      const select = form.querySelector(`#draw${key[0].toUpperCase()}${key.slice(1)}`);
      if (select) select.value = "";
      refresh();
    });
  }
  await refresh();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (elements.appDialog.open) elements.appDialog.close();
      resolve(value);
    };

    form.querySelector("#cancelDrawSave").addEventListener("click", () => finish(null));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const type = typeSelect.value;
      const name = form.querySelector("#drawRegionName").value.trim();
      if (!name) return form.querySelector("#drawRegionName").focus();

      const newCatalog = [];
      const countryManual = countrySelect.value === "__manual__";
      const provinceManual = provinceSelect.value === "__manual__";
      const districtManual = districtSelect.value === "__manual__";
      const neighborhoodManual = neighborhoodSelect.value === "__manual__";
      const countryName = countryManual ? manual.country.value.trim() : "";
      if (!["country", "independent"].includes(type) && !countrySelect.value) return countrySelect.focus();
      if (countryManual && !countryName) return manual.country.focus();
      if (type === "district" && !provinceSelect.value) return provinceSelect.focus();
      if (["neighborhood", "cemetery"].includes(type) && !districtSelect.value) return districtSelect.focus();
      if (provinceManual && !manual.province.value.trim()) return manual.province.focus();
      if (districtManual && !manual.district.value.trim()) return manual.district.focus();
      if (neighborhoodManual && !manual.neighborhood.value.trim()) return manual.neighborhood.focus();

      let country = countryManual ? { id: idFor("country", countryName), name: countryName, type: "country", catalogOnly: true, geometryStatus: "missing", _countryId: null } : findById(data.countries, countrySelect.value);
      if (countryManual) newCatalog.push(country);

      let province = provinceManual ? { id: idFor("province", manual.province.value), name: manual.province.value.trim(), type: "province", catalogOnly: true, geometryStatus: "missing", _countryId: country?.id || null, _countryName: country?.name || null } : findById(data.provinces, provinceSelect.value);
      if (provinceManual) newCatalog.push(province);

      let district = districtManual ? { id: idFor("district", manual.district.value), name: manual.district.value.trim(), type: "district", catalogOnly: true, geometryStatus: "missing", _countryId: country?.id || null, _countryName: country?.name || null, _provinceId: province?.id || null, _provinceName: province?.name || null } : findById(districts, districtSelect.value);
      if (districtManual) newCatalog.push(district);

      let neighborhood = neighborhoodManual ? { id: idFor("neighborhood", manual.neighborhood.value), name: manual.neighborhood.value.trim(), type: "neighborhood", catalogOnly: true, geometryStatus: "missing", _countryId: country?.id || null, _countryName: country?.name || null, _provinceId: province?.id || null, _provinceName: province?.name || null, _districtId: district?.id || null, _districtName: district?.name || null } : findById(neighborhoods, neighborhoodSelect.value);
      if (neighborhoodManual) newCatalog.push(neighborhood);

      if (type === "province" && !country) return countrySelect.focus();
      if (type === "district" && !province) return provinceSelect.focus();
      if (["neighborhood", "cemetery"].includes(type) && !district) return districtSelect.focus();
      if (type === "cemetery" && !neighborhood) return neighborhoodSelect.focus();

      const parent = type === "province" ? country : type === "district" ? province : type === "neighborhood" ? district : type === "cemetery" ? neighborhood : null;
      const hierarchy = {
        type,
        parentId: parent?.id || null,
        parentName: parent?.name || null,
        countryId: country?.id || null,
        countryName: country?.name || null,
        provinceId: province?.id || null,
        provinceName: province?.name || null,
        districtId: district?.id || null,
        districtName: district?.name || null,
        neighborhoodId: neighborhood?.id || null,
        neighborhoodName: neighborhood?.name || null,
        rootType: "country"
      };
      const result = {
        ...draft,
        type: "custom",
        name,
        status: statusSelect.value,
        closedReason: statusSelect.value === "closed" ? form.querySelector("#drawClosedReason").value.trim() : null,
        hierarchy,
        importMeta: { ...(draft.importMeta || {}), source: "drawing" }
      };
      finish({ region: result, catalogOverrides: newCatalog });
    });
    elements.appDialog.addEventListener("cancel", () => finish(null), { once: true });
  });
}

async function persist(state) {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  try {
    await upsertState(session.access_token, {
      ...state.regions,
      campaigns: state.campaigns,
      history: state.history.entries,
      importedFiles: state.importedFiles,
      mapSettings: state.mapSettings
    });
  } catch (error) {
    console.error("[Region Console] Drawing hierarchy save failed:", error);
    toast(elements, `Bulut kaydı başarısız: ${error.message}`);
  }
}

function renderAfterSave(mapState) {
  const state = store.get();
  renderRegions(elements.regionTree, state.regions.countries, "", state.regions.custom || []);
  renderRegionsOnMap(mapState, state.regions.custom || []);
  const region = (state.regions.custom || []).at(-1);
  if (region?.geometry) {
    const coordinates = region.geometry.type === "Polygon" ? region.geometry.coordinates.flat() : region.geometry.coordinates.flat(2);
    if (coordinates.length) fitToCoordinates(mapState, coordinates, [45, 45]);
  }
}

document.addEventListener("click", async (event) => {
  const saveButton = event.target?.closest?.("#saveButton");
  if (!saveButton || saveButton.disabled) return;
  const drawing = window.__regionConsoleDrawing;
  const mapState = window.__regionConsoleMapState;
  if (!drawing || !mapState) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const draft = drawing.consumeDraft();
  if (!draft) {
    toast(elements, "Kaydedilecek çizim yok.");
    return;
  }

  const result = await buildDialog(draft);
  if (!result) return;

  const before = store.dataSnapshot();
  const current = store.get();
  const catalogOverrides = [...(current.regions?.catalogOverrides || []), ...(result.catalogOverrides || [])];
  const custom = [...(current.regions.custom || []), result.region];
  store.replaceData({ regions: { ...current.regions, custom, catalogOverrides, selectedId: result.region.id } }, { recordHistory: false });
  store.recordHistory("Alan çizildi ve kaydedildi", before, store.dataSnapshot());
  drawing.cancel();
  elements.editBar.hidden = true;
  renderAfterSave(mapState);
  await persist(store.get());
  toast(elements, `${result.region.name} alanı kaydedildi.`);
}, true);
