import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { openDialog, closeDialog, getElements, toast } from "../../components/shell.js";
import { renderRegionsOnMap } from "../map/map.js";

const elements = getElements();
let selected = null;
let editing = false;
let editLayer = null;
let editMarkers = [];
let editMidMarkers = [];
let editParts = [];
let draftName = "";

const SERVICE_CLOSE_REASONS = [
  "Teknik arıza",
  "Altyapı / bakım çalışması",
  "Personel yetersizliği",
  "Güvenlik nedeniyle",
  "Hava koşulları",
  "Yoğunluk / kapasite doluluğu",
  "Geçici operasyonel neden",
  "Diğer"
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function activeCampaigns() {
  return (store.get().campaigns || []).filter((campaign) => {
    const status = String(campaign.status || "active").toLocaleLowerCase("tr-TR");
    return !["pasif", "inactive", "closed", "tamamlandı", "completed"].includes(status);
  });
}

function isService(region) {
  return region?.status !== "outside" && region?.status !== "closed";
}

function isCampaign(region) { return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId); }

function getRegion() {
  if (!selected?.region?.id) return null;
  return (store.get().regions.custom || []).find((item) => String(item.id) === String(selected.region.id)) || null;
}

async function saveCloud() {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  const snapshot = store.dataSnapshot();
  try {
    const saved = await saveState(session.access_token, {
      ...snapshot.regions,
      campaigns: snapshot.campaigns,
      history: store.get().history.entries,
      importedFiles: snapshot.importedFiles,
      mapSettings: snapshot.mapSettings
    });
    store.update("cloud", { status: "ready", version: saved?.version || Date.now(), updatedAt: saved?.updated_at || new Date().toISOString(), error: null });
  } catch (error) {
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Bölge kaydedilemedi: ${error.message}`);
  }
}

function refreshMap() {
  if (!selected?.mapState) return;
  renderRegionsOnMap(selected.mapState, store.get().regions.custom);
}

function commitRegion(label, updater) {
  const before = store.dataSnapshot();
  updater();
  const after = store.dataSnapshot();
  store.recordHistory(label, before, after);
  refreshMap();
  renderPanel();
  saveCloud();
}

function deleteSelectedRegion() {
  const region = getRegion();
  if (!region) return;
  const name = region.name || "Bölge";
  if (!window.confirm(`“${name}” alanı silinsin mi? Bu işlem geri alınabilir.`)) return;

  commitRegion("Bölge silindi", () => {
    const current = getRegion();
    if (!current) return;
    store.update("regions", {
      custom: store.get().regions.custom.filter((item) => String(item.id) !== String(current.id)),
      selectedId: null
    });
  });

  selected = null;
  draftName = "";
  stopBoundaryEdit();
  document.getElementById("regionActionPanel")?.remove();
  toast(elements, "Bölge silindi.");
}

function showServiceDialog() {
  const region = getRegion();
  if (!region) return;

  const currentReason = String(region.serviceCloseReason || "");
  const options = SERVICE_CLOSE_REASONS.map((reason) => `<option value="${escapeHtml(reason)}" ${reason === currentReason ? "selected" : ""}>${escapeHtml(reason)}</option>`).join("");
  const customReason = currentReason && !SERVICE_CLOSE_REASONS.includes(currentReason) ? currentReason : "";

  openDialog(elements, "Hizmete kapat", `<div class="region-dialog">
    <p><strong>${escapeHtml(region.name || "Bölge")}</strong> hizmete kapatılacak.</p>
    <label>Hizmete kapatma sebebi
      <select id="serviceCloseReason" required>
        <option value="">Sebep seçin...</option>
        ${options}
      </select>
    </label>
    <label id="serviceCloseCustomWrap" style="display:${customReason || currentReason === "Diğer" ? "grid" : "none"}">Açıklama
      <textarea id="serviceCloseCustomReason" rows="3" placeholder="Sebebi açıklayın...">${escapeHtml(customReason)}</textarea>
    </label>
    <div class="dialog-actions"><button id="serviceCloseCancel" class="button" type="button">Vazgeç</button><button id="serviceCloseConfirm" class="button button-primary" type="button">Hizmete kapat</button></div>
  </div>`);

  const reasonSelect = elements.dialogBody.querySelector("#serviceCloseReason");
  const customWrap = elements.dialogBody.querySelector("#serviceCloseCustomWrap");
  const customInput = elements.dialogBody.querySelector("#serviceCloseCustomReason");

  reasonSelect.addEventListener("change", () => {
    const isOther = reasonSelect.value === "Diğer";
    customWrap.style.display = isOther ? "grid" : "none";
    if (!isOther) customInput.value = "";
  });

  elements.dialogBody.querySelector("#serviceCloseCancel").addEventListener("click", () => closeDialog(elements));
  elements.dialogBody.querySelector("#serviceCloseConfirm").addEventListener("click", () => {
    const selectedReason = reasonSelect.value.trim();
    if (!selectedReason) return toast(elements, "Lütfen hizmete kapatma sebebi seçin.");

    const custom = customInput.value.trim();
    if (selectedReason === "Diğer" && !custom) return toast(elements, "Lütfen diğer sebebi açıklayın.");

    const reason = selectedReason === "Diğer" ? `Diğer: ${custom}` : selectedReason;

    commitRegion("Bölge hizmete kapatıldı", () => {
      const current = getRegion();
      if (!current) return;
      const next = {
        ...current,
        status: "closed",
        serviceCloseReason: reason,
        serviceClosedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.update("regions", { custom: store.get().regions.custom.map((item) => item.id === current.id ? next : item) });
    });
    closeDialog(elements);
    toast(elements, "Bölge hizmete kapatıldı.");
  });
}

function showCampaignDialog() {
  const region = getRegion();
  if (!region) return;
  const campaigns = activeCampaigns();
  const currentCampaignId = region.campaignId || "";
  openDialog(elements, "Kampanya", `<div class="region-dialog"><p><strong>${escapeHtml(region.name || "Bölge")}</strong> için kampanya durumu.</p>${isCampaign(region) && currentCampaignId ? `<div class="campaign-active-info"><strong>Aktif kampanya</strong><span>${escapeHtml(campaigns.find((item) => String(item.id) === String(currentCampaignId))?.name || "Tanımsız kampanya")}</span></div>` : `<p class="dialog-muted">Bu bölgede aktif kampanya yok.</p>`}<label>Kampanya seç<select id="regionCampaignSelect"><option value="">Kampanyasız</option>${campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}" ${String(campaign.id) === String(currentCampaignId) ? "selected" : ""}>${escapeHtml(campaign.name)}</option>`).join("")}</select></label><div class="dialog-actions"><button id="campaignCancel" class="button" type="button">Vazgeç</button><button id="campaignSave" class="button button-primary" type="button">Uygula</button></div></div>`);
  elements.dialogBody.querySelector("#campaignCancel").addEventListener("click", () => closeDialog(elements));
  elements.dialogBody.querySelector("#campaignSave").addEventListener("click", () => {
    const campaignId = elements.dialogBody.querySelector("#regionCampaignSelect").value;
    commitRegion(campaignId ? "Bölge kampanyaya bağlandı" : "Bölge kampanyadan çıkarıldı", () => {
      const current = getRegion();
      if (!current) return;
      const next = { ...current, status: campaignId ? "campaign" : (current.status === "campaign" ? "service" : current.status), campaignId: campaignId || null, campaign: Boolean(campaignId), updatedAt: new Date().toISOString() };
      store.update("regions", { custom: store.get().regions.custom.map((item) => item.id === current.id ? next : item) });
    });
    closeDialog(elements);
    toast(elements, campaignId ? "Kampanya bölgeye uygulandı." : "Bölge kampanyadan çıkarıldı.");
  });
}

function geometryToLatLngs(geometry) {
  if (geometry?.type !== "Polygon") return [];
  const ring = (geometry.coordinates?.[0] || []).map(([lng, lat]) => L.latLng(lat, lng));
  if (ring.length > 1 && ring[0].equals(ring[ring.length - 1])) ring.pop();
  return ring;
}

function geometryToEditParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometryToLatLngs(geometry)].filter((points) => points.length >= 3);
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => geometryToLatLngs({ type: "Polygon", coordinates: polygon }))
      .filter((points) => points.length >= 3);
  }
  return [];
}

