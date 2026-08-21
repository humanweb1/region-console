import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const elements = getElements();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "Boyut bilinmiyor";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
  openDialog(elements, "Dosyalar", files.length
    ? `<div class="files-list">${files.map((file) => `<article class="file-card"><div class="file-main"><strong>${escapeHtml(file.name)}</strong><span>${file.regionCount} bölge · ${formatSize(file.size)}</span><small>${file.importedAt ? new Date(file.importedAt).toLocaleString("tr-TR") : "Tarih bilinmiyor"}</small></div><button class="button file-delete" type="button" data-file-name="${escapeHtml(file.name)}">Sil</button></article>`).join("")}</div>`
    : `<p class="dialog-muted">Henüz içe aktarılan dosya yok.</p>`);

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
