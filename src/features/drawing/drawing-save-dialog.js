import { store } from "../../state/store.js";
import { getElements, openDialog, toast } from "../../components/shell.js";
import { getRegionTypeOptions } from "../regions/importer.js";
import { renderRegions } from "../regions/regions.js";
import { renderRegionsOnMap, fitToCoordinates } from "../map/map.js";
import { upsertState } from "../../services/cloud.js";

const elements = getElements();
const DRAW_SAVE_SELECTOR = "#saveButton";

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

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id ?? item?.importMeta?.sourceId ?? item?.name ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function childList(node, keys) {
  for (const key of keys) {
    if (Array.isArray(node?.[key])) return node[key];
  }
  return [];
}

function hierarchyOptions() {
  const countries = Array.isArray(store.get().regions?.countries) ? store.get().regions.countries : [];
  const custom = Array.isArray(store.get().regions?.custom) ? store.get().regions.custom : [];
  const provinces = [];
  const districts = [];
  const neighborhoods = [];

  countries.forEach((country) => {
    childList(country, ["provinces", "children"]).forEach((province) => {
      provinces.push({ ...province, _countryId: country.id, _countryName: country.name });
      childList(province, ["districts", "children"]).forEach((district) => {
        districts.push({ ...district, _countryId: country.id, _countryName: country.name, _provinceId: province.id, _provinceName: province.name });
        childList(district, ["neighborhoods", "children"]).forEach((neighborhood) => {
          neighborhoods.push({ ...neighborhood, _countryId: country.id, _countryName: country.name, _provinceId: province.id, _provinceName: province.name, _districtId: district.id, _districtName: district.name });
        });
      });
    });
  });

  custom.filter((region) => (region?.hierarchy?.type || region?.type) === "province").forEach((region) => provinces.push({ ...region, _countryId: region?.hierarchy?.countryId, _countryName: region?.hierarchy?.countryName }));
  custom.filter((region) => (region?.hierarchy?.type || region?.type) === "district").forEach((region) => districts.push({ ...region, _countryId: region?.hierarchy?.countryId, _countryName: region?.hierarchy?.countryName, _provinceId: region?.hierarchy?.parentId, _provinceName: region?.hierarchy?.parentName }));
  custom.filter((region) => (region?.hierarchy?.type || region?.type) === "neighborhood").forEach((region) => neighborhoods.push({ ...region, _countryId: region?.hierarchy?.countryId, _countryName: region?.hierarchy?.countryName, _provinceId: region?.hierarchy?.provinceId, _provinceName: region?.hierarchy?.provinceName, _districtId: region?.hierarchy?.parentId, _districtName: region?.hierarchy?.parentName }));

  return { countries, provinces: uniqueById(provinces), districts: uniqueById(districts), neighborhoods: uniqueById(neighborhoods) };
}

function optionMarkup(items, placeholder, includeNew = false) {
  const head = `<option value="">${escapeHtml(placeholder)}</option>`;
  const extra = includeNew ? `<option value="__new__">+ Yeni ülke ekle</option>` : "";
  return head + extra + items.map((item) => `<option value="${escapeHtml(item.id ?? item.name)}">${escapeHtml(item.name || "İsimsiz")}</option>`).join("");
}

function findById(items, value) {
  return items.find((item) => String(item.id ?? item.name) === String(value)) || null;
}

function syncForm(form, data) {
  const type = form.querySelector("#drawRegionType").value;
  const countryWrap = form.querySelector("#drawCountryWrap");
  const provinceWrap = form.querySelector("#drawProvinceWrap");
  const districtWrap = form.querySelector("#drawDistrictWrap");
  const neighborhoodWrap = form.querySelector("#drawNeighborhoodWrap");
  const countrySelect = form.querySelector("#drawCountry");
  const provinceSelect = form.querySelector("#drawProvince");
  const districtSelect = form.querySelector("#drawDistrict");
  const neighborhoodSelect = form.querySelector("#drawNeighborhood");
  const newCountryWrap = form.querySelector("#drawNewCountryWrap");
  const newCountry = form.querySelector("#drawNewCountry");

  const needsCountry = !["country", "independent"].includes(type);
  const needsProvince = ["district", "neighborhood", "cemetery"].includes(type);
  const needsDistrict = ["neighborhood", "cemetery"].includes(type);
  const needsNeighborhood = type === "cemetery";

  countryWrap.hidden = !needsCountry;
  provinceWrap.hidden = !needsProvince;
  districtWrap.hidden = !needsDistrict;
  neighborhoodWrap.hidden = !needsNeighborhood;

  const countryId = countrySelect.value;
  const provinceId = provinceSelect.value;
  const districtId = districtSelect.value;

  const provinces = data.provinces.filter((item) => !countryId || countryId === "__new__" || String(item._countryId ?? item.hierarchy?.countryId ?? "") === String(countryId));
  const districts = data.districts.filter((item) => !provinceId || String(item._provinceId ?? item.hierarchy?.parentId ?? "") === String(provinceId));
  const neighborhoods = data.neighborhoods.filter((item) => !districtId || String(item._districtId ?? item.hierarchy?.parentId ?? "") === String(districtId));

  const currentProvince = provinceId;
  const currentDistrict = districtId;
  const currentNeighborhood = neighborhoodSelect.value;
  provinceSelect.innerHTML = optionMarkup(provinces, "İl seçin");
  districtSelect.innerHTML = optionMarkup(districts, "İlçe seçin");
  neighborhoodSelect.innerHTML = optionMarkup(neighborhoods, "Mahalle seçin");
  if (provinces.some((item) => String(item.id ?? item.name) === String(currentProvince))) provinceSelect.value = currentProvince;
  if (districts.some((item) => String(item.id ?? item.name) === String(currentDistrict))) districtSelect.value = currentDistrict;
  if (neighborhoods.some((item) => String(item.id ?? item.name) === String(currentNeighborhood))) neighborhoodSelect.value = currentNeighborhood;

  const isNewCountry = countrySelect.value === "__new__";
  newCountryWrap.hidden = !isNewCountry;
  newCountry.required = isNewCountry;
  countrySelect.required = needsCountry;
  provinceSelect.required = needsProvince;
  districtSelect.required = needsDistrict;
  neighborhoodSelect.required = needsNeighborhood;
}

