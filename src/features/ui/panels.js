import { exportToFolders } from "../../services/folder-export.js";
import { store } from "../../state/store.js";
import { openDialog } from "../../components/shell.js";
import { can } from "../../services/rbac.js";

function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function renderHistoryDialog(elements, visibleCount) {
  const entries = store.get().history.entries.slice().reverse(); const visible = entries.slice(0, visibleCount); const hasMore = visible.length < entries.length;
  const list = visible.length ? `<div class="history-list">${visible.map((entry, index) => `<div class="history-item"><strong>${escapeHtml(entry.label)}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span><small>#${entries.length - index}</small></div>`).join("")}</div>` : `<p class="dialog-muted">Henüz kaydedilmiş bir değişiklik yok.</p>`;
  const moreButton = hasMore ? `<div class="history-more"><button id="historyShowMore" class="button" type="button">Daha eskiyi göster <span>(${Math.min(visibleCount + 5, entries.length)})</span></button><small>${visible.length} / ${entries.length} işlem gösteriliyor</small></div>` : (entries.length > 5 ? `<div class="history-more"><small>Tüm ${entries.length} işlem gösteriliyor.</small></div>` : "");
  elements.dialogBody.innerHTML = `${list}${moreButton}`;
  elements.dialogBody.querySelector("#historyShowMore")?.addEventListener("click", () => renderHistoryDialog(elements, Math.min(visibleCount + 5, entries.length)));
}
function showHistory(elements) { const entries = store.get().history.entries || []; openDialog(elements, "Değişiklik geçmişi", ""); renderHistoryDialog(elements, Math.min(5, entries.length)); }

