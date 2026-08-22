import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";
import { importRegionData, getRegionTypeOptions } from "./importer.js";

const elements = getElements();
const PARENT_TYPE = { province: "country", district: "province", neighborhood: "district", cemetery: "neighborhood" };

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function flattenNodes(nodes, result = []) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    result.push(node);
    ["provinces", "districts", "neighborhoods", "cemeteries", "children"].forEach((key) => {
      if (Array.isArray(node?.[key])) flattenNodes(node[key], result);
    });
  });
  return result;
}

function allParents() {
  const state = store.get();
  return [...flattenNodes(state.regions.countries || []), ...(state.regions.custom || [])];
}

function parentOptions(type) {
  const required = PARENT_TYPE[type];
  if (!required) return `<option value="">Üst bölge yok</option>`;
  const label = { country: "Ülke", province: "İl", district: "İlçe" }[required] || required;
  const options = allParents()
    .filter((item) => String(item?.type || item?.hierarchy?.type || "country") === required)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "tr-TR", { sensitivity: "base" }))
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || "İsimsiz")} · ${label}</option>`)
    .join("");
  return `<option value="">Üst bölge seçilmedi</option>${options}`;
}

function typeOptions() {
  return getRegionTypeOptions().map(({ value, label }) => `<option value="${value}">${label}</option>`).join("");
}

function persist() {
  const session = store.get().auth.session;
  if (!session?.access_token) return Promise.resolve();
  const snapshot = store.dataSnapshot();
  return saveState(session.access_token, {
    ...snapshot.regions,
    campaigns: snapshot.campaigns,
    history: store.get().history.entries,
    importedFiles: snapshot.importedFiles,
    mapSettings: snapshot.mapSettings
  }).then((saved) => {
    store.update("cloud", { status: "ready", version: saved?.version || Date.now(), updatedAt: saved?.updated_at || new Date().toISOString(), error: null });
  }).catch((error) => {
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Bulut kaydı başarısız: ${error.message}`);
  });
}

function showImportDialog() {
  openDialog(elements, "Bölge içe aktar", `<form id="regionImportForm" class="dialog-form"><p class="dialog-muted">Dosyadaki geometrilerin hangi katmana ait olduğunu seçin. Alt katmanlarda isterseniz bir üst bölge de belirleyebilirsiniz.</p><label>Bölge tipi<select id="importRegionType" name="type">${typeOptions()}</select></label><label id="importParentField">Üst bölge<select id="importParentId" name="parentId"></select></label><div class="dialog-actions"><button id="importCancel" class="button" type="button">Vazgeç</button><button class="button button-primary" type="submit">Dosyayı seç</button></div></form>`);

  const form = elements.dialogBody.querySelector("#regionImportForm");
  const typeSelect = elements.dialogBody.querySelector("#importRegionType");
  const parentField = elements.dialogBody.querySelector("#importParentField");
  const parentSelect = elements.dialogBody.querySelector("#importParentId");
  const refreshParent = () => {
    const type = typeSelect.value;
    const required = PARENT_TYPE[type];
    parentField.hidden = !required;
    parentSelect.innerHTML = parentOptions(type);
  };
  typeSelect.addEventListener("change", refreshParent);
  refreshParent();

  elements.dialogBody.querySelector("#importCancel").addEventListener("click", () => closeDialog(elements));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const type = typeSelect.value;
    const parentId = parentSelect.value || null;
    if (PARENT_TYPE[type] && !parentId) return toast(elements, "Bu alt katman için bir üst bölge seçin.");
    closeDialog(elements);

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
        let imported;
        try { imported = JSON.parse(text); } catch { throw new Error("Dosya geçerli JSON değil."); }

        const result = importRegionData(imported, file.name, type, parentId);
        const before = store.dataSnapshot();
        if (result.mode === "region-console") {
          store.replaceData({ regions: result.regions, campaigns: result.campaigns }, { recordHistory: false });
          store.recordHistory("Region Console JSON içe aktarıldı", before, store.dataSnapshot());
          await persist();
          toast(elements, `${result.importedCount} kayıt içe aktarıldı.`);
          return;
        }

        const current = store.get();
        const currentCustom = Array.isArray(current.regions.custom) ? current.regions.custom : [];
        const existingKeys = new Set(currentCustom.map((region) => region?.importMeta?.sourceId).filter(Boolean).map(String));
        const freshRegions = result.regions.custom.filter((region) => !existingKeys.has(String(region.importMeta?.sourceId)));
        const duplicates = result.importedCount - freshRegions.length;
        const importedAt = new Date().toISOString();
        const registry = Array.isArray(current.importedFiles) ? current.importedFiles : [];
        const nextRegistry = [
          ...registry.filter((item) => String(item?.name) !== String(file.name)),
          { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || "application/geo+json", importedAt, regionCount: freshRegions.length }
        ];
        freshRegions.forEach((region) => {
          region.importMeta = { ...(region.importMeta || {}), sourceFile: file.name, importedAt };
        });

        store.replaceData({
          regions: { ...current.regions, custom: [...currentCustom, ...freshRegions], selectedId: null },
          campaigns: current.campaigns,
          importedFiles: nextRegistry
        }, { recordHistory: false });
        store.recordHistory(`${result.regionTypeLabel} içe aktarıldı`, before, store.dataSnapshot());
        await persist();

        const duplicateMessage = duplicates ? ` ${duplicates} tekrar kayıt atlandı.` : "";
        const skippedMessage = result.skippedCount ? ` ${result.skippedCount} geçersiz geometri atlandı.` : "";
        toast(elements, `${freshRegions.length} ${result.regionTypeLabel.toLocaleLowerCase("tr-TR")} içe aktarıldı.${duplicateMessage}${skippedMessage}`);
      } catch (error) {
        console.error("[Region Console] Import failed:", error);
        toast(elements, `İçe aktarma başarısız: ${error.message || "Bilinmeyen hata"}`);
      }
    };
    input.click();
  });
}

// Intercept the existing import tool before panels.js invokes the legacy importer flow.
document.addEventListener("click", (event) => {
  const button = event.target.closest?.('.tool[data-tool="import"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showImportDialog();
}, true);
