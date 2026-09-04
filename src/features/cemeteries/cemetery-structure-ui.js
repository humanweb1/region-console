import { store } from "../../state/store.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";
import { can, canManageInScope } from "../../services/rbac.js";
import { listSections, createSection, updateSection, archiveSection, listGraves, createGrave, updateGrave, archiveGrave } from "./cemetery-structure-service.js";

const elements = getElements();
let active = null;
let sections = [];
let graves = [];
let mapState = null;
let graveMarkers = null;
let sectionLayer = null;

function access() { return window.RegionConsoleRBAC?.access || null; }
function token() { return store.get().auth.session?.access_token || null; }
function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function scopeForCemetery() {
  const region = (store.get().regions?.custom || []).find((r) => String(r?.id) === String(active?.region_id));
  const h = region?.hierarchy || {};
  return { countryId: h.countryId || null, provinceId: h.provinceId || null, districtId: h.districtId || null };
}
function canManage() { return can(access(), "cemeteries.manage") && canManageInScope(access(), "cemeteries.manage", scopeForCemetery()); }
function statusLabel(status) { return ({ available: "Müsait", occupied: "Dolu", reserved: "Rezerve", inactive: "Pasif" })[status] || status || "—"; }
function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  const ring = geometry.type === "Polygon" ? geometry.coordinates?.[0] : geometry.type === "MultiPolygon" ? geometry.coordinates?.[0]?.[0] : [];
  return Array.isArray(ring) ? ring.map(([lng, lat]) => [Number(lat), Number(lng)]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)) : [];
}
function renderMap() {
  if (!mapState?.map || !window.L) return;
  if (!sectionLayer) sectionLayer = window.L.featureGroup().addTo(mapState.map);
  if (!graveMarkers) graveMarkers = window.L.featureGroup().addTo(mapState.map);
  sectionLayer.clearLayers(); graveMarkers.clearLayers();
  sections.forEach((item) => {
    const points = geometryToLatLngs(item.geometry);
    if (points.length < 3) return;
    const polygon = window.L.polygon(points, { color: "#0ea5e9", weight: 2, fillOpacity: 0.08 });
    polygon.bindTooltip(item.name || "Bölüm");
    sectionLayer.addLayer(polygon);
  });
  graves.forEach((item) => {
    if (!Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) return;
    const marker = window.L.marker([Number(item.latitude), Number(item.longitude)], { title: item.label || "Mezar" });
    marker.bindTooltip(`${item.label || "Mezar"} · ${statusLabel(item.status)}`);
    graveMarkers.addLayer(marker);
  });
}
function ensureMap() { mapState = window.__regionConsoleMapState || null; renderMap(); }

async function reload() {
  if (!active || !token()) return;
  try {
    [sections, graves] = await Promise.all([listSections(token(), active.id), listGraves(token(), active.id)]);
    sections = Array.isArray(sections) ? sections : [];
    graves = Array.isArray(graves) ? graves : [];
    render(); renderMap();
  } catch (error) { toast(elements, error.message); }
}

function render() {
  const body = elements.dialogBody.querySelector("#cemeteryStructure");
  if (!body) return;
  body.innerHTML = `<div class="cemetery-structure"><div class="cemetery-structure-head"><div><strong>${esc(active?.name)}</strong><small>${sections.length} bölüm · ${graves.length} mezar</small></div><div class="dialog-actions"><button id="sectionAdd" class="button" type="button">+ Bölüm</button><button id="graveAdd" class="button button-primary" type="button">+ Mezar</button></div></div><div class="cemetery-structure-grid"><section><h3>Bölümler</h3><div class="cemetery-list">${sections.length ? sections.map((s) => `<div class="cemetery-row"><strong>${esc(s.name)}</strong><span>${s.geometry ? "Harita mevcut" : "Sınır bekliyor"}</span><small><button type="button" data-section-edit="${esc(s.id)}">Düzenle</button> <button type="button" data-section-delete="${esc(s.id)}">Sil</button></small></div>`).join("") : `<div class="dialog-muted">Henüz bölüm yok.</div>`}</div></section><section><h3>Mezarlar</h3><div class="cemetery-list">${graves.length ? graves.map((g) => `<div class="cemetery-row"><strong>${esc(g.label)}</strong><span>${esc(statusLabel(g.status))}</span><small>${g.latitude != null && g.longitude != null ? `${Number(g.latitude).toFixed(6)}, ${Number(g.longitude).toFixed(6)}` : "Konum bekliyor"} · <button type="button" data-grave-edit="${esc(g.id)}">Düzenle</button> <button type="button" data-grave-delete="${esc(g.id)}">Sil</button></small></div>`).join("") : `<div class="dialog-muted">Henüz mezar yok.</div>`}</div></section></div></div>`;
  const sectionAdd = body.querySelector("#sectionAdd"); const graveAdd = body.querySelector("#graveAdd");
  sectionAdd.hidden = !canManage(); graveAdd.hidden = !canManage();
  sectionAdd.onclick = () => sectionForm(); graveAdd.onclick = () => graveForm();
  body.querySelectorAll("[data-section-edit]").forEach((b) => b.onclick = () => sectionForm(sections.find((s) => String(s.id) === String(b.dataset.sectionEdit))));
  body.querySelectorAll("[data-section-delete]").forEach((b) => b.onclick = async () => { if (!canManage()) return; try { await archiveSection(token(), b.dataset.sectionDelete); await reload(); } catch (e) { toast(elements, e.message); } });
  body.querySelectorAll("[data-grave-edit]").forEach((b) => b.onclick = () => graveForm(graves.find((g) => String(g.id) === String(b.dataset.graveEdit))));
  body.querySelectorAll("[data-grave-delete]").forEach((b) => b.onclick = async () => { if (!canManage()) return; try { await archiveGrave(token(), b.dataset.graveDelete); await reload(); } catch (e) { toast(elements, e.message); } });
}

