import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";

const TYPE_LABELS = { country: "Ülke", province: "İl", district: "İlçe", neighborhood: "Mahalle", cemetery: "Mezarlık", independent: "Bağımsız Bölge" };

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function normalize(value) { return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c"); }
function typeOf(region) { return region?.hierarchy?.type || region?.type || "independent"; }
function candidates() {
  const state = store.get();
  const custom = Array.isArray(state.regions?.custom) ? state.regions.custom : [];
  const nested = [];
  const walk = (items) => { for (const item of items || []) { if (!item) continue; nested.push(item); walk(item.provinces); walk(item.districts); walk(item.neighborhoods); walk(item.cemeteries); walk(item.children); } };
  walk(state.regions?.countries || []);
  return [...custom, ...nested];
}
function findParent(region, all) {
  const h = region?.hierarchy || {};
  const parentId = h.parentId == null ? "" : String(h.parentId);
  const parentName = normalize(h.parentName);
  const parentType = h.parentType || "";
  if (!parentId && !parentName) return null;
  return all.find((item) => {
    if (!item || item === region) return false;
    const itemType = typeOf(item);
    if (parentType && itemType && itemType !== parentType) return false;
    const id = String(item.id ?? item.importMeta?.sourceId ?? "");
    return (parentId && id === parentId) || (parentName && normalize(item.name) === parentName);
  }) || null;
}
function hierarchyPath(region, all) {
  const chain = [];
  const visited = new Set();
  let current = region;
  while (current && !visited.has(current)) { visited.add(current); if (current.name) chain.unshift(String(current.name)); current = findParent(current, all); }
  const countryName = region?.hierarchy?.countryName;
  if (countryName && !chain.some((name) => normalize(name) === normalize(countryName))) chain.unshift(String(countryName));
  return chain.join("-");
}
function statusInfo(region) {
  if (region?.status === "closed") return ["Hizmete Kapalı", "closed"];
  if (region?.status === "outside") return ["Hizmet Dışı", "outside"];
  if (region?.status === "campaign" || region?.campaign || region?.campaignId) return ["Kampanyalı", "campaign"];
  return ["Hizmet Verilen", "service"];
}
function activeCampaign(region) { if (!region?.campaignId) return null; return (store.get().campaigns || []).find((campaign) => String(campaign.id) === String(region.campaignId)) || null; }
function infoSignature(region, path) { return [region.id, region.status, region.campaignId || "", region.serviceCloseReason || "", path].join("|"); }
async function persistSnapshot() {
  const session = store.get().auth?.session;
  if (!session?.access_token) return;
  const snapshot = store.dataSnapshot();
  const saved = await saveState(session.access_token, { ...snapshot.regions, campaigns: snapshot.campaigns, history: store.get().history.entries, importedFiles: snapshot.importedFiles, mapSettings: snapshot.mapSettings });
  store.update("cloud", { status: "ready", version: saved?.version || Date.now(), updatedAt: saved?.updated_at || new Date().toISOString(), error: null });
}
function finishCampaign(region) {
  const current = (store.get().regions?.custom || []).find((item) => String(item.id) === String(region.id));
  if (!current?.campaignId) return;
  const before = store.dataSnapshot();
  const next = { ...current, campaignId: null, campaign: false, status: current.status === "campaign" ? "service" : current.status, updatedAt: new Date().toISOString() };
  store.update("regions", { custom: store.get().regions.custom.map((item) => String(item.id) === String(current.id) ? next : item) });
  store.recordHistory("Bölge kampanyası sonlandırıldı", before, store.dataSnapshot());
  window.dispatchEvent(new CustomEvent("region-console:toast", { detail: { message: "Bölge kampanyası sonlandırıldı." } }));
  persistSnapshot().catch((error) => console.error("[Region Console] Campaign termination save failed:", error));
}
function renderInfo(panel, region, path, signature) {
  if (panel.dataset.regionInfoSignature === signature && panel.querySelector(".region-info-block")) return;
  const old = panel.querySelector(".region-info-block");
  if (old) old.remove();
  const [statusLabel, statusClass] = statusInfo(region);
  const campaign = activeCampaign(region);
  const type = typeOf(region);
  const info = document.createElement("div");
  info.className = "region-info-block";
  info.innerHTML = `<div class="region-info-title">Bölge Durumu</div><div class="region-info-grid"><div><span>Durum</span><strong class="region-status-value ${statusClass}">${escapeHtml(statusLabel)}</strong></div><div><span>Bölge Tipi</span><strong>${escapeHtml(TYPE_LABELS[type] || type)}</strong></div><div class="region-info-wide"><span>Hiyerarşi</span><strong>${escapeHtml(path)}</strong></div>${region.status === "closed" && region.serviceCloseReason ? `<div class="region-info-wide"><span>Hizmete Kapalı Nedeni</span><strong>${escapeHtml(region.serviceCloseReason)}</strong></div>` : ""}${campaign ? `<div class="region-info-wide"><span>Aktif Kampanya</span><strong>${escapeHtml(campaign.name)}</strong></div>` : ""}</div>${campaign ? `<button id="regionCampaignEndButton" class="button region-campaign-end-button" type="button">Kampanyayı sonlandır</button>` : ""}`;
  const head = panel.querySelector(".region-action-head");
  head?.after(info);
  panel.dataset.regionInfoSignature = signature;
  info.querySelector("#regionCampaignEndButton")?.addEventListener("click", () => {
    if (!window.confirm(`“${campaign.name}” kampanyası bu bölge için sonlandırılsın mı?`)) return;
    finishCampaign(region);
    const fresh = (store.get().regions?.custom || []).find((item) => String(item.id) === String(region.id));
    if (fresh) { const freshPath = hierarchyPath(fresh, candidates()) || fresh.name || "-"; renderInfo(panel, fresh, freshPath, infoSignature(fresh, freshPath)); }
  });
}
function enhancePanel() {
  const panel = document.getElementById("regionActionPanel");
  if (!panel) return;
  const selectedId = store.get().regions?.selectedId;
  if (selectedId == null) return;
  const region = (store.get().regions?.custom || []).find((item) => String(item.id) === String(selectedId));
  if (!region) return;
  const path = hierarchyPath(region, candidates()) || region.name || "-";
  renderInfo(panel, region, path, infoSignature(region, path));
}
const style = document.createElement("style");
style.textContent = `.region-info-block{margin:10px 0 12px;padding:12px;border:1px solid rgba(148,163,184,.2);border-radius:10px;background:rgba(15,23,42,.42)}.region-info-title{font-weight:700;font-size:13px;margin-bottom:10px}.region-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.region-info-grid>div{display:grid;gap:3px;min-width:0}.region-info-grid span{font-size:11px;opacity:.6}.region-info-grid strong{font-size:12px;overflow-wrap:anywhere}.region-info-wide{grid-column:1/-1}.region-status-value.service{color:#34d399}.region-status-value.closed{color:#a78bfa}.region-status-value.outside{color:#94a3b8}.region-status-value.campaign{color:#facc15}.region-campaign-end-button{width:100%;margin-top:10px}@media(max-width:600px){.region-info-grid{grid-template-columns:1fr}.region-info-wide{grid-column:auto}}`;
document.head.appendChild(style);
const observer = new MutationObserver(enhancePanel);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("region-console:region-selected", enhancePanel);
requestAnimationFrame(enhancePanel);
