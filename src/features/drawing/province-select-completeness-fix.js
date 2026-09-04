import { ensureAdministrativeCatalog, getAdministrativeCatalogData } from "../regions/region-catalog.js";

const MANUAL_VALUE = "__manual__";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

async function refreshProvinces(select, countrySelect) {
  if (!select || !countrySelect || countrySelect.value === MANUAL_VALUE || !countrySelect.value) return;

  const countryName = countrySelect.selectedOptions?.[0]?.textContent || "";
  if (normalize(countryName) !== "turkey") return;

  try {
    await ensureAdministrativeCatalog({ includeNeighborhoods: false });
    const catalog = getAdministrativeCatalogData();
    const provinces = Array.isArray(catalog?.provinces) ? catalog.provinces : [];
    if (!provinces.length) return;

    const currentValue = select.value;
    select.innerHTML = `<option value="">İl seçin</option>`
      + provinces
        .filter((item) => item?.id != null && item?.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"))
        .map((item) => `<option value="catalog-province-${esc(item.id)}">${esc(item.name)}</option>`)
        .join("")
      + `<option value="${MANUAL_VALUE}">＋ Yeni il ekle</option>`;

    if ([...select.options].some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
  } catch (error) {
    console.warn("[Region Console] Province catalog refresh unavailable:", error);
  }
}

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target?.id !== "drawCountry") return;
  const provinceSelect = document.getElementById("drawProvince");
  refreshProvinces(provinceSelect, target);
}, true);

document.addEventListener("change", (event) => {
  if (event.target?.id !== "drawCountry") return;
  setTimeout(() => refreshProvinces(document.getElementById("drawProvince"), event.target), 0);
}, true);