function ringToCoordinates(points) {
  const coordinates = points.map((point) => [point.lng, point.lat]);
  if (coordinates.length && (coordinates[0][0] !== coordinates.at(-1)[0] || coordinates[0][1] !== coordinates.at(-1)[1])) coordinates.push([...coordinates[0]]);
  return coordinates;
}

function latLngsToGeometry(latLngs) {
  return { type: "Polygon", coordinates: [ringToCoordinates(latLngs)] };
}

function editPartsToGeometry(parts, originalGeometry) {
  const polygons = parts.map((part) => [ringToCoordinates(part.markers.map((marker) => marker.getLatLng()))]);
  if (originalGeometry?.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: polygons };
  return { type: "Polygon", coordinates: polygons[0] || [[]] };
}

function clearEditMarkers() {
  editMarkers.forEach((marker) => marker.remove());
  editMidMarkers.forEach((marker) => marker.remove());
  editParts.forEach((part) => {
    part.markers?.forEach((marker) => marker.remove());
    part.midMarkers?.forEach((marker) => marker.remove());
    part.layer?.remove();
  });
  editMarkers = [];
  editMidMarkers = [];
  editParts = [];
}

function syncEditLayer() {
  if (editParts.length) {
    editParts.forEach((part) => part.layer.setLatLngs(part.markers.map((marker) => marker.getLatLng())));
    return;
  }
  if (!editLayer) return;
  editLayer.setLatLngs(editMarkers.map((marker) => marker.getLatLng()));
}

