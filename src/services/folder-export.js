import { store } from "../state/store.js";

const TYPE_FOLDER = {
  country: "Ülkeler",
  province: "İller",
  district: "İlçeler",
  neighborhood: "Mahalleler",
  cemetery: "Mezarlıklar",
  independent: "Özel Alanlar"
};

function safeName(value, fallback = "İsimsiz Alan") {
  const name = String(value || fallback).trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, " ");
  return name.slice(0, 120) || fallback;
}

function typeOf(region) {
  return region?.hierarchy?.type || region?.type || "independent";
}

function nameOf(region) {
  return region?.name || region?.title || region?.label || region?.properties?.name || "İsimsiz Alan";
}

function parentNameOf(region) {
  return region?.hierarchy?.parentName || region?.importMeta?.parentName || null;
}

function countryNameOf(region) {
  return region?.hierarchy?.countryName || region?.importMeta?.countryName || null;
}

function parentIdOf(region) {
  return region?.hierarchy?.parentId || region?.importMeta?.parentId || null;
}

function buildIndexes(regions) {
  const byId = new Map();
  const byName = new Map();
  regions.forEach((region) => {
    if (region?.id != null) byId.set(String(region.id), region);
    const key = `${typeOf(region)}:${safeName(nameOf(region), "").toLocaleLowerCase("tr-TR")}`;
    byName.set(key, region);
  });
  return { byId, byName };
}

function hierarchyPath(region, indexes) {
  const type = typeOf(region);
  if (type === "independent") return ["Özel Alanlar"];

  const chain = [];
  const seen = new Set();
  let current = region;

  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    chain.unshift(current);
    const parentId = parentIdOf(current);
    const parentName = parentNameOf(current);
    const parentType = current?.hierarchy?.parentType;
    if (!parentId && !parentName) break;

    let parent = parentId ? indexes.byId.get(String(parentId)) : null;
    if (!parent && parentName && parentType) {
      parent = indexes.byName.get(`${parentType}:${safeName(parentName, "").toLocaleLowerCase("tr-TR")}`);
    }
    if (!parent) break;
    current = parent;
  }

  const country = countryNameOf(region) || (chain.find((item) => typeOf(item) === "country") && nameOf(chain.find((item) => typeOf(item) === "country")));
  const path = [];
  if (country) path.push(safeName(country));

  chain.forEach((item) => {
    const itemType = typeOf(item);
    if (itemType === "country") return;
    const itemName = safeName(nameOf(item));
    if (!path.some((part) => part.toLocaleLowerCase("tr-TR") === itemName.toLocaleLowerCase("tr-TR"))) path.push(itemName);
  });

  path.push(TYPE_FOLDER[type] || "Özel Alanlar");
  return path;
}

function regionGeoJson(region) {
  return {
    type: "Feature",
    id: region.id,
    properties: {
      name: nameOf(region),
      status: region.status || null,
      hierarchy: region.hierarchy || null,
      importMeta: region.importMeta || null
    },
    geometry: region.geometry || null
  };
}

async function writeText(directory, fileName, text) {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function getDirectory(root, parts) {
  let current = root;
  for (const part of parts.filter(Boolean)) current = await current.getDirectoryHandle(safeName(part), { create: true });
  return current;
}

export async function exportToFolders() {
  if (!("showDirectoryPicker" in window)) {
    throw new Error("Klasör kaydetme özelliği bu tarayıcıda desteklenmiyor. Güncel Chrome veya Edge kullanın.");
  }

  const root = await window.showDirectoryPicker({ mode: "readwrite" });
  const snapshot = store.dataSnapshot();
  const regions = Array.isArray(snapshot?.regions?.custom) ? snapshot.regions.custom : [];
  const indexes = buildIndexes(regions);
  const exportedAt = new Date().toISOString();

  await writeText(root, "region-console-state.json", JSON.stringify(snapshot, null, 2));

  let count = 0;
  for (const region of regions) {
    if (!region?.geometry) continue;
    const directory = await getDirectory(root, hierarchyPath(region, indexes));
    const base = safeName(nameOf(region));
    const fileName = `${base}-${safeName(region.id, "region")}.geojson`;
    await writeText(directory, fileName, JSON.stringify(regionGeoJson(region), null, 2));
    count += 1;
  }

  await writeText(root, "export-manifest.json", JSON.stringify({ version: 1, exportedAt, regionCount: count, structure: "Ülke/İl/İlçe/Mahalle/Mezarlık", source: "Region Console" }, null, 2));
  return count;
}
