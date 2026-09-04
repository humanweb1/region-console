import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const elements = getElements();
const VIEW_MODE_KEY = "region-console.files-view-mode";

const TYPE_FOLDERS = {
  district: "İlçeler",
  neighborhood: "Mahalleler",
  cemetery: "Mezarlıklar",
  independent: "Özel Alanlar"
};

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

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "independent").toLowerCase();
}

function regionName(region) {
  return String(region?.name || region?.title || "İsimsiz Bölge").trim();
}

function regionCatalog() {
  const catalog = window.RegionConsoleRBAC?.access?.regionCatalog;
  return Array.isArray(catalog) ? catalog : [];
}

function createNode() {
  return { folders: new Map(), files: new Map() };
}

function folder(node, name) {
  if (!node.folders.has(name)) node.folders.set(name, createNode());
  return node.folders.get(name);
}

function catalogHierarchy() {
  const catalog = regionCatalog();
  const countries = catalog.filter((item) => String(item?.type || "").toLowerCase() === "country");
  const provinces = catalog.filter((item) => String(item?.type || "").toLowerCase() === "province");
  const districts = catalog.filter((item) => String(item?.type || "").toLowerCase() === "district");
  const neighborhoods = catalog.filter((item) => String(item?.type || "").toLowerCase() === "neighborhood");

  const byId = new Map(catalog.map((item) => [String(item?.id), item]));
  const byExternalId = new Map(catalog.filter((item) => item?.external_id != null).map((item) => [String(item.external_id), item]));
  const findParent = (item) => byId.get(String(item?.parent_id || "")) || byExternalId.get(String(item?.parent_id || "")) || null;
  const turkey = countries.find((item) => normalizeName(item?.name) === "turkey" || normalizeName(item?.name) === "türkiye") || countries[0] || null;

  const provinceItems = provinces.map((item) => ({
    ...item,
    _country: findParent(item) || turkey
  }));
  const districtItems = districts.map((item) => ({
    ...item,
    _province: findParent(item),
    _country: findParent(findParent(item) || {}) || turkey
  }));
  const neighborhoodItems = neighborhoods.map((item) => ({
    ...item,
    _district: findParent(item),
    _province: findParent(findParent(item) || {}),
    _country: turkey
  }));

  return { countries, provinces: provinceItems, districts: districtItems, neighborhoods: neighborhoodItems, turkey };
}

function seedCatalogTree(root) {
  const { countries, provinces, districts, neighborhoods, turkey } = catalogHierarchy();
  const countryNodes = countries.length ? countries : (turkey ? [turkey] : [{ id: "catalog-country-turkey", name: "Turkey", type: "country" }]);

  for (const country of countryNodes) {
    const countryFolder = folder(root, regionName(country));
    const countryId = String(country.id);
    for (const province of provinces.filter((item) => String(item._country?.id || turkey?.id || "") === countryId || (!item._country && country === turkey))) {
      const provinceFolder = folder(countryFolder, regionName(province));
      const districtRoot = folder(provinceFolder, TYPE_FOLDERS.district);
      for (const district of districts.filter((item) => String(item._province?.id || "") === String(province.id))) {
        const districtFolder = folder(districtRoot, regionName(district));
        const neighborhoodRoot = folder(districtFolder, TYPE_FOLDERS.neighborhood);
        const cemeteryRoot = folder(districtFolder, TYPE_FOLDERS.cemetery);
        for (const neighborhood of neighborhoods.filter((item) => String(item._district?.id || "") === String(district.id))) {
          const neighborhoodFolder = folder(neighborhoodRoot, regionName(neighborhood));
          folder(neighborhoodFolder, TYPE_FOLDERS.cemetery);
        }
        void cemeteryRoot;
      }
    }
  }

  if (!root.folders.size) folder(root, "Turkey");
}

function hierarchyPath(region) {
  const type = regionType(region);
  const hierarchy = region?.hierarchy || {};
  const countryName = hierarchy.countryName || "Turkey";
  const provinceName = hierarchy.provinceName || null;
  const districtName = hierarchy.districtName || null;
  const neighborhoodName = hierarchy.neighborhoodName || null;
  if (type === "country") return [countryName];
  if (type === "province") return [countryName, provinceName || regionName(region)];
  if (type === "district") return [countryName, provinceName || "İl", TYPE_FOLDERS.district, districtName || regionName(region)];
  if (type === "neighborhood") return [countryName, provinceName || "İl", TYPE_FOLDERS.district, districtName || "İlçe", TYPE_FOLDERS.neighborhood, neighborhoodName || regionName(region)];
  if (type === "cemetery") {
    const path = [countryName, provinceName || "İl", TYPE_FOLDERS.district, districtName || "İlçe"];
    if (neighborhoodName) path.push(TYPE_FOLDERS.neighborhood, neighborhoodName);
    path.push(TYPE_FOLDERS.cemetery, regionName(region));
    return path;
  }
  return [TYPE_FOLDERS.independent];
}

