import { store } from "../../state/store.js";
import { getElements, toast } from "../../components/shell.js";
import { renderRegions } from "../regions/regions.js";
import { renderRegionsOnMap, fitToCoordinates } from "../map/map.js";
import { upsertState } from "../../services/cloud.js";

const elements = getElements();

function selected(select) {
  if (!select || !select.value || select.value === "__manual__") return null;
  const option = select.selectedOptions?.[0];
  if (!option) return null;
  return { id: String(select.value), name: option.textContent.trim() };
}

function manualValue(form, id) {
  return form.querySelector(`#${id}`)?.value.trim() || "";
}

function idFor(type, name) {
  return `manual-catalog-${type}-${name.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID()}`;
}

function manualItem(type, name, extra = {}) {
  return { id: idFor(type, name), name, type, catalogOnly: true, geometryStatus: "missing", ...extra };
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

async function persist(state) {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  await upsertState(session.access_token, {
    ...state.regions,
    campaigns: state.campaigns,
    history: state.history.entries,
    importedFiles: state.importedFiles,
    mapSettings: state.mapSettings
  });
}

async function handleSubmit(event) {
  const form = event.target?.closest?.("#drawRegionForm");
  if (!form) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const drawing = window.__regionConsoleDrawing;
  const mapState = window.__regionConsoleMapState;
  if (!drawing || !mapState) return;

  const type = form.querySelector("#drawRegionType")?.value || "independent";
  const name = form.querySelector("#drawRegionName")?.value.trim() || "";
  const countrySelect = form.querySelector("#drawCountry");
  const provinceSelect = form.querySelector("#drawProvince");
  const districtSelect = form.querySelector("#drawDistrict");
  const neighborhoodSelect = form.querySelector("#drawNeighborhood");

  if (!name) return form.querySelector("#drawRegionName")?.focus();

  const countryManual = countrySelect?.value === "__manual__";
  const provinceManual = provinceSelect?.value === "__manual__";
  const districtManual = districtSelect?.value === "__manual__";
  const neighborhoodManual = neighborhoodSelect?.value === "__manual__";

  if (!["country", "independent"].includes(type) && !countrySelect?.value) return countrySelect?.focus();
  if (type === "district" && !provinceSelect?.value) return provinceSelect?.focus();
  if (["neighborhood", "cemetery"].includes(type) && !districtSelect?.value) return districtSelect?.focus();
  if (type === "cemetery" && !neighborhoodSelect?.value) return neighborhoodSelect?.focus();

  const countryName = countryManual ? manualValue(form, "drawNewCountry") : "";
  const provinceName = provinceManual ? manualValue(form, "drawNewProvince") : "";
  const districtName = districtManual ? manualValue(form, "drawNewDistrict") : "";
  const neighborhoodName = neighborhoodManual ? manualValue(form, "drawNewNeighborhood") : "";
  if (countryManual && !countryName) return form.querySelector("#drawNewCountry")?.focus();
  if (provinceManual && !provinceName) return form.querySelector("#drawNewProvince")?.focus();
  if (districtManual && !districtName) return form.querySelector("#drawNewDistrict")?.focus();
  if (neighborhoodManual && !neighborhoodName) return form.querySelector("#drawNewNeighborhood")?.focus();

  let country = countryManual ? manualItem("country", countryName) : selected(countrySelect);
  let province = provinceManual ? manualItem("province", provinceName, { _countryId: country?.id || null, _countryName: country?.name || null }) : selected(provinceSelect);
  let district = districtManual ? manualItem("district", districtName, { _countryId: country?.id || null, _countryName: country?.name || null, _provinceId: province?.id || null, _provinceName: province?.name || null }) : selected(districtSelect);
  let neighborhood = neighborhoodManual ? manualItem("neighborhood", neighborhoodName, { _countryId: country?.id || null, _countryName: country?.name || null, _provinceId: province?.id || null, _provinceName: province?.name || null, _districtId: district?.id || null, _districtName: district?.name || null }) : selected(neighborhoodSelect);

  const newCatalog = [];
  if (countryManual) newCatalog.push(country);
  if (provinceManual) newCatalog.push(province);
  if (districtManual) newCatalog.push(district);
  if (neighborhoodManual) newCatalog.push(neighborhood);

  if (type === "province" && !country) return countrySelect?.focus();
  if (type === "district" && !province) return provinceSelect?.focus();
  if (["neighborhood", "cemetery"].includes(type) && !district) return districtSelect?.focus();
  if (type === "cemetery" && !neighborhood) return neighborhoodSelect?.focus();

  const drawingDraft = drawing.consumeDraft();
  if (!drawingDraft) {
    toast(elements, "Kaydedilecek çizim yok.");
    return;
  }

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
    ...drawingDraft,
    type: "custom",
    name,
    status: form.querySelector("#drawStatus")?.value || "service",
    closedReason: form.querySelector("#drawClosedReason")?.value.trim() || null,
    hierarchy,
    importMeta: { ...(drawingDraft.importMeta || {}), source: "drawing" }
  };

  const before = store.dataSnapshot();
  const current = store.get();
  const catalogOverrides = [...(current.regions?.catalogOverrides || []), ...newCatalog];
  const custom = [...(current.regions?.custom || []), result];
  store.replaceData({ regions: { ...current.regions, custom, catalogOverrides, selectedId: result.id } }, { recordHistory: false });
  store.recordHistory("Alan çizildi ve kaydedildi", before, store.dataSnapshot());
  drawing.cancel();
  elements.editBar.hidden = true;
  renderAfterSave(mapState);
  try {
    await persist(store.get());
    toast(elements, "Alan başarıyla kaydedildi.");
  } catch (error) {
    console.error("[Region Console] Drawing save failed:", error);
    toast(elements, `Yerel kayıt yapıldı ancak bulut kaydı başarısız: ${error.message}`);
  }
  if (elements.appDialog?.open) elements.appDialog.close();
}

document.addEventListener("submit", handleSubmit, true);