const TOOL_ICONS = {
  draw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M5 19h5M14 5h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m14 7 3 3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 10v8M12 10v8M16 10v8M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const TOOL_PERMISSIONS = { draw: "regions.create", edit: "regions.edit", delete: "regions.delete", import: "regions.import", export: "data.export", history: "history.view" };
function applyToolbarAccess() {
  const access = window.RegionConsoleRBAC?.access || null;
  document.querySelectorAll(".tool[data-tool]").forEach((button) => { const tool = button.dataset.tool; const permission = TOOL_PERMISSIONS[tool]; if (permission) button.hidden = !can(access, permission); if (TOOL_ICONS[tool] && !button.querySelector(".tool-icon")) button.insertAdjacentHTML("afterbegin", `<span class="tool-icon">${TOOL_ICONS[tool]}</span>`); });
  const rules = { addRegionButton: "regions.create", campaignButton: "campaigns.view", usersButton: "users.manage", filesButton: "files.view", undoButton: "history.undo", redoButton: "history.redo", saveButton: "regions.save" };
  for (const [id, permission] of Object.entries(rules)) { const node = document.getElementById(id); if (node) node.hidden = !can(access, permission); }
  [["regionsToggle", "regions.view"], ["zoomInButton", "map.zoom"], ["zoomOutButton", "map.zoom"], ["resetMapButton", "map.reset"], ["mapLayerButton", "map.layer"], ["satelliteLayerButton", "map.layer"]].forEach(([id, permission]) => { const node = document.getElementById(id); if (node) node.hidden = !can(access, permission); });
  const theme = document.getElementById("themeButton"); if (theme) theme.hidden = !can(access, "map.theme");
}

export function bindPanels(elements, mapState, drawing, handlers) {
  applyToolbarAccess(); window.addEventListener("region-console:rbac-updated", applyToolbarAccess);
  document.addEventListener("click", async (event) => { const exportButton = event.target?.closest?.('.tool[data-tool="export"]'); if (!exportButton || exportButton.hidden || !can(window.RegionConsoleRBAC?.access, "data.export")) return; event.preventDefault(); event.stopImmediatePropagation(); exportButton.classList.add("active"); try { const count = await exportToFolders(); window.dispatchEvent(new CustomEvent("region-console:toast", { detail: { message: `${count} alan klasör yapısına kaydedildi.` } })); } catch (error) { if (error?.name !== "AbortError") { console.error("[Region Console] Folder export failed:", error); window.alert(`Klasör kaydı başarısız: ${error.message || "Bilinmeyen hata"}`); } } finally { exportButton.classList.remove("active"); } }, true);
  document.addEventListener("click", (event) => { const historyButton = event.target?.closest?.('.tool[data-tool="history"]'); if (!historyButton || historyButton.hidden || !can(window.RegionConsoleRBAC?.access, "history.view")) return; event.preventDefault(); event.stopImmediatePropagation(); document.querySelectorAll(".tool:not(.tool-action)").forEach((button) => button.classList.remove("active")); historyButton.classList.add("active"); showHistory(elements); }, true);
  const toolLabels = { draw: "Çizim", edit: "Düzenle", delete: "Sil", import: "İçe aktar", export: "Dışa aktar", history: "Geçmiş" };
  document.querySelectorAll(".tool:not(.tool-action)").forEach((button) => { const label = toolLabels[button.dataset.tool]; if (label) { button.setAttribute("aria-label", label); button.setAttribute("title", label); } button.addEventListener("click", () => { const tool = button.dataset.tool; if (!can(window.RegionConsoleRBAC?.access, TOOL_PERMISSIONS[tool])) return; document.querySelectorAll(".tool:not(.tool-action)").forEach((b) => b.classList.remove("active")); button.classList.add("active"); handlers.onTool?.(tool); }); });
  elements.menuButton?.addEventListener("click", (event) => { event.stopPropagation(); const open = !elements.headerMenu.hidden; elements.headerMenu.hidden = open; elements.menuButton.setAttribute("aria-expanded", String(!open)); });
  const closeHeaderMenu = () => { elements.headerMenu.hidden = true; elements.menuButton?.setAttribute("aria-expanded", "false"); };
  elements.campaignButton?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "campaigns.view")) return; closeHeaderMenu(); handlers.onCampaigns?.(); });
  elements.usersButton?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "users.manage")) return; closeHeaderMenu(); handlers.onUsers?.(); });
  elements.filesButton?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "files.view")) return; closeHeaderMenu(); handlers.onFiles?.(); });
  elements.regionsToggle?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "regions.view")) return; const open = !elements.sidebar.hidden; elements.sidebar.hidden = open; elements.regionsToggle.setAttribute("aria-expanded", String(!open)); });
  elements.addRegionButton?.addEventListener("click", (event) => { if (!can(window.RegionConsoleRBAC?.access, "regions.create")) return; event.preventDefault(); event.stopPropagation(); elements.sidebar.hidden = true; elements.regionsToggle?.setAttribute("aria-expanded", "false"); document.querySelectorAll(".tool:not(.tool-action)").forEach((button) => button.classList.toggle("active", button.dataset.tool === "draw")); handlers.onTool?.("draw"); });
  document.addEventListener("click", (event) => { if (!elements.headerMenu.hidden && !elements.headerMenu.contains(event.target) && !elements.menuButton.contains(event.target)) closeHeaderMenu(); if (elements.sidebar.hidden) return; if (elements.sidebar.contains(event.target) || elements.regionsToggle.contains(event.target)) return; elements.sidebar.hidden = true; elements.regionsToggle.setAttribute("aria-expanded", "false"); });
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!elements.headerMenu.hidden) { closeHeaderMenu(); elements.menuButton.focus(); return; } if (elements.sidebar.hidden) return; elements.sidebar.hidden = true; elements.regionsToggle.setAttribute("aria-expanded", "false"); elements.regionsToggle.focus(); });
  document.getElementById("zoomInButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "map.zoom")) mapState.map.zoomIn(); });
  document.getElementById("zoomOutButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "map.zoom")) mapState.map.zoomOut(); });
  document.getElementById("resetMapButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "map.reset")) handlers.onResetMap?.(); });
  document.getElementById("mapLayerButton")?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "map.layer")) return; handlers.onLayer?.("standard"); document.getElementById("mapLayerButton")?.classList.add("active"); document.getElementById("satelliteLayerButton")?.classList.remove("active"); });
  document.getElementById("satelliteLayerButton")?.addEventListener("click", () => { if (!can(window.RegionConsoleRBAC?.access, "map.layer")) return; handlers.onLayer?.("satellite"); document.getElementById("satelliteLayerButton")?.classList.add("active"); document.getElementById("mapLayerButton")?.classList.remove("active"); });
  document.getElementById("themeButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "map.theme")) handlers.onTheme?.(); });
  document.getElementById("logoutButton")?.addEventListener("click", handlers.onLogout);
  document.getElementById("dialogClose")?.addEventListener("click", () => elements.appDialog.close());
  document.getElementById("undoButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "history.undo")) handlers.onUndo?.(); });
  document.getElementById("redoButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "history.redo")) handlers.onRedo?.(); });
  document.getElementById("saveButton")?.addEventListener("click", () => { if (can(window.RegionConsoleRBAC?.access, "regions.save")) handlers.onSave?.(); });
}