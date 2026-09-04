const API_BASE = "https://api.turkiyeapi.dev/v2";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optionMarkup(items, placeholder, manualLabel) {
  const rows = Array.isArray(items) ? items : [];
  return `<option value="">${esc(placeholder)}</option>${rows.map((item) => `<option value="${esc(item.value ?? item.id)}">${esc(item.name || "İsimsiz")}</option>`).join("")}<option value="__manual__">＋ ${esc(manualLabel)}</option>`;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function resolveProvinceApiId(select) {
  const value = String(select?.value || "");
  const numeric = value.match(/^catalog-province-(\d+)$/);
  if (numeric) return numeric[1];
  if (/^\d+$/.test(value)) return value;
  const name = select?.selectedOptions?.[0]?.textContent?.trim();
  if (!name) return null;
  try {
    const rows = await fetchJson(`${API_BASE}/provinces?search=${encodeURIComponent(name)}&fields=id,name&limit=20`);
    const normalized = name.toLocaleLowerCase("tr-TR");
    const exact = rows.find((row) => String(row?.name || "").trim().toLocaleLowerCase("tr-TR") === normalized);
    return String(exact?.id ?? rows[0]?.id ?? "") || null;
  } catch (error) {
    console.warn("[Region Console] Province catalog lookup failed:", error);
    return null;
  }
}

async function resolveDistrictApiId(select, provinceApiId) {
  const value = String(select?.value || "");
  const numeric = value.match(/^catalog-district-(\d+)$/);
  if (numeric) return numeric[1];
  if (/^\d+$/.test(value)) return value;
  const name = select?.selectedOptions?.[0]?.textContent?.trim();
  if (!name || !provinceApiId) return null;
  try {
    const rows = await fetchJson(`${API_BASE}/districts?provinceId=${encodeURIComponent(provinceApiId)}&search=${encodeURIComponent(name)}&fields=id,name,provinceId&limit=20`);
    const normalized = name.toLocaleLowerCase("tr-TR");
    const exact = rows.find((row) => String(row?.name || "").trim().toLocaleLowerCase("tr-TR") === normalized);
    return String(exact?.id ?? rows[0]?.id ?? "") || null;
  } catch (error) {
    console.warn("[Region Console] District catalog lookup failed:", error);
    return null;
  }
}

async function loadDistrictOptions(provinceSelect, districtSelect) {
  const provinceApiId = await resolveProvinceApiId(provinceSelect);
  districtSelect.innerHTML = optionMarkup([], "İlçe yükleniyor…", "Yeni ilçe ekle");
  districtSelect.disabled = true;
  if (!provinceApiId) {
    districtSelect.innerHTML = optionMarkup([], "İlçe bulunamadı", "Yeni ilçe ekle");
    districtSelect.disabled = false;
    return;
  }
  try {
    const rows = uniqueById(await fetchJson(`${API_BASE}/provinces/${encodeURIComponent(provinceApiId)}/districts?fields=id,name,provinceId&limit=1000`));
    districtSelect.innerHTML = optionMarkup(rows.map((row) => ({ ...row, value: `catalog-district-${row.id}` })), "İlçe seçin", "Yeni ilçe ekle");
  } catch (error) {
    console.warn("[Region Console] District catalog unavailable:", error);
    districtSelect.innerHTML = optionMarkup([], "İlçe verisi alınamadı", "Yeni ilçe ekle");
  } finally {
    districtSelect.disabled = false;
  }
}

async function loadNeighborhoodOptions(provinceSelect, districtSelect, neighborhoodSelect) {
  const provinceApiId = await resolveProvinceApiId(provinceSelect);
  const districtApiId = await resolveDistrictApiId(districtSelect, provinceApiId);
  neighborhoodSelect.innerHTML = optionMarkup([], "Mahalle yükleniyor…", "Yeni mahalle ekle");
  neighborhoodSelect.disabled = true;
  if (!districtApiId) {
    neighborhoodSelect.innerHTML = optionMarkup([], "Mahalle bulunamadı", "Yeni mahalle ekle");
    neighborhoodSelect.disabled = false;
    return;
  }
  try {
    const rows = uniqueById(await fetchJson(`${API_BASE}/districts/${encodeURIComponent(districtApiId)}/neighborhoods?fields=id,name,districtId,provinceId&limit=1000`));
    neighborhoodSelect.innerHTML = optionMarkup(rows.map((row) => ({ ...row, value: `catalog-neighborhood-${row.id}` })), "Mahalle seçin", "Yeni mahalle ekle");
  } catch (error) {
    console.warn("[Region Console] Neighborhood catalog unavailable:", error);
    neighborhoodSelect.innerHTML = optionMarkup([], "Mahalle verisi alınamadı", "Yeni mahalle ekle");
  } finally {
    neighborhoodSelect.disabled = false;
  }
}

function init() {
  const dialog = document.querySelector("#drawRegionForm");
  if (!dialog || dialog.dataset.hierarchyApiFix === "1") return;
  dialog.dataset.hierarchyApiFix = "1";
  const country = dialog.querySelector("#drawCountry");
  const province = dialog.querySelector("#drawProvince");
  const district = dialog.querySelector("#drawDistrict");
  const neighborhood = dialog.querySelector("#drawNeighborhood");
  if (!province || !district) return;

  province.addEventListener("change", async (event) => {
    if (province.value === "__manual__") return;
    event.stopImmediatePropagation();
    district.value = "";
    if (neighborhood) neighborhood.innerHTML = optionMarkup([], "Önce ilçe seçin", "Yeni mahalle ekle");
    await loadDistrictOptions(province, district);
  }, true);

  district.addEventListener("change", async (event) => {
    if (district.value === "__manual__" || !neighborhood) return;
    event.stopImmediatePropagation();
    neighborhood.value = "";
    await loadNeighborhoodOptions(province, district, neighborhood);
  }, true);

  if (country) country.addEventListener("change", (event) => {
    if (country.value !== "__manual__") return;
    event.stopImmediatePropagation();
    province.value = "";
    district.value = "";
    province.innerHTML = optionMarkup([], "İl seçin", "Yeni il ekle");
    district.innerHTML = optionMarkup([], "İlçe seçin", "Yeni ilçe ekle");
    if (neighborhood) neighborhood.innerHTML = optionMarkup([], "Mahalle seçin", "Yeni mahalle ekle");
  }, true);
}

const observer = new MutationObserver(() => init());
observer.observe(document.documentElement, { childList: true, subtree: true });
init();