function buildDialog(draft) {
  const data = hierarchyOptions();
  const typeOptions = getRegionTypeOptions().map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  openDialog(elements, "Yeni alan bilgileri", `<form id="drawRegionForm" class="dialog-form draw-region-form">
    <p class="dialog-muted">Çizilen alanı kaydetmeden önce içe aktarma ile aynı hiyerarşi bilgilerini tanımlayın.</p>
    <label>Alan adı<input id="drawRegionName" name="name" required placeholder="Örn. İstanbul Operasyon Alanı"></label>
    <label>Bölge tipi<select id="drawRegionType" name="regionType" required>${typeOptions}</select></label>
    <div id="drawCountryWrap" hidden><label>Ülke<select id="drawCountry" name="countryId">${optionMarkup(data.countries, "Ülke seçin", true)}</select></label><label id="drawNewCountryWrap" hidden>Yeni ülke adı<input id="drawNewCountry" name="countryName" placeholder="Örn. Türkiye"></label></div>
    <div id="drawProvinceWrap" hidden><label>İl<select id="drawProvince" name="provinceId"><option value="">İl seçin</option></select></label></div>
    <div id="drawDistrictWrap" hidden><label>İlçe<select id="drawDistrict" name="districtId"><option value="">İlçe seçin</option></select></label></div>
    <div id="drawNeighborhoodWrap" hidden><label>Mahalle<select id="drawNeighborhood" name="neighborhoodId"><option value="">Mahalle seçin</option></select></label></div>
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

  typeSelect.value = "independent";
  const refresh = () => syncForm(form, data);
  typeSelect.addEventListener("change", refresh);
  countrySelect.addEventListener("change", refresh);
  provinceSelect.addEventListener("change", refresh);
  districtSelect.addEventListener("change", refresh);
  statusSelect.addEventListener("change", () => { reasonWrap.hidden = statusSelect.value !== "closed"; });
  refresh();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (elements.appDialog.open) elements.appDialog.close();
      resolve(value);
    };

    form.querySelector("#cancelDrawSave").addEventListener("click", () => finish(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const type = typeSelect.value;
      const name = form.querySelector("#drawRegionName").value.trim();
      if (!name) return form.querySelector("#drawRegionName").focus();
      if (!["country", "independent"].includes(type) && !countrySelect.value) return countrySelect.focus();
      if (type === "district" && !provinceSelect.value) return provinceSelect.focus();
      if (["neighborhood", "cemetery"].includes(type) && !districtSelect.value) return districtSelect.focus();
      if (type === "cemetery" && !neighborhoodSelect.value) return neighborhoodSelect.focus();
      if (countrySelect.value === "__new__" && !form.querySelector("#drawNewCountry").value.trim()) return form.querySelector("#drawNewCountry").focus();

      const country = countrySelect.value === "__new__"
        ? { id: `country-${crypto.randomUUID()}`, name: form.querySelector("#drawNewCountry").value.trim() }
        : findById(data.countries, countrySelect.value);
      const province = findById(data.provinces, provinceSelect.value);
      const district = findById(data.districts, districtSelect.value);
      const neighborhood = findById(data.neighborhoods, neighborhoodSelect.value);
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
        rootType: type === "country" ? "country" : "country"
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
      finish({ region: result, newCountry: countrySelect.value === "__new__" ? country : null });
    });
    elements.appDialog.addEventListener("cancel", () => finish(null), { once: true });
  });
}

async function persistAfterDraw() {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  try {
    await upsertState(session.access_token, {
      ...store.dataSnapshot().regions,
      campaigns: store.get().campaigns,
      history: store.get().history.entries,
      importedFiles: store.get().importedFiles,
      mapSettings: store.get().mapSettings
    });
  } catch (error) {
    console.error("[Region Console] Drawing cloud save failed:", error);
    toast(elements, `Bulut kaydı başarısız: ${error.message}`);
  }
}

function renderAfterDrawSave(mapState) {
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
  const saveButton = event.target?.closest?.(DRAW_SAVE_SELECTOR);
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
  const countries = Array.isArray(current.regions.countries) ? current.regions.countries.slice() : [];
  if (result.newCountry) countries.push({ ...result.newCountry, count: 0, provinces: [], children: [] });
  const custom = [...(current.regions.custom || []), result.region];
  store.replaceData({ regions: { ...current.regions, countries, custom, selectedId: result.region.id } }, { recordHistory: false });
  store.recordHistory("Alan çizildi ve kaydedildi", before, store.dataSnapshot());
  drawing.cancel();
  elements.editBar.hidden = true;
  renderAfterDrawSave(mapState);
  await persistAfterDraw();
  toast(elements, `${result.region.name} alanı kaydedildi.`);
}, true);