function getFiles() {
  const regions = Array.isArray(store.get().regions?.custom) ? store.get().regions.custom : [];
  const registry = Array.isArray(store.get().importedFiles) ? store.get().importedFiles : [];
  const byName = new Map();
  registry.forEach((file) => {
    if (file?.name) byName.set(String(file.name), { ...file, regionCount: 0 });
  });
  for (const region of regions) {
    const fileName = region?.importMeta?.sourceFile;
    if (!fileName) continue;
    const key = String(fileName);
    const current = byName.get(key) || {
      id: `legacy-file-${key}`,
      name: key,
      size: null,
      importedAt: region.importMeta?.importedAt || region.createdAt || null,
      regionCount: 0
    };
    current.regionCount += 1;
    if (!current.importedAt) current.importedAt = region.createdAt || null;
    byName.set(key, current);
  }
  return [...byName.values()].sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
}

function getFileRegions(fileName) {
  return (store.get().regions.custom || []).filter((region) => String(region?.importMeta?.sourceFile || "") === String(fileName));
}

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "Boyut bilinmiyor";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getViewMode() {
  try { return localStorage.getItem(VIEW_MODE_KEY) === "icons" ? "icons" : "list"; } catch { return "list"; }
}

function setViewMode(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode === "icons" ? "icons" : "list"); } catch {}
}

function createFolderTree(files) {
  const root = createNode();
  seedCatalogTree(root);

  for (const file of files) {
    const fileRegions = getFileRegions(file.name);
    const paths = new Map();
    if (!fileRegions.length) paths.set("İçe Aktarılan Dosyalar", ["İçe Aktarılan Dosyalar"]);
    else fileRegions.forEach((region) => {
      const path = hierarchyPath(region);
      paths.set(path.join("\u0000"), path);
    });
    for (const path of paths.values()) {
      let node = root;
      for (const folderName of path) node = folder(node, folderName);
      node.files.set(String(file.name), file);
    }
  }
  return root;
}

function renderFileCard(file, mode = "list") {
  if (mode === "icons") return `<article class="file-card file-card-icon" data-file-search="${escapeHtml(`${file.name} ${file.regionCount}`)}"><div class="file-icon">📄</div><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${file.regionCount} bölge</span><button class="button file-delete" type="button" data-file-name="${escapeHtml(file.name)}">Sil</button></article>`;
  return `<article class="file-card" data-file-search="${escapeHtml(`${file.name} ${file.regionCount}`)}"><div class="file-main"><strong>${escapeHtml(file.name)}</strong><span>${file.regionCount} bölge · ${formatSize(file.size)}</span><small>${file.importedAt ? new Date(file.importedAt).toLocaleString("tr-TR") : "Tarih bilinmiyor"}</small></div><button class="button file-delete" type="button" data-file-name="${escapeHtml(file.name)}">Sil</button></article>`;
}

function renderFolderTree(node, depth = 0, mode = "list") {
  const folders = [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b, "tr"));
  const files = [...node.files.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
  const folderMarkup = folders.map(([name, child]) => {
    const childContent = renderFolderTree(child, depth + 1, mode);
    const total = countFiles(child);
    return `<details class="file-folder" data-folder-search="${escapeHtml(name)}"><summary><span class="file-folder-name">📁 ${escapeHtml(name)}</span><small>${total} dosya</small></summary><div class="file-folder-content">${childContent}</div></details>`;
  }).join("");
  const fileMarkup = files.length ? `<div class="files-list file-folder-files ${mode === "icons" ? "files-icon-grid" : ""}">${files.map((file) => renderFileCard(file, mode)).join("")}</div>` : "";
  return `${folderMarkup}${fileMarkup}`;
}

function countFiles(node) {
  let total = node.files.size;
  for (const child of node.folders.values()) total += countFiles(child);
  return total;
}

