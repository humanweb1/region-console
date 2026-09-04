import { store } from "../../state/store.js";
import { loadHistoryEntries, saveHistoryEntry } from "../../services/history-service.js";
import { saveState } from "../../services/cloud.js";
import { can, canManageInScope, isRegionVisible } from "../../services/rbac.js";

function stable(value) { try { return JSON.stringify(value ?? null); } catch { return String(value); } }
function regionKey(region) { return String(region?.id ?? region?.importMeta?.sourceId ?? region?.name ?? ""); }
function regionType(region) { return String(region?.hierarchy?.type || region?.type || "özel"); }
function statusLabel(value) { const map = { service: "Hizmette", closed: "Hizmete kapalı", outside: "Hizmet dışı", campaign: "Kampanyalı" }; return map[String(value || "service")] || String(value || "Belirtilmemiş"); }

function deriveChanges(entry) {
  const explicit = Array.isArray(entry?.entry?.changes) ? entry.entry.changes : [];
  if (explicit.length) return explicit;
  const before = Array.isArray(entry?.entry?.before?.regions?.custom) ? entry.entry.before.regions.custom : [];
  const after = Array.isArray(entry?.entry?.after?.regions?.custom) ? entry.entry.after.regions.custom : [];
  const beforeMap = new Map(before.filter(Boolean).map((region) => [regionKey(region), region]));
  const afterMap = new Map(after.filter(Boolean).map((region) => [regionKey(region), region]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  return keys.map((key) => {
    const b = beforeMap.get(key) || null, a = afterMap.get(key) || null;
    return {
      id: key,
      type: a ? regionType(a) : regionType(b),
      name: a?.name || b?.name || "Adsız alan",
      action: !b ? "created" : !a ? "deleted" : "updated",
      beforeName: b?.name || null,
      afterName: a?.name || null,
      beforeStatus: b?.status || null,
      afterStatus: a?.status || null,
      beforeReason: b?.serviceCloseReason || null,
      afterReason: a?.serviceCloseReason || null,
      geometryChanged: stable(b?.geometry || null) !== stable(a?.geometry || null),
      beforeHierarchy: b?.hierarchy || null,
      afterHierarchy: a?.hierarchy || null
    };
  }).filter((change) => {
    const b = beforeMap.get(change.id) || null, a = afterMap.get(change.id) || null;
    return stable(b) !== stable(a);
  });
}

function compactHistoryEntry(label, before, after) {
  const beforeRegions = Array.isArray(before?.regions?.custom) ? before.regions.custom : [];
  const afterRegions = Array.isArray(after?.regions?.custom) ? after.regions.custom : [];
  const beforeMap = new Map(beforeRegions.filter(Boolean).map((region) => [regionKey(region), region]));
  const afterMap = new Map(afterRegions.filter(Boolean).map((region) => [regionKey(region), region]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  const changedBefore = [], changedAfter = [], changes = [];
  for (const key of keys) {
    const b = beforeMap.get(key) || null, a = afterMap.get(key) || null;
    if (stable(b) === stable(a)) continue;
    if (b) changedBefore.push(b);
    if (a) changedAfter.push(a);
    changes.push({
      id: key,
      type: a ? regionType(a) : regionType(b),
      name: a?.name || b?.name || "Adsız alan",
      action: !b ? "created" : !a ? "deleted" : "updated",
      beforeName: b?.name || null,
      afterName: a?.name || null,
      beforeStatus: b?.status || null,
      afterStatus: a?.status || null,
      beforeReason: b?.serviceCloseReason || null,
      afterReason: a?.serviceCloseReason || null,
      geometryChanged: stable(b?.geometry || null) !== stable(a?.geometry || null),
      beforeHierarchy: b?.hierarchy || null,
      afterHierarchy: a?.hierarchy || null
    });
  }
  const beforeMapSettings = before?.mapSettings || before?.regions?.mapSettings || null;
  const afterMapSettings = after?.mapSettings || after?.regions?.mapSettings || null;
  const mapSettingsChanged = stable(beforeMapSettings) !== stable(afterMapSettings);
  const campaignsChanged = stable(before?.campaigns || []) !== stable(after?.campaigns || []);
  const importedFilesChanged = stable(before?.importedFiles || []) !== stable(after?.importedFiles || []);
  return {
    label,
    createdAt: new Date().toISOString(),
    before: { regions: { custom: structuredClone(changedBefore) }, ...(mapSettingsChanged ? { mapSettings: structuredClone(beforeMapSettings) } : {}), ...(campaignsChanged ? { campaigns: structuredClone(before?.campaigns || []) } : {}), ...(importedFilesChanged ? { importedFiles: structuredClone(before?.importedFiles || []) } : {}) },
    after: { regions: { custom: structuredClone(changedAfter) }, ...(mapSettingsChanged ? { mapSettings: structuredClone(afterMapSettings) } : {}), ...(campaignsChanged ? { campaigns: structuredClone(after?.campaigns || []) } : {}), ...(importedFilesChanged ? { importedFiles: structuredClone(after?.importedFiles || []) } : {}) },
    changedRegionCount: Math.max(changedBefore.length, changedAfter.length),
    changes,
    changedSections: { regions: changes.length > 0, mapSettings: mapSettingsChanged, campaigns: campaignsChanged, importedFiles: importedFilesChanged }
  };
}

const originalRecordHistory = store.recordHistory.bind(store);
store.recordHistory = function persistedHistoryRecord(label, before, after) {
  const compact = compactHistoryEntry(label, before, after);
  originalRecordHistory(label, before, after);
  const accessToken = store.get().auth.session?.access_token;
  if (accessToken) saveHistoryEntry(accessToken, compact).catch((error) => console.error("[Region Console] History cloud save failed:", error));
};

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function actorName(entry) { return entry?.actorName || entry?.entry?.actorName || "Bilinmeyen kullanıcı"; }
function detailsFor(entry) {
  const changes = deriveChanges(entry);
  if (!changes.length) {
    const sections = entry?.entry?.changedSections || {}, labels = [];
    if (sections.mapSettings) labels.push("Harita ayarları");
    if (sections.campaigns) labels.push("Kampanyalar");
    if (sections.importedFiles) labels.push("İçe aktarılan dosyalar");
    return labels.length ? labels.join(", ") + " güncellendi." : "Detay bilgisi bulunmuyor.";
  }
  return changes.map((change) => {
    const action = change.action === "created" ? "oluşturuldu" : change.action === "deleted" ? "silindi" : "güncellendi";
    const status = change.beforeStatus !== change.afterStatus ? `Durum: ${statusLabel(change.beforeStatus)} → ${statusLabel(change.afterStatus)}.` : "";
    const reason = change.afterReason && change.afterReason !== change.beforeReason ? `Sebep: ${change.afterReason}.` : "";
    const geometry = change.geometryChanged ? "Sınır geometrisi değişti." : "";
    return `<div class="history-change-detail"><strong>${escapeHtml(change.name)}</strong><span>${escapeHtml(change.type)} ${action}.</span>${status ? `<span>${escapeHtml(status)}</span>` : ""}${reason ? `<span>${escapeHtml(reason)}</span>` : ""}${geometry ? `<span>${escapeHtml(geometry)}</span>` : ""}</div>`;
  }).join("");
}

function canUndoEntry(entry) {
  const access = window.RegionConsoleRBAC?.access || null;
  if (!access?.loaded) return false;
  const changes = deriveChanges(entry);
  if (!changes.length) return can(access, "history.undo") || can(access, "regions.save");
  return changes.every((change) => {
    const region = (store.get().regions.custom || []).find((item) => String(item?.id) === String(change.id));
    const target = region?.hierarchy || change.afterHierarchy || change.beforeHierarchy || {};
    const scope = { countryId: target.countryId || null, provinceId: target.provinceId || null, districtId: target.districtId || null };
    const permission = can(access, "history.undo") || can(access, "regions.save");
    return permission && isRegionVisible(access, region || { hierarchy: target }) && canManageInScope(access, can(access, "history.undo") ? "history.undo" : "regions.save", scope);
  });
}

function currentMatchesEntry(entry) {
  const changes = deriveChanges(entry);
  const current = store.get().regions.custom || [];
  for (const change of changes) {
    const actual = current.find((item) => String(item?.id) === String(change.id)) || null;
    const after = (entry.entry.after?.regions?.custom || []).find((item) => String(item?.id) === String(change.id)) || null;
    if (stable(actual) !== stable(after)) return false;
  }
  return true;
}

async function undoEntry(entry) {
  if (!canUndoEntry(entry)) throw new Error("Bu değişikliği geri alma yetkiniz yok.");
  if (!currentMatchesEntry(entry)) throw new Error("Bu kayıt artık mevcut durumla uyuşmuyor. Daha yeni bir değişiklik yapılmış olabilir.");
  const beforeRegions = Array.isArray(entry.entry?.before?.regions?.custom) ? entry.entry.before.regions.custom : [];
  const afterRegions = Array.isArray(entry.entry?.after?.regions?.custom) ? entry.entry.after.regions.custom : [];
  const beforeMap = new Map(beforeRegions.map((item) => [regionKey(item), item]));
  const afterMap = new Map(afterRegions.map((item) => [regionKey(item), item]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const current = (store.get().regions.custom || []).filter(Boolean);
  const nextCustom = current.filter((item) => !keys.has(regionKey(item))).concat([...beforeMap.values()].map((item) => structuredClone(item)));
  const snapshotBefore = store.dataSnapshot();
  const patch = { custom: nextCustom };
  if (entry.entry.before?.mapSettings) patch.mapSettings = structuredClone(entry.entry.before.mapSettings);
  store.update("regions", patch);
  if (entry.entry.before?.campaigns) store.set({ campaigns: structuredClone(entry.entry.before.campaigns) });
  if (entry.entry.before?.importedFiles) store.set({ importedFiles: structuredClone(entry.entry.before.importedFiles) });
  const snapshotAfter = store.dataSnapshot();
  store.recordHistory(`Geri alındı: ${entry.label || "Güncelleme"}`, snapshotBefore, snapshotAfter);
  const token = store.get().auth.session?.access_token;
  if (token) await saveState(token, { ...snapshotAfter.regions, campaigns: snapshotAfter.campaigns, history: store.get().history.entries, importedFiles: snapshotAfter.importedFiles, mapSettings: snapshotAfter.mapSettings });
}

let forwardingSimulation = false;
async function renderHistoryDialog() {
  const elements = { appDialog: document.getElementById("appDialog"), dialogTitle: document.getElementById("dialogTitle"), dialogBody: document.getElementById("dialogBody") };
  const accessToken = store.get().auth.session?.access_token;
  const entries = await loadHistoryEntries(accessToken, 5, 0);
  window.__regionConsoleHistory = { entries, offset: entries.length };
  const draw = () => {
    const current = window.__regionConsoleHistory?.entries || [];
    elements.dialogTitle.textContent = "Geçmiş";
    elements.dialogBody.innerHTML = current.length ? `<div class="history-list">${current.map((entry, index) => {
      const details = detailsFor(entry), undo = canUndoEntry(entry);
      return `<article class="history-item" data-history-index="${index}"><div class="history-item-head"><div class="history-title"><strong>${escapeHtml(entry.label || "Güncelleme")}</strong><span>${escapeHtml(actorName(entry))}</span></div><time>${new Date(entry.createdAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div><div class="history-item-details">${details}</div><div class="history-item-actions"><button class="history-sim-open button" type="button">Simüle et</button>${undo ? `<button class="history-undo button button-primary" type="button">Geri al</button>` : ""}</div></article>`;
    }).join("")}</div><div class="history-load-more"><button id="historyLoadMore" class="button" type="button">Daha eski kayıtları göster</button></div>` : `<p class="dialog-muted">Henüz kayıt yok.</p>`;
    if (!elements.appDialog.open) elements.appDialog.showModal();
  };
  draw();
  elements.dialogBody.querySelector("#historyLoadMore")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const offset = window.__regionConsoleHistory.offset;
    const next = await loadHistoryEntries(accessToken, 5, offset);
    window.__regionConsoleHistory.entries.push(...next);
    window.__regionConsoleHistory.offset += next.length;
    draw();
  });
}

window.addEventListener("click", (event) => {
  const tool = event.target?.closest?.('.tool[data-tool="history"]');
  if (!tool || forwardingSimulation) return;
  event.preventDefault(); event.stopImmediatePropagation();
  renderHistoryDialog().catch((error) => console.error("[Region Console] History load failed:", error));
}, true);
window.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".history-undo");
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const item = button.closest(".history-item"), index = Number(item?.dataset.historyIndex), entry = window.__regionConsoleHistory?.entries?.[index];
  if (!entry) return;
  if (!window.confirm(`“${entry.label || "Bu değişiklik"}” geri alınsın mı?`)) return;
  button.disabled = true;
  undoEntry(entry).then(() => { renderHistoryDialog(); }).catch((error) => { button.disabled = false; alert(error.message || "Geri alma başarısız."); });
}, true);
window.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".history-sim-open");
  if (!button || forwardingSimulation) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const item = button.closest(".history-item"), index = Number(item?.dataset.historyIndex), entry = window.__regionConsoleHistory?.entries?.[index];
  if (!entry) return;
  const historyEntries = window.__regionConsoleHistory.entries.map((item) => item.entry || item).reverse();
  store.set({ history: { ...store.get().history, entries: historyEntries, cursor: historyEntries.length - 1 } });
  forwardingSimulation = true; button.click(); forwardingSimulation = false;
}, true);

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `.history-list{display:grid;gap:6px}.history-item{padding:9px 11px;border:1px solid rgba(255,255,255,.07);border-radius:8px;background:rgba(255,255,255,.02)}.history-item-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.history-title{display:flex;align-items:baseline;gap:8px;min-width:0}.history-title strong{font-size:.91rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-title span{font-size:.74rem;opacity:.55;white-space:nowrap}.history-item-head time{font-size:.72rem;opacity:.55;white-space:nowrap}.history-item-details{margin-top:5px;font-size:.78rem;opacity:.78}.history-change-detail{display:flex;flex-wrap:wrap;gap:3px 7px;line-height:1.35}.history-change-detail strong{font-weight:650}.history-item-actions{display:flex;gap:5px;margin-top:7px}.history-item-actions .button{min-height:28px;padding:3px 9px;font-size:.73rem}.history-item-actions .button-primary{font-weight:650}.history-load-more{display:flex;justify-content:center;margin-top:7px}.history-load-more .button{min-height:29px;padding:3px 10px;font-size:.73rem}@media(max-width:720px){.history-item-head{align-items:flex-start}.history-title{display:grid;gap:2px}.history-item-head time{font-size:.68rem}.history-item-actions .button{flex:1}}`;
  document.head.appendChild(style);
}
