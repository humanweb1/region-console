import { store } from "../../state/store.js";
import { openDialog } from "../../components/shell.js";

const GREEN = "#22c55e";
const RED = "#ef4444";
const TOLERANCE = 1e-7;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function regionKey(region) { return String(region?.id ?? region?.importMeta?.sourceId ?? region?.name ?? ""); }
function geometryPoints(geometry) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) { points.push([Number(value[0]), Number(value[1])]); return; }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return points;
}
function samePoint(a,b) { return Boolean(a&&b&&Math.abs(a[0]-b[0])<=TOLERANCE&&Math.abs(a[1]-b[1])<=TOLERANCE); }
function changedPoints(beforeGeometry, afterGeometry) {
  const before=geometryPoints(beforeGeometry), after=geometryPoints(afterGeometry);
  if (JSON.stringify(beforeGeometry)===JSON.stringify(afterGeometry)) return {before:[],after:[]};
  return { before:before.filter(p=>!after.some(c=>samePoint(p,c))), after:after.filter(p=>!before.some(c=>samePoint(p,c))) };
}
function getRegions(snapshot) { return Array.isArray(snapshot?.regions?.custom) ? snapshot.regions.custom : []; }
function buildDiff(beforeSnapshot, afterSnapshot) {
  const beforeRegions=getRegions(beforeSnapshot), afterRegions=getRegions(afterSnapshot);
  const bm=new Map(beforeRegions.map(r=>[regionKey(r),r])), am=new Map(afterRegions.map(r=>[regionKey(r),r]));
  const keys=[...new Set([...bm.keys(),...am.keys()])], changed=[];
  for (const key of keys) {
    const before=bm.get(key)||null, after=am.get(key)||null;
    const geometryChanged=JSON.stringify(before?.geometry||null)!==JSON.stringify(after?.geometry||null);
    const statusChanged=String(before?.status||"service")!==String(after?.status||"service");
    const nameChanged=String(before?.name||"")!==String(after?.name||"");
    if (!geometryChanged&&!statusChanged&&!nameChanged) continue;
    changed.push({key,before,after,geometryChanged,statusChanged,nameChanged,points:changedPoints(before?.geometry,after?.geometry)});
  }
  return changed;
}
function allGeometryLatLngs(regions) { return regions.flatMap(r=>geometryPoints(r?.geometry).map(([lng,lat])=>[lat,lng])); }

function addNumberedPoint(map, layer, lat, lng, number) {
  L.circleMarker([lat,lng], {radius:7,color:RED,weight:2,fillColor:RED,fillOpacity:1,interactive:false}).addTo(layer);
  L.marker([lat,lng], {
    interactive:false,
    icon:L.divIcon({className:"history-pin-number",html:`<span>${number}</span>`,iconSize:[22,22],iconAnchor:[11,11]})
  }).addTo(layer);
}