function filterFileTree(query) {
  const normalizedQuery = normalizeName(query);
  const folders = [...elements.dialogBody.querySelectorAll("details.file-folder")];
  const cards = [...elements.dialogBody.querySelectorAll(".file-card")];
  if (!normalizedQuery) {
    folders.forEach((folderNode) => { folderNode.hidden = false; folderNode.open = false; });
    cards.forEach((card) => { card.hidden = false; });
    return;
  }
  cards.forEach((card) => { card.hidden = !normalizeName(card.dataset.fileSearch || "").includes(normalizedQuery); });
  folders.slice().reverse().forEach((folderNode) => {
    const ownMatch = normalizeName(folderNode.dataset.folderSearch || "").includes(normalizedQuery);
    const matchingDescendant = folderNode.querySelector(".file-card:not([hidden]), details.file-folder:not([hidden])");
    const visible = ownMatch || Boolean(matchingDescendant);
    folderNode.hidden = !visible;
    folderNode.open = visible;
  });
}

async function persist() {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  await upsertState(session.access_token, {
    ...store.dataSnapshot().regions,
    campaigns: store.get().campaigns,
    history: store.get().history.entries,
    importedFiles: store.get().importedFiles
  });
}

function removeFile(fileName) {
  const current = store.get();
  const before = store.dataSnapshot();
  const regions = (current.regions.custom || []).filter((region) => String(region?.importMeta?.sourceFile || "") !== String(fileName));
  const removed = (current.regions.custom || []).length - regions.length;
  if (!removed) { toast(elements, "Bu dosyaya bağlı bölge bulunamadı."); return; }
  store.replaceData({
    regions: { ...current.regions, custom: regions, selectedId: null },
    campaigns: current.campaigns,
    importedFiles: (current.importedFiles || []).filter((file) => String(file.name) !== String(fileName))
  }, { recordHistory: false });
  store.recordHistory(`Dosya silindi: ${fileName}`, before, store.dataSnapshot());
  persist().catch((error) => toast(elements, `Bulut kaydı başarısız: ${error.message}`));
  toast(elements, `${removed} bölge dosyayla birlikte silindi.`);
  showFiles();
}

function showFiles() {
  const files = getFiles();
  const tree = createFolderTree(files);
  const mode = getViewMode();
  const body = `<div class="files-dialog-toolbar"><div class="files-toolbar-row"><input id="filesSearch" class="files-search" type="search" placeholder="Dosya, ülke, il, ilçe, mahalle ara..." autocomplete="off" /><div class="files-view-switch" role="group" aria-label="Dosya gösterim tipi"><button class="files-view-button ${mode === "list" ? "active" : ""}" type="button" data-view-mode="list" title="Liste görünümü" aria-label="Liste görünümü">☰</button><button class="files-view-button ${mode === "icons" ? "active" : ""}" type="button" data-view-mode="icons" title="Simge görünümü" aria-label="Simge görünümü">▦</button></div></div><p class="dialog-muted">İdari hiyerarşi sabittir. Geometri dosyası yoksa klasör boş kalır; dosya yüklendiğinde aynı hiyerarşi altında görünür.</p></div><div class="files-tree ${mode === "icons" ? "files-tree-icons" : ""}" id="filesTree">${renderFolderTree(tree, 0, mode)}</div>`;
  openDialog(elements, "Dosyalar", body);
  const search = elements.dialogBody.querySelector("#filesSearch");
  search?.addEventListener("input", () => filterFileTree(search.value));
  elements.dialogBody.querySelectorAll("[data-view-mode]").forEach((button) => button.addEventListener("click", () => {
    const nextMode = button.dataset.viewMode === "icons" ? "icons" : "list";
    const query = search?.value || "";
    setViewMode(nextMode); showFiles();
    const nextSearch = elements.dialogBody.querySelector("#filesSearch");
    if (nextSearch) { nextSearch.value = query; if (query) filterFileTree(query); }
  }));
  elements.dialogBody.querySelectorAll(".file-delete").forEach((button) => button.addEventListener("click", () => {
    const fileName = button.dataset.fileName;
    if (!fileName) return;
    if (!window.confirm(`“${fileName}” dosyası ve bu dosyadan içe aktarılan bölgeler silinsin mi?`)) return;
    removeFile(fileName);
  }));
}

document.getElementById("filesButton")?.addEventListener("click", showFiles);
export { showFiles };
