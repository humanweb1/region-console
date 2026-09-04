import { store } from "../../state/store.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";
import { listCemeteries, createCemetery, updateCemetery, archiveCemetery } from "./cemetery-service.js";
import { canManageInScope, can, isRegionVisible } from "../../services/rbac.js";

const elements = getElements();
let cache = [];
let loaded = false;

function access() { return window.RegionConsoleRBAC?.access || null; }
function token() { return store.get().auth.session?.access_token || null; }
function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function scope(region) { const h = region?.hierarchy || {}; return { countryId: h.countryId || null, provinceId: h.provinceId || null, districtId: h.districtId || null }; }
function visibleNeighborhoods() { return (store.get().regions?.custom || []).filter((r) => r && String(r.hierarchy?.type || r.type || "").toLowerCase() === "neighborhood" && isRegionVisible(access(), r)); }
function neighborhoodLabel(id) { return visibleNeighborhoods().find((r) => String(r.id) === String(id))?.name || id || "Mahalle seçilmedi"; }
function hasView() { return can(access(), "cemeteries.view"); }
function hasManage() { return can(access(), "cemeteries.manage"); }
function ensureButton() {
  const menu = document.getElementById("headerMenu"); if (!menu) return null;
  let button = document.getElementById("cemeteriesButton");
  if (!button) { button = document.createElement("button"); button.id = "cemeteriesButton"; button.className = "header-menu-item"; button.type = "button"; button.innerHTML = "<span>Mezarlıklar</span>"; menu.appendChild(button); }
  return button;
}
async function load() {
  if (!hasView() || loaded || !token()) return cache;
  try { cache = await listCemeteries(token()) || []; loaded = true; } catch (error) { toast(elements, error.message); }
  return cache;
}
function renderList() {
  const body = elements.dialogBody.querySelector("#cemeteryList"); if (!body) return;
  body.innerHTML = cache.length ? cache.map((item) => `<div class="cemetery-row" data-cemetery-id="${esc(item.id)}"><div><strong>${esc(item.name)}</strong><span>${esc(neighborhoodLabel(item.region_id))}</span></div><div class="cemetery-row-actions"><small>${item.geometry ? "Harita mevcut" : "Harita bekliyor"}</small><button type="button" data-cemetery-open="${esc(item.id)}">Harita</button>${hasManage() ? `<button type="button" data-cemetery-edit="${esc(item.id)}">Düzenle</button><button type="button" data-cemetery-delete="${esc(item.id)}">Sil</button>` : ""}</div></div>`).join("") : `<div class="dialog-muted">Henüz kayıtlı mezarlık yok.</div>`;
  body.querySelectorAll("[data-cemetery-open]").forEach((button) => button.onclick = () => { const item = cache.find((r) => String(r.id) === String(button.dataset.cemeteryOpen)); if (item) window.RegionConsoleCemeteryStructure?.open?.(item); });
  body.querySelectorAll("[data-cemetery-edit]").forEach((button) => button.onclick = () => { const item = cache.find((r) => String(r.id) === String(button.dataset.cemeteryEdit)); if (item) form(item); });
  body.querySelectorAll("[data-cemetery-delete]").forEach((button) => button.onclick = async () => { const item = cache.find((r) => String(r.id) === String(button.dataset.cemeteryDelete)); if (!item || !hasManage() || !window.confirm(`“${item.name}” mezarlığı arşivlensin mi?`)) return; try { await archiveCemetery(token(), item.id); cache = await listCemeteries(token()) || []; renderList(); toast(elements, "Mezarlık arşivlendi."); } catch (error) { toast(elements, error.message); } });
}
function form(item = null) {
  const neighborhoods = visibleNeighborhoods(); const selected = item?.region_id || "";
  openDialog(elements, item ? "Mezarlığı düzenle" : "Mezarlık ekle", `<div class="region-dialog"><label>Mezarlık adı<input id="cemeteryName" maxlength="160" value="${esc(item?.name || "")}" required></label><label>Mahalle<select id="cemeteryRegion" required><option value="">Mahalle seçin…</option>${neighborhoods.map((r) => `<option value="${esc(r.id)}" ${String(r.id) === String(selected) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label><label>Kod<input id="cemeteryCode" maxlength="80" value="${esc(item?.code || "")}"></label><div class="dialog-actions"><button id="cemeteryCancel" class="button" type="button">Vazgeç</button><button id="cemeterySave" class="button button-primary" type="button">${item ? "Güncelle" : "Oluştur"}</button></div></div>`);
  elements.dialogBody.querySelector("#cemeteryCancel").onclick = () => openManager();
  elements.dialogBody.querySelector("#cemeterySave").onclick = async () => {
    const name = elements.dialogBody.querySelector("#cemeteryName").value.trim(); const regionId = elements.dialogBody.querySelector("#cemeteryRegion").value;
    if (!name || !regionId) return toast(elements, "Mezarlık adı ve mahalle zorunludur.");
    const region = visibleNeighborhoods().find((r) => String(r.id) === String(regionId));
    if (!region || !canManageInScope(access(), "cemeteries.manage", scope(region))) return toast(elements, "Bu mahallede mezarlık yönetme yetkiniz yok.");
    try { if (item) await updateCemetery(token(), item.id, { name, code: elements.dialogBody.querySelector("#cemeteryCode").value.trim() || null }); else await createCemetery(token(), { regionId, name, code: elements.dialogBody.querySelector("#cemeteryCode").value.trim() || null }); cache = await listCemeteries(token()) || []; loaded = true; openManager(); toast(elements, item ? "Mezarlık güncellendi." : "Mezarlık oluşturuldu."); } catch (error) { toast(elements, error.message); }
  };
}
async function openManager() {
  if (!hasView()) return toast(elements, "Mezarlıkları görüntüleme yetkiniz yok.");
  await load(); openDialog(elements, "Mezarlıklar", `<div class="cemetery-manager"><div class="dialog-actions"><button id="cemeteryAdd" class="button button-primary" type="button">+ Mezarlık ekle</button></div><div id="cemeteryList" class="cemetery-list"></div></div>`);
  renderList(); elements.dialogBody.querySelector("#cemeteryAdd").hidden = !hasManage(); elements.dialogBody.querySelector("#cemeteryAdd").onclick = () => form();
}
function install() {
  const button = ensureButton(); if (!button || button.dataset.cemeteryUiInstalled) return;
  button.dataset.cemeteryUiInstalled = "true"; button.addEventListener("click", openManager);
  window.RegionConsoleCemeteries = { open: openManager, reload: () => { loaded = false; return load(); } };
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
