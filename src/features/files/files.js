import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const elements = getElements();

const TYPE_LABELS = {
  country: "Ülke",
  province: "İl",
  district: "İlçe",
  neighborhood: "Mahalle",
  cemetery: "Mezarlık",
  independent: "Özel Alan"
};

const TYPE_FOLDERS = {
  province: "İller",
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
  return region?.hierarchy?.type || region?.type || "independent";
}

function regionName(region) {
  return String(region?.name || region?.title || "İsimsiz Bölge").trim();
}

function parentInfo(region) {
  const hierarchy = region?.hierarchy || {};
  return {
    id: hierarchy.parentId == null ? null : String(hierarchy.parentId),
    name: hierarchy.parentName ? String(hierarchy.parentName).trim() : null
  };
}

function allKnownRegions() {
  const current = store.get();
  const custom = Array.isArray(current.regions?.custom) ? current.regions.custom : [];
  const countries = Array.isArray(current.regions?.countries) ? current.regions.countries : [];
  const result = [...custom];

  const walk = (items, country = null) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !item.id) continue;
      result.push({
        ...item,
        _countryId: country?.id || item._countryId || null,
        _countryName: country?.name || item._countryName || null
      });
      walk(item.provinces, country);
      walk(item.children, country);
    }
  };

  for (const country of countries) {
    result.push({ ...country, _countryId: country.id, _countryName: country.name });
    walk(country.provinces, country);
    walk(country.children, country);
  }

  const seen = new Set();
  return result.filter((region) => {
    const key = String(region.id ?? `${regionType(region)}:${regionName(region)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findParent(region, known) {
  const { id, name } = parentInfo(region);
  if (!id && !name) return null;
  return known.find((candidate) => {
    const candidateId = candidate?.id == null ? null : String(candidate.id);
    const candidateName = normalizeName(regionName(candidate));
    return (id && candidateId === id) || (name && candidateName === normalizeName(name));
  }) || null;
}

function buildRegionPath(region, known) {
  const type = regionType(region);
  if (type === "independent") return ["Özel Alanlar"];

  const chain = [];
  const visited = new Set();
  let current = region;

  while (current && !visited.has(String(current.id ?? regionName(current)))) {
    visited.add(String(current.id ?? regionName(current)));
    chain.unshift(current);
    current = findParent(current, known);
  }

  const hierarchy = region?.hierarchy || {};
  let countryName = hierarchy.countryName || region?._countryName || null;
  const provinceNames = [];
  const districtNames = [];
  const neighborhoodNames = [];

  for (const item of chain) {
    const itemType = regionType(item);
    const name = regionName(item);
    if (itemType === "country" && !countryName) countryName = name;
    if (itemType === "province") provinceNames.push(name);
    if (itemType === "district") districtNames.push(name);
    if (itemType === "neighborhood") neighborhoodNames.push(name);
  }

  if (!countryName && chain.length) {
    countryName = chain[0]?.hierarchy?.countryName || chain[0]?._countryName || null;
  }

  const path = [];
  if (countryName) path.push(countryName);

  if (type === "country") {
    if (!path.length) path.push(regionName(region));
    return path;
  }

  const provinceName = provinceNames[provinceNames.length - 1] || (type === "province" ? regionName(region) : hierarchy.parentName);
  if (provinceName && !path.some((item) => normalizeName(item) === normalizeName(provinceName))) path.push(provinceName);

  if (type === "province") {
    path.push(TYPE_FOLDERS.province);
    return path;
  }

  const districtName = districtNames[districtNames.length - 1] || (type === "district" ? regionName(region) : null);
  if (districtName && !path.some((item) => normalizeName(item) === normalizeName(districtName))) path.push(districtName);

  if (type === "district") {
    path.push(TYPE_FOLDERS.district);
    return path;
  }

  const neighborhoodName = neighborhoodNames[neighborhoodNames.length - 1] || (type === "neighborhood" ? regionName(region) : null);
  if (neighborhoodName && !path.some((item) => normalizeName(item) === normalizeName(neighborhoodName))) path.push(neighborhoodName);

  if (type === "neighborhood") {
    path.push(TYPE_FOLDERS.neighborhood);
    return path;
  }

  if (type === "cemetery") {
    path.push(TYPE_FOLDERS.cemetery);
    return path;
  }

  return path.length ? path : [TYPE_FOLDERS.independent];
}

function getFiles() {
  const regions = store.get().regions.custom || [];
  const registry = store.get().importedFiles || [];
  const byName = new Map();

  registry.forEach((file) => {
    if (file?.name) byName.set(String(file.name), { ...file, regionCount: 0 });
  });

  regions.forEach((region) => {
    const fileName = region?.importMeta?.sourceFile;
    if (!fileName) return;
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
  });

  return [...byName.values()].sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
}

function getFileRegions(fileName) {
  return (store.get().regions.custom || []).filter(
    (region) => String(region?.importMeta?.sourceFile || "") === String(fileName)
  );
}

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "Boyut bilinmiyor";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function createFolderTree(files) {
  const root = { folders: new Map(), files: new Map() };
  const known = allKnownRegions();

  for (const file of files) {
    const fileRegions = getFileRegions(file.name);
    const paths = new Map();

    if (!fileRegions.length) {
      paths.set("İçe Aktarılan Dosyalar", ["İçe Aktarılan Dosyalar"]);
    } else {
      fileRegions.forEach((region) => {
        const path = buildRegionPath(region, known);
        paths.set(path.join("\u0000"), path);
      });
    }

    for (const path of paths.values()) {
      let node = root;
      path.forEach((folderName) => {
        if (!node.folders.has(folderName)) node.folders.set(folderName, { folders: new Map(), files: new Map() });
        node = node.folders.get(folderName);
      });
      node.files.set(String(file.name), file);
    }
  }

  return root;
}

function renderFileCard(file) {
  return `<article class="file-card"><div class="file-main"><strong>${escapeHtml(file.name)}</strong><span>${file.regionCount} bölge · ${formatSize(file.size)}</span><small>${file.importedAt ? new Date(file.importedAt).toLocaleString("tr-TR") : "Tarih bilinmiyor"}</small></div><button class="button file-delete" type="button" data-file-name="${escapeHtml(file.name)}">Sil</button></article>`;
}

function renderFolderTree(node, depth = 0) {
  const folders = [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b, "tr"));
  const files = [...node.files.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
  const folderMarkup = folders.map(([name, child]) => {
    const childContent = renderFolderTree(child, depth + 1);
    const fileCount = child.files.size;
    const nestedCount = countFiles(child) - fileCount;
    const total = fileCount + nestedCount;
    return `<details class="file-folder" ${depth === 0 ? "open" : ""}><summary><span class="file-folder-name">📁 ${escapeHtml(name)}</span><small>${total} dosya</small></summary><div class="file-folder-content">${childContent}</div></details>`;
  }).join("");
  const fileMarkup = files.length ? `<div class="files-list file-folder-files">${files.map(renderFileCard).join("")}</div>` : "";
  return `${folderMarkup}${fileMarkup}`;
}

function countFiles(node) {
  let total = node.files.size;
  for (const child of node.folders.values()) total += countFiles(child);
  return total;
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
  const regions = (current.regions.custom || []).filter(
    (region) => String(region?.importMeta?.sourceFile || "") !== String(fileName)
  );
  const removed = (current.regions.custom || []).length - regions.length;
  if (!removed) {
    toast(elements, "Bu dosyaya bağlı bölge bulunamadı.");
    return;
  }

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
  const body = files.length
    ? `<div class="files-tree">${renderFolderTree(tree)}</div>`
    : `<p class="dialog-muted">Henüz içe aktarılan dosya yok.</p>`;

  openDialog(elements, "Dosyalar", body);

  elements.dialogBody.querySelectorAll(".file-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const fileName = button.dataset.fileName;
      if (!fileName) return;
      if (!window.confirm(`“${fileName}” dosyası ve bu dosyadan içe aktarılan bölgeler silinsin mi?`)) return;
      removeFile(fileName);
    });
  });
}

function syncRegistry() {
  const files = getFiles();
  const current = store.get().importedFiles || [];
  const currentNames = new Set(current.map((file) => String(file.name)));
  const missing = files.filter((file) => !currentNames.has(String(file.name)));
  if (!missing.length) return;
  store.set({ importedFiles: [...current, ...missing] });
}

store.subscribe(syncRegistry);

document.addEventListener("DOMContentLoaded", () => {
  syncRegistry();
  elements.filesButton?.addEventListener("click", showFiles);
});

if (document.readyState !== "loading") {
  syncRegistry();
  elements.filesButton?.addEventListener("click", showFiles);
}