function vertexIcon(index) {
  return L.divIcon({
    className: "boundary-vertex-marker-wrap",
    html: `<span class="boundary-vertex-marker" title="Nokta ${index + 1}">${index + 1}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function midpointIcon() {
  return L.divIcon({
    className: "boundary-midpoint-marker-wrap",
    html: `<span class="boundary-midpoint-marker" title="Araya nokta ekle">+</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function rebuildPartMidMarkers(part) {
  part.midMarkers.forEach((marker) => marker.remove());
  part.midMarkers = [];
  const map = selected?.mapState?.map;
  const points = part.markers.map((marker) => marker.getLatLng());
  if (!map || points.length < 3) return;

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const midpoint = L.latLng((point.lat + next.lat) / 2, (point.lng + next.lng) / 2);
    const marker = L.marker(midpoint, { draggable: false, keyboard: false, zIndexOffset: 1100, icon: midpointIcon() }).addTo(map);
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      const nextPoints = part.markers.map((item) => item.getLatLng());
      nextPoints.splice(index + 1, 0, marker.getLatLng());
      rebuildPartMarkers(part, nextPoints);
    });
    part.midMarkers.push(marker);
  });
}

function rebuildPartMarkers(part, points) {
  part.markers.forEach((marker) => marker.remove());
  part.midMarkers.forEach((marker) => marker.remove());
  part.markers = [];
  part.midMarkers = [];
  const map = selected?.mapState?.map;
  if (!map || points.length < 3) return;

  points.forEach((point, index) => {
    const marker = L.marker(point, { draggable: true, autoPan: true, keyboard: false, zIndexOffset: 1200, icon: vertexIcon(index) }).addTo(map);
    marker.on("dragstart", () => rebuildPartMidMarkers(part));
    marker.on("drag", syncEditLayer);
    marker.on("dragend", () => { syncEditLayer(); rebuildPartMidMarkers(part); });
    marker.on("dblclick", (event) => {
      L.DomEvent.stopPropagation(event);
      const currentPoints = part.markers.map((item) => item.getLatLng());
      if (currentPoints.length <= 3) return toast(elements, "Sınır için en az 3 nokta gerekir.");
      currentPoints.splice(index, 1);
      rebuildPartMarkers(part, currentPoints);
      syncEditLayer();
    });
    part.markers.push(marker);
  });
  rebuildPartMidMarkers(part);
}

function rebuildMultiPartEditor(parts) {
  clearEditMarkers();
  const map = selected?.mapState?.map;
  if (!map) return;
  parts.forEach((points) => {
    if (points.length < 3) return;
    const part = {
      layer: L.polygon(points, { color: "#ff7a00", weight: 3, dashArray: "5 5", fillOpacity: 0.08, interactive: false }).addTo(map),
      markers: [],
      midMarkers: []
    };
    editParts.push(part);
    rebuildPartMarkers(part, points);
  });
}

