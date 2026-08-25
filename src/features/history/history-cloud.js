import { store } from "../../state/store.js";
import { loadHistoryEntries, saveHistoryEntry } from "../../services/history-service.js";

function stable(value) {
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
}

function regionKey(region) {
  return String(region?.id ?? region?.importMeta?.sourceId ?? region?.name ?? "");
}

function compactHistoryEntry(label, before, after) {
  const beforeRegions = Array.isArray(before?.regions?.custom) ? before.regions.custom : [];
  const afterRegions = Array.isArray(after?.regions?.custom) ? after.regions.custom : [];
  const beforeMap = new Map(beforeRegions.map((region) => [regionKey(region), region]));
  const afterMap = new Map(afterRegions.map((region) => [regionKey(region), region]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  const changedBefore = [];
  const changedAfter = [];

  for (const key of keys) {
    const beforeRegion = beforeMap.get(key) || null;
    const afterRegion = afterMap.get(key) || null;
    if (stable(beforeRegion) === stable(afterRegion)) continue;
    if (beforeRegion) changedBefore.push(beforeRegion);
    if (afterRegion) changedAfter.push(afterRegion);
  }

  return {
    label,
    createdAt: new Date().toISOString(),
    before: { regions: { custom: structuredClone(changedBefore) } },
    after: { regions: { custom: structuredClone(changedAfter) } },
    changedRegionCount: Math.max(changedBefore.length, changedAfter.length)
  };
}

const originalRecordHistory = store.recordHistory.bind(store);
store.recordHistory = function persistedHistoryRecord(label, before, after) {
  const compact = compactHistoryEntry(label, before, after);
  originalRecordHistory(label, before, after);
  const accessToken = store.get().auth.session?.access_token;
  if (accessToken) {
    saveHistoryEntry(accessToken, compact).catch((error) => {
      console.error("[Region Console] History cloud save failed:", error);
    });
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let forwardingSimulation = false;

async function renderHistoryDialog() {
  const elements = {
    appDialog: document.getElementById("appDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogBody: document.getElementById("dialogBody")
  };
  const accessToken = store.get().auth.session?.access_token;
  const entries = await loadHistoryEntries(accessToken, 5, 0);
  window.__regionConsoleHistory = { entries, offset: entries.length };

  const draw = () => {
    const current = window.__regionConsoleHistory?.entries || [];
    elements.dialogTitle.textContent = "Değişiklik geçmişi";
    elements.dialogBody.innerHTML = current.length
      ? `<div class="history-list">${current.map((entry, index) => `<div class="history-item" data-history-index="${index}"><strong>${escapeHtml(entry.label || "Güncelleme")}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span><small>#${index + 1}</small><button class="history-sim-open button" type="button">Haritada simüle et</button></div>`).join("")}</div><div class="history-load-more"><button id="historyLoadMore" class="button" type="button">Daha eskiyi göster (${current.length + 5})</button></div>`
      : `<p class="dialog-muted">Henüz kaydedilmiş bir değişiklik yok.</p>`;
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

document.addEventListener("click", (event) => {
  const tool = event.target?.closest?.('.tool[data-tool="history"]');
  if (!tool || forwardingSimulation) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  renderHistoryDialog().catch((error) => console.error("[Region Console] History load failed:", error));
}, true);

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.(".history-sim-open");
  if (!button || forwardingSimulation) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const item = button.closest(".history-item");
  const index = Number(item?.dataset.historyIndex);
  const entry = window.__regionConsoleHistory?.entries?.[index];
  if (!entry) return;

  const historyEntries = window.__regionConsoleHistory.entries.map((item) => item.entry || item);
  store.set({
    history: {
      ...store.get().history,
      entries: historyEntries,
      cursor: historyEntries.length - 1
    }
  });

  forwardingSimulation = true;
  button.click();
  forwardingSimulation = false;
}, true);

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `.history-load-more{display:flex;justify-content:center;margin-top:9px}.history-load-more .button{min-width:180px}`;
  document.head.appendChild(style);
}