function sectionForm(item = null) {
  openDialog(elements, item ? "Bölümü düzenle" : "Bölüm ekle", `<form id="sectionForm" class="dialog-form"><label>Bölüm adı<input id="sectionName" required maxlength="160" value="${esc(item?.name || "")}"></label><label>Kod<input id="sectionCode" maxlength="80" value="${esc(item?.code || "")}"></label><p class="dialog-muted">Bölüm sınırı bir sonraki adımda harita üzerinden çizilecektir.</p><div class="dialog-actions"><button id="sectionCancel" type="button" class="button">Vazgeç</button><button class="button button-primary">${item ? "Güncelle" : "Oluştur"}</button></div></form>`);
  elements.dialogBody.querySelector("#sectionCancel").onclick = () => openStructure();
  elements.dialogBody.querySelector("#sectionForm").onsubmit = async (event) => { event.preventDefault(); try { const payload = { name: elements.dialogBody.querySelector("#sectionName").value.trim(), code: elements.dialogBody.querySelector("#sectionCode").value.trim() || null }; if (!payload.name) return; if (item) await updateSection(token(), item.id, payload); else await createSection(token(), { ...payload, cemeteryId: active.id }); await openStructure(); } catch (e) { toast(elements, e.message); } };
}

function graveForm(item = null) {
  const sectionOptions = `<option value="">Bölümsüz</option>${sections.map((s) => `<option value="${esc(s.id)}" ${String(s.id) === String(item?.section_id) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}`;
  openDialog(elements, item ? "Mezarı düzenle" : "Mezar ekle", `<form id="graveForm" class="dialog-form"><label>Etiket<input id="graveLabel" required maxlength="160" value="${esc(item?.label || "")}"></label><label>Kod<input id="graveCode" maxlength="80" value="${esc(item?.code || "")}"></label><label>Bölüm<select id="graveSection">${sectionOptions}</select></label><label>Durum<select id="graveStatus"><option value="available">Müsait</option><option value="occupied">Dolu</option><option value="reserved">Rezerve</option><option value="inactive">Pasif</option></select></label><div class="grave-coordinates"><label>Enlem<input id="graveLat" type="number" step="any" value="${esc(item?.latitude ?? "")}"></label><label>Boylam<input id="graveLng" type="number" step="any" value="${esc(item?.longitude ?? "")}"></label></div><p class="dialog-muted">Koordinatları haritada seçme desteği sonraki adımda eklenecek.</p><div class="dialog-actions"><button id="graveCancel" type="button" class="button">Vazgeç</button><button class="button button-primary">${item ? "Güncelle" : "Oluştur"}</button></div></form>`);
  elements.dialogBody.querySelector("#graveStatus").value = item?.status || "available";
  elements.dialogBody.querySelector("#graveCancel").onclick = () => openStructure();
  elements.dialogBody.querySelector("#graveForm").onsubmit = async (event) => { event.preventDefault(); try { const lat = elements.dialogBody.querySelector("#graveLat").value; const lng = elements.dialogBody.querySelector("#graveLng").value; const payload = { label: elements.dialogBody.querySelector("#graveLabel").value.trim(), code: elements.dialogBody.querySelector("#graveCode").value.trim() || null, sectionId: elements.dialogBody.querySelector("#graveSection").value || null, status: elements.dialogBody.querySelector("#graveStatus").value, latitude: lat === "" ? null : Number(lat), longitude: lng === "" ? null : Number(lng) }; if (!payload.label) return; if (item) await updateGrave(token(), item.id, payload); else await createGrave(token(), { ...payload, cemeteryId: active.id }); await openStructure(); } catch (e) { toast(elements, e.message); } };
}

async function openStructure() {
  openDialog(elements, "Mezarlık haritası · veri yönetimi", `<div id="cemeteryStructure"><div class="dialog-muted">Yükleniyor…</div></div>`);
  ensureMap(); await reload();
}

export function openCemeteryStructure(cemetery) { active = cemetery; openStructure(); }
window.RegionConsoleCemeteryStructure = { open: openCemeteryStructure, attachMap: ensureMap };