function rebuildMidMarkers() {
  editMidMarkers.forEach((marker) => marker.remove());
  editMidMarkers = [];
  const map = selected?.mapState?.map;
  const currentPoints = editMarkers.map((marker) => marker.getLatLng());
  if (!map || currentPoints.length < 3) return;
  currentPoints.forEach((point, index) => {
    const next = currentPoints[(index + 1) % currentPoints.length];
    const midpoint = L.latLng((point.lat + next.lat) / 2, (point.lng + next.lng) / 2);
    const marker = L.marker(midpoint, { draggable: false, keyboard: false, zIndexOffset: 1100, icon: midpointIcon() }).addTo(map);
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      const nextPoints = editMarkers.map((item) => item.getLatLng());
      nextPoints.splice(index + 1, 0, marker.getLatLng());
      editLayer.setLatLngs(nextPoints);
      rebuildEditMarkers(nextPoints);
    });
    editMidMarkers.push(marker);
  });
}

function rebuildEditMarkers(points) {
  clearEditMarkers();
  const map = selected?.mapState?.map;
  if (!map || points.length < 3) return;
  points.forEach((point, index) => {
    const marker = L.marker(point, { draggable: true, autoPan: true, keyboard: false, zIndexOffset: 1200, icon: vertexIcon(index) }).addTo(map);
    marker.on("dragstart", () => { editMidMarkers.forEach((midpoint) => midpoint.remove()); editMidMarkers = []; });
    marker.on("drag", syncEditLayer);
    marker.on("dragend", () => { syncEditLayer(); rebuildEditMarkers(editMarkers.map((item) => item.getLatLng())); });
    marker.on("dblclick", (event) => {
      L.DomEvent.stopPropagation(event);
      const currentIndex = editMarkers.indexOf(marker);
      if (currentIndex < 0) return;
      const currentPoints = editMarkers.map((item) => item.getLatLng());
      if (currentPoints.length <= 3) return toast(elements, "Sınır için en az 3 nokta gerekir.");
      currentPoints.splice(currentIndex, 1);
      editLayer.setLatLngs(currentPoints);
      rebuildEditMarkers(currentPoints);
    });
    editMarkers.push(marker);
  });
  rebuildMidMarkers();
}

function renderEditHandles() {
  const region = getRegion();
  if (!region) return;
  if (region.geometry?.type === "MultiPolygon") {
    const parts = geometryToEditParts(region.geometry);
    rebuildMultiPartEditor(parts);
    return;
  }
  if (!editLayer) return;
  rebuildEditMarkers(editLayer.getLatLngs()[0] || []);
}

function stopBoundaryEdit() {
  clearEditMarkers();
  if (editLayer) editLayer.remove();
  editLayer = null;
  editing = false;
}

function startBoundaryEdit() {
  const region = getRegion();
  if (!region || !["Polygon", "MultiPolygon"].includes(region.geometry?.type)) return toast(elements, "Bu bölgenin düzenlenebilir bir Polygon veya MultiPolygon sınırı yok.");
  stopBoundaryEdit();
  editing = true;
  const parts = geometryToEditParts(region.geometry);
  if (!parts.length || parts.some((points) => points.length < 3)) return toast(elements, "Bu bölgenin düzenlenebilir en az 3 sınır noktası yok.");

  if (region.geometry.type === "MultiPolygon") {
    rebuildMultiPartEditor(parts);
  } else {
    const latLngs = parts[0];
    editLayer = L.polygon(latLngs, { color: "#ff7a00", weight: 3, dashArray: "5 5", fillOpacity: 0.08, interactive: false }).addTo(selected.mapState.polygons);
    renderEditHandles();
  }
  renderPanel();
}

