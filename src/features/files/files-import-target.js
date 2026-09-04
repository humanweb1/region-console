import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";
import { importRegionData } from "../regions/importer.js";

const elements = getElements();
const TYPE_LABELS = { country: "Ülke", province: "İl", district: "İlçe", neighborhood: "Mahalle", cemetery: "Mezarlık", independent: "Özel Alan" };

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function typeOf(region) { return String(region?.hierarchy?.type || region?.type || "independent").toLowerCase(); }
function nameOf(region) { return String(region?.name || region?.title || "İsimsiz").trim(); }
function customFiles() { return Array.isArray(store.get().regions?.custom) ? store.get().regions.custom : []; }
function parentOf(region) {
  const id = region?.hierarchy?.parentId || region?.parent_id;
  if (!id) return null;
  return customFiles().find((item) => String(item.id) === String(id)) || null;
}
function pathOf(region) {
  const chain = [];
  let current = region;
  const seen = new Set();
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    chain.unshift(nameOf(current));
    current = parentOf(current);
  }
  return chain.join(" / ");
}
function candidates() {
  // Hedef olarak gerçek mevcut dosyaların tamamını göster.
  // Hiyerarşi tipi tanınmasa bile dosya listeden düşürülmez.
  return customFiles().filter((region) => region?.id);
}
function geometryOf(input) {
  const result = importRegionData(input, "", null);
  const geometries = result.regions.custom.map((region) => region.geometry).filter(Boolean);
  if (!geometries.length) throw new Error("Geçerli Polygon veya MultiPolygon bulunamadı.");
  if (geometries.length === 1) return geometries[0];
  const polygons = [];
  for (const geometry of geometries) {
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
    else if (geometry.type === "MultiPolygon") polygons.push(...geometry.coordinates);
  }
  if (!polygons.length) throw new Error("Dosyada kullanılabilir poligon bulunamadı.");
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}
function coordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}
function boundsOf(geometry) {
  const points = coordinates(geometry);
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}
function selectDialog() {
  const files = candidates();
  if (!files.length) {
    toast(elements, "İçe aktarılacak mevcut dosya yok. Önce Dosyalar menüsünden bir dosya oluşturun.");
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const options = files.sort((a, b) => pathOf(a).localeCompare(pathOf(b), "tr")).map((region) => {
      const label = TYPE_LABELS[typeOf(region)] || "Dosya";
      return `<option value="${esc(region.id)}">${esc(pathOf(region))} — ${esc(label)}</option>`;
    }).join("");
    openDialog(elements, "Mevcut dosyaya içe aktar", `<form id="existingFileImportForm" class="dialog-form"><p class="dialog-muted">Seçtiğiniz mevcut dosyanın geometrisi güncellenecek. Yeni dosya, ülke veya hiyerarşi kaydı oluşturulmaz.</p><label>Hedef dosya<select id="existingFileTarget" required><option value="">Dosya seçin</option>${options}</select></label><div class="dialog-actions"><button type="button" class="button" id="existingFileCancel">İptal</button><button type="submit" class="button button-primary">Dosyaya kaydet</button></div></form>`);
    const form = elements.dialogBody.querySelector("#existingFileImportForm");
    const finish = (value) => { if (elements.appDialog.open) elements.appDialog.close(); resolve(value); };
    form.querySelector("#existingFileCancel").onclick = () => finish(null);
    form.onsubmit = (event) => { event.preventDefault(); const id = form.querySelector("#existingFileTarget").value; const target = files.find((item) => String(item.id) === String(id)); if (!target) return; finish(target); };
    elements.appDialog.addEventListener("cancel", () => finish(null), { once: true });
  });
}
async function persist() {
  const session = store.get().auth.session;
  if (!session?.access_token) throw new Error("Oturum bulunamadı.");
  await upsertState(session.access_token, {
    ...store.dataSnapshot().regions,
    campaigns: store.get().campaigns,
    history: store.get().history.entries,
    importedFiles: store.get().importedFiles,
    mapSettings: store.get().mapSettings
  });
}
async function runImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.geojson,application/json,application/geo+json,text/json";
  input.multiple = false;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("Dosya boş.");
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("Dosya geçerli JSON değil."); }
      const target = await selectDialog();
      if (!target) return;
      const geometry = geometryOf(parsed);
      const before = store.dataSnapshot();
      const now = new Date().toISOString();
      const regions = customFiles().map((region) => String(region.id) === String(target.id)
        ? { ...region, geometry, bounds: boundsOf(geometry), updatedAt: now, importMeta: { ...(region.importMeta || {}), geometrySourceFile: file.name, geometryImportedAt: now, format: "GeoJSON", coordinateOrder: "lonlat" } }
        : region);
      store.replaceData({ regions: { ...store.get().regions, custom: regions, selectedId: target.id }, campaigns: store.get().campaigns, importedFiles: store.get().importedFiles }, { recordHistory: false });
      store.recordHistory(`Geometri mevcut dosyaya aktarıldı: ${nameOf(target)}`, before, store.dataSnapshot());
      await persist();
      document.dispatchEvent(new CustomEvent("region-console:state-changed"));
      closeDialog(elements);
      toast(elements, `${file.name} → ${nameOf(target)} dosyasına kaydedildi.`);
    } catch (error) {
      console.error("[Region Console] Existing-file import failed:", error);
      toast(elements, `İçe aktarma başarısız: ${error.message || "Bilinmeyen hata"}`);
    }
  };
  input.click();
}

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("#filesImportButton");
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  runImport();
}, true);
