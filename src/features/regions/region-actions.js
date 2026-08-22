import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { openDialog, closeDialog, getElements, toast } from "../../components/shell.js";

const elements = getElements();
let selected = null;
let editing = false;
let editLayer = null;
let editMarkers = [];
let draftName = "";

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function activeCampaigns() {
  return (store.get().campaigns || []).filter((campaign) => {
    const status = String(campaign.status || "active").toLocaleLowerCase("tr-TR");
    return !["pasif", "inactive", "closed", "tamamlandı", "completed"].includes(status);
  });
}

function isService(region) { return region?.status !== "outside"; }
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

function commitRegion(label, updater) {
  const before = store.dataSnapshot();
  updater();
  const after = store.dataSnapshot();
  store.recordHistory(label, before, after);
  renderPanel();
  saveCloud();
}

function showServiceDialog() {
  const region = getRegion();
  if (!region) return;
  openDialog(elements, "Hizmete kapat", `<div class="region-dialog"><p><strong>${escapeHtml(region.name || "Bölge")}</strong> hizmet dışına alınacak.</p><label>Hizmete kapatma sebebi<textarea id="serviceCloseReason" rows="4" placeholder="Sebebi girin..." required></textarea></label><div class="dialog-actions"><button id="serviceCloseCancel" class="button" type="button">Vazgeç</button><button id="serviceCloseConfirm" class="button button-primary" type="button">Hizmete kapat</button></div></div>`);
  elements.dialogBody.querySelector("#serviceCloseCancel").addEventListener("click", () => closeDialog(elements));
  elements.dialogBody.querySelector("#serviceCloseConfirm").addEventListener("click", () => {
    const reason = elements.dialogBody.querySelector("#serviceCloseReason").value.trim();
    if (!reason) return toast(elements, "Lütfen hizmete kapatma sebebini girin.");
    commitRegion("Bölge hizmete kapatıldı", () => {
      const current = getRegion();
      if (!current) return;
      const next = { ...current, status: "outside", serviceCloseReason: reason, serviceClosedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  return (geometry.coordinates?.[0] || []).map(([lng, lat]) => L.latLng(lat, lng));
}

function latLngsToGeometry(latLngs) {
  const coordinates = latLngs.map((point) => [point.lng, point.lat]);
  if (coordinates.length && (coordinates[0][0] !== coordinates.at(-1)[0] || coordinates[0][1] !== coordinates.at(-1)[1])) coordinates.push([...coordinates[0]]);
  return { type: "Polygon", coordinates: [coordinates] };
}

function clearEditMarkers() {
  editMarkers.forEach((marker) => marker.remove());
  editMarkers = [];
}

function stopBoundaryEdit() {
  clearEditMarkers();
  if (editLayer) editLayer.remove();
  editLayer = null;
  editing = false;
}

function startBoundaryEdit() {
  const region = getRegion();
  if (!region || region.geometry?.type !== "Polygon") return toast(elements, "Şu anda yalnızca Polygon sınırları düzenlenebilir.");
  stopBoundaryEdit();
  editing = true;
  const latLngs = geometryToLatLngs(region.geometry);
  editLayer = L.polygon(latLngs, { color: "#ff7a00", weight: 3, dashArray: "5 5", fillOpacity: 0.08, interactive: false }).addTo(selected.mapState.polygons);
  editMarkers = latLngs.map((point) => {
    const marker = L.circleMarker(point, { radius: 6, color: "#ff7a00", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }).addTo(selected.mapState.map);
    marker.on("mousedown", () => {
      const move = (event) => {
        marker.setLatLng(event.latlng);
        editLayer.setLatLngs(editMarkers.map((item) => item.getLatLng()));
      };
      const up = () => {
        selected.mapState.map.off("mousemove", move);
        selected.mapState.map.off("mouseup", up);
      };
      selected.mapState.map.on("mousemove", move);
      selected.mapState.map.on("mouseup", up);
    });
    return marker;
  });
  renderPanel();
}

function savePanelChanges() {
  const region = getRegion();
  if (!region) return;
  const name = String(document.getElementById("regionNameInput")?.value || "").trim();
  if (!name) return toast(elements, "Bölge adı boş bırakılamaz.");
  const geometry = editing ? latLngsToGeometry(editMarkers.map((marker) => marker.getLatLng())) : region.geometry;
  if (editing && geometry.coordinates[0].length < 4) return toast(elements, "Geçerli bir sınır için en az 3 nokta gerekir.");
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
  panel.innerHTML = `<div class="region-action-head"><input id="regionNameInput" class="region-name-input" value="${escapeHtml(draftName || region.name || "Bölge")}" aria-label="Bölge adı"><button id="regionPanelClose" class="icon-button region-panel-close" type="button" aria-label="Kapat">×</button></div>${campaign ? `<div class="region-campaign-badge">${escapeHtml(campaign.name)}</div>` : ""}<div class="region-action-buttons">${isService(region) ? `<button id="regionServiceButton" class="button region-action-danger" type="button">Hizmete kapat</button>` : `<button id="regionServiceButton" class="button button-primary" type="button">Hizmete aç</button>`}<button id="regionCampaignButton" class="button" type="button">Kampanya</button><button id="regionBoundaryButton" class="button" type="button">${editing ? "Sınır düzenleniyor" : "Sınırları düzenle"}</button></div><div class="region-panel-footer"><button id="regionCancelButton" class="button" type="button">Vazgeç</button><button id="regionSaveButton" class="button button-primary" type="button">Kaydet</button></div>`;
  panel.querySelector("#regionNameInput").addEventListener("input", (event) => { draftName = event.target.value; });
  panel.querySelector("#regionPanelClose").addEventListener("click", () => { cancelPanelChanges(); selected = null; panel.remove(); store.update("regions", { selectedId: null }); });
  panel.querySelector("#regionServiceButton").addEventListener("click", () => {
    if (isService(getRegion())) return showServiceDialog();
    commitRegion("Bölge hizmete açıldı", () => {
      const current = getRegion();
      if (!current) return;
      const next = { ...current, status: current.campaignId ? "campaign" : "service", serviceCloseReason: null, updatedAt: new Date().toISOString() };
      store.update("regions", { custom: store.get().regions.custom.map((item) => item.id === current.id ? next : item) });
    });
    toast(elements, "Bölge yeniden hizmete açıldı.");
  });
  panel.querySelector("#regionCampaignButton").addEventListener("click", showCampaignDialog);
  panel.querySelector("#regionBoundaryButton").addEventListener("click", () => { if (!editing) startBoundaryEdit(); });
  panel.querySelector("#regionCancelButton").addEventListener("click", cancelPanelChanges);
  panel.querySelector("#regionSaveButton").addEventListener("click", savePanelChanges);
}

function onRegionSelected(event) {
  if (editing) stopBoundaryEdit();
  selected = event.detail;
  draftName = selected.region.name || "";
  renderPanel();
}

document.addEventListener("region-console:region-selected", onRegionSelected);

store.subscribe(() => {
  if (!selected) return;
  const region = getRegion();
  if (!region) {
    selected = null;
    document.getElementById("regionActionPanel")?.remove();
    return;
  }
  if (!editing) renderPanel();
});