function savePanelChanges() {
  const region = getRegion();
  if (!region) return;
  const name = String(document.getElementById("regionNameInput")?.value || "").trim();
  if (!name) return toast(elements, "Bölge adı boş bırakılamaz.");

  let geometry = region.geometry;
  if (editing) {
    if (region.geometry.type === "MultiPolygon") {
      if (!editParts.length || editParts.some((part) => part.markers.length < 3)) return toast(elements, "Her sınır parçası için en az 3 nokta gerekir.");
      geometry = editPartsToGeometry(editParts, region.geometry);
    } else {
      geometry = latLngsToGeometry(editMarkers.map((marker) => marker.getLatLng()));
      if (geometry.coordinates[0].length < 4) return toast(elements, "Geçerli bir sınır için en az 3 nokta gerekir.");
    }
  }

  const nameChanged = name !== region.name;
  const geometryChanged = editing;
  if (!nameChanged && !geometryChanged) return toast(elements, "Kaydedilecek bir değişiklik yok.");
  commitRegion(geometryChanged ? "Bölge düzenlendi" : "Bölge adı düzenlendi", () => {
    const current = getRegion();
    const next = { ...current, name, ...(geometryChanged ? { geometry } : {}), updatedAt: new Date().toISOString() };
    store.update("regions", { custom: store.get().regions.custom.map((item) => item.id === current.id ? next : item) });
  });
  stopBoundaryEdit();
  draftName = name;
  toast(elements, "Bölge değişiklikleri kaydedildi.");
}

function cancelPanelChanges() {
  draftName = getRegion()?.name || "";
  stopBoundaryEdit();
  renderPanel();
  toast(elements, "Değişiklikler iptal edildi.");
}

function renderPanel() {
  let panel = document.getElementById("regionActionPanel");
  const region = getRegion();
  if (!region) return panel?.remove();
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "regionActionPanel";
    panel.className = "region-action-panel";
    document.querySelector(".map-stage")?.appendChild(panel);
  }
  const campaigns = activeCampaigns();
  const campaign = campaigns.find((item) => String(item.id) === String(region.campaignId));
  panel.innerHTML = `<div class="region-action-head"><input id="regionNameInput" class="region-name-input" value="${escapeHtml(draftName || region.name || "Bölge")}" aria-label="Bölge adı"><button id="regionPanelClose" class="icon-button region-panel-close" type="button" aria-label="Kapat">×</button></div>${campaign ? `<div class="region-campaign-badge">${escapeHtml(campaign.name)}</div>` : ""}<div class="region-action-buttons">${isService(region) ? `<button id="regionServiceButton" class="button region-action-danger" type="button">Hizmete kapat</button>` : `<button id="regionServiceButton" class="button button-primary" type="button">Hizmete aç</button>`}<button id="regionCampaignButton" class="button" type="button">Kampanya</button><button id="regionBoundaryButton" class="button" type="button">${editing ? "Sınır düzenleniyor" : "Sınırları düzenle"}</button></div><div class="region-panel-footer"><button id="regionDeleteButton" class="button region-action-danger" type="button">Alanı sil</button><button id="regionCancelButton" class="button" type="button">İptal</button><button id="regionSaveButton" class="button button-primary" type="button">Kaydet</button></div>`;

  panel.querySelector("#regionPanelClose").addEventListener("click", () => { stopBoundaryEdit(); selected = null; panel.remove(); });
  panel.querySelector("#regionServiceButton").addEventListener("click", () => {
    if (region.status === "outside" || region.status === "closed") {
      commitRegion("Bölge hizmete açıldı", () => {
        const current = getRegion();
        if (!current) return;
        const next = { ...current, status: "service", serviceCloseReason: null, serviceClosedAt: null, updatedAt: new Date().toISOString() };
        store.update("regions", { custom: store.get().regions.custom.map((item) => item.id === current.id ? next : item) });
      });
      toast(elements, "Bölge yeniden hizmete açıldı.");
    } else {
      showServiceDialog();
    }
  });
  panel.querySelector("#regionCampaignButton").addEventListener("click", showCampaignDialog);
  panel.querySelector("#regionBoundaryButton").addEventListener("click", () => editing ? stopBoundaryEdit() || renderPanel() : startBoundaryEdit());
  panel.querySelector("#regionDeleteButton").addEventListener("click", deleteSelectedRegion);
  panel.querySelector("#regionCancelButton").addEventListener("click", cancelPanelChanges);
  panel.querySelector("#regionSaveButton").addEventListener("click", savePanelChanges);
}

export function openRegionActions(region, mapState) {
  selected = { region, mapState };
  draftName = region?.name || "";
  stopBoundaryEdit();
  renderPanel();
}

export function closeRegionActions() {
  stopBoundaryEdit();
  selected = null;
  document.getElementById("regionActionPanel")?.remove();
}