function renderMap(container, regions, changedEntries, side) {
  const map=L.map(container,{zoomControl:true,attributionControl:true,doubleClickZoom:true});
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(map);
  const boundaryLayer=L.featureGroup().addTo(map), markerLayer=L.featureGroup().addTo(map);
  const changedByKey=new Map(changedEntries.map(e=>[e.key,e])), boundsPoints=[];
  for (const region of regions) {
    const points=geometryPoints(region.geometry); if(points.length<3) continue;
    const latLngs=points.map(([lng,lat])=>[lat,lng]);
    L.polygon(latLngs,{color:GREEN,weight:2,opacity:.95,fill:false,interactive:false}).addTo(boundaryLayer);
    boundsPoints.push(...latLngs);
    const diff=changedByKey.get(regionKey(region));
    const changedSide=diff?.points?.[side]||[];
    changedSide.forEach(([lng,lat],index)=>addNumberedPoint(map,markerLayer,lat,lng,index+1));
  }
  if(boundsPoints.length) map.fitBounds(L.latLngBounds(boundsPoints),{padding:[24,24],maxZoom:12,animate:false}); else map.setView([39,35],5);
  requestAnimationFrame(()=>map.invalidateSize({pan:false}));
  return map;
}
function destroySimulationMaps() {
  document.querySelectorAll(".history-sim-map[data-leaflet-initialized]").forEach(container=>{const map=container._historyMap;if(map)map.remove();delete container._historyMap;container.removeAttribute("data-leaflet-initialized");});
  document.getElementById("appDialog")?.classList.remove("history-sim-dialog");
}
function renderSimulation(elements,entry) {
  destroySimulationMaps();
  const changed=buildDiff(entry.before,entry.after), beforeRegions=getRegions(entry.before), afterRegions=getRegions(entry.after);
  const changedBefore=changed.map(i=>i.before).filter(Boolean), changedAfter=changed.map(i=>i.after).filter(Boolean);
  const changedGeometryCount=changed.filter(i=>i.geometryChanged).length;
  const changedPointCount=changed.reduce((s,i)=>s+i.points.before.length+i.points.after.length,0);
  openDialog(elements,`Harita karşılaştırması · ${entry.label||"Güncelleme"}`,`
    <div class="history-sim">
      <div class="history-sim-toolbar"><button id="historySimBack" class="button" type="button">← Geçmişe dön</button><div class="history-sim-summary"><strong>${escapeHtml(entry.label||"Güncelleme")}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span></div><div class="history-sim-legend"><span><i class="history-sim-dot green"></i> Sınır</span><span><i class="history-sim-dot red"></i> Değişen pin</span></div></div>
      <div class="history-sim-stats"><span>${changed.length} değişen alan</span><span>${changedGeometryCount} sınır güncellemesi</span><span>${changedPointCount} değişen pin</span></div>
      <div class="history-sim-grid"><section class="history-sim-panel"><header><strong>BEFORE</strong><span>Önce</span></header><div id="historySimBefore" class="history-sim-map"></div></section><section class="history-sim-panel"><header><strong>AFTER</strong><span>Sonra</span></header><div id="historySimAfter" class="history-sim-map"></div></section></div>
      ${changed.length?`<div class="history-sim-changes"><strong>Değişen alanlar</strong>${changed.map(i=>`<span>${escapeHtml(i.after?.name||i.before?.name||"Adsız alan")}</span>`).join("")}</div>`:`<p class="dialog-muted">Bu işlemde harita geometrisi değişmemiş.</p>`}
    </div>`);
  elements.appDialog.classList.add("history-sim-dialog");
  document.getElementById("historySimBack")?.addEventListener("click",()=>{destroySimulationMaps();document.querySelector('.tool[data-tool="history"]')?.click();});
  const beforeEl=document.getElementById("historySimBefore"), afterEl=document.getElementById("historySimAfter"); if(!beforeEl||!afterEl)return;
  const beforeMap=renderMap(beforeEl,beforeRegions,changed,"before"), afterMap=renderMap(afterEl,afterRegions,changed,"after");
  beforeEl._historyMap=beforeMap; afterEl._historyMap=afterMap; beforeEl.dataset.leafletInitialized="true"; afterEl.dataset.leafletInitialized="true";
  const combined=[...allGeometryLatLngs(changedBefore),...allGeometryLatLngs(changedAfter)];
  if(combined.length){const b=L.latLngBounds(combined);beforeMap.fitBounds(b,{padding:[24,24],maxZoom:12,animate:false});afterMap.fitBounds(b,{padding:[24,24],maxZoom:12,animate:false});}
  let syncing=false;
  const sync=(source,target)=>{if(syncing)return;syncing=true;target.setView(source.getCenter(),source.getZoom(),{animate:false});syncing=false;};
  beforeMap.on("moveend",()=>sync(beforeMap,afterMap));
  afterMap.on("moveend",()=>sync(afterMap,beforeMap));
  requestAnimationFrame(()=>{beforeMap.invalidateSize({pan:false});afterMap.invalidateSize({pan:false});sync(beforeMap,afterMap);});
}
function historyEntryFromItem(item){const list=item.closest(".history-list");if(!list)return null;const index=[...list.children].indexOf(item),entries=store.get().history.entries.slice().reverse();return entries[index]||null;}
function injectHistorySimulationButtons(){document.querySelectorAll(".history-item").forEach(item=>{if(item.querySelector(".history-sim-open"))return;const b=document.createElement("button");b.type="button";b.className="history-sim-open button";b.textContent="Haritada simüle et";item.appendChild(b);});}
function installStyles(){if(document.getElementById("historySimulationStyles"))return;const style=document.createElement("style");style.id="historySimulationStyles";style.textContent=`.app-dialog.history-sim-dialog{width:min(1180px,calc(100vw - 28px));max-width:min(1180px,calc(100vw - 28px))}.history-sim-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.history-sim-map{height:min(58vh,520px);min-height:320px}.history-pin-number{background:transparent;border:0}.history-pin-number span{display:flex;width:22px;height:22px;align-items:center;justify-content:center;border:2px solid #fff;border-radius:50%;background:${RED};color:#fff;font:700 10px/1 sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35)}.history-sim-dot{width:8px;height:8px;display:inline-block;border-radius:50%}.history-sim-dot.green{background:${GREEN}}.history-sim-dot.red{background:${RED}}@media(max-width:720px){.history-sim-grid{grid-template-columns:1fr}.history-sim-map{height:330px;min-height:280px}}`;document.head.appendChild(style);}
if(typeof document!=="undefined"){installStyles();const observer=new MutationObserver(injectHistorySimulationButtons);observer.observe(document.body,{childList:true,subtree:true});document.addEventListener("click",event=>{const button=event.target?.closest?.(".history-sim-open");if(!button)return;event.preventDefault();event.stopPropagation();const item=button.closest(".history-item"),entry=item?historyEntryFromItem(item):null;if(!entry)return;renderSimulation({appDialog:document.getElementById("appDialog"),dialogTitle:document.getElementById("dialogTitle"),dialogBody:document.getElementById("dialogBody")},entry);},true);document.getElementById("dialogClose")?.addEventListener("click",destroySimulationMaps);}
