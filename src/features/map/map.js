import { store } from "../../state/store.js";
import { openRegionActions } from "../regions/region-actions.js";
import { isRegionVisible } from "../../services/rbac.js";

const DEFAULT_MAP_SETTINGS = { boundaryColor: "#ffffff", boundaryWeight: 1.5, outsideColor: "#4b5563", outsideOpacity: 0.55, closedColor: "#7c3aed", closedOpacity: 0.55, campaignColor: "#ffd400", campaignOpacity: 0.55 };
const DEFAULT_OVERLAY_VISIBILITY = { regions: true, outside: true, campaign: true, mask: true, province: true, district: true, neighborhood: true, cemetery: true, special: true };

export function createMap() {
  const map = L.map("map", { center: [39.0, 35.0], zoom: 5, zoomControl: false, attributionControl: true, doubleClickZoom: true });
  const standard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
  const mapState = { map, layers: { standard, satellite }, polygons: L.featureGroup().addTo(map), mask: L.featureGroup().addTo(map), regionLayers: [], overlayVisibility: { ...DEFAULT_OVERLAY_VISIBILITY }, initialAccessFitDone: false };
  let previousRegions = store.get().regions.custom;
  let previousMapSettings = store.get().mapSettings;
  store.subscribe((state) => {
    const regionsChanged = state.regions.custom !== previousRegions;
    const settingsChanged = state.mapSettings !== previousMapSettings;
    if (!regionsChanged && !settingsChanged) return;
    previousRegions = state.regions.custom;
    previousMapSettings = state.mapSettings;
    renderRegionsOnMap(mapState, state.regions.custom, state.mapSettings);
    fitInitialVisibleAccess(mapState);
  });
  window.addEventListener("region-console:rbac-updated", () => {
    mapState.initialAccessFitDone = false;
    renderRegionsOnMap(mapState, store.get().regions.custom, store.get().mapSettings);
    fitInitialVisibleAccess(mapState);
  });
  window.__regionConsoleMapState = mapState;
  return mapState;
}

export function setLayer(mapState, name) {
  const { map, layers } = mapState;
  Object.values(layers).forEach((layer) => { if (map.hasLayer(layer)) map.removeLayer(layer); });
  (layers[name] || layers.standard).addTo(map);
}

export function resetView(mapState) {
  mapState.map.setView([39.0, 35.0], 5);
  mapState.initialAccessFitDone = true;
}

function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_MAP_SETTINGS,
    ...settings,
    boundaryWeight: Math.max(0.5, Math.min(8, Number(settings.boundaryWeight ?? DEFAULT_MAP_SETTINGS.boundaryWeight))),
    outsideOpacity: Math.max(0, Math.min(1, Number(settings.outsideOpacity ?? DEFAULT_MAP_SETTINGS.outsideOpacity))),
    closedOpacity: Math.max(0, Math.min(1, Number(settings.closedOpacity ?? DEFAULT_MAP_SETTINGS.closedOpacity))),
    campaignOpacity: Math.max(0, Math.min(1, Number(settings.campaignOpacity ?? DEFAULT_MAP_SETTINGS.campaignOpacity)))
  };
}

function toLatLngRing(ring) {
  return (ring || []).filter((point) => Array.isArray(point) && point.length >= 2).map(([lng, lat]) => [Number(lat), Number(lng)]);
}

function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return (geometry.coordinates || []).map(toLatLngRing).filter((ring) => ring.length >= 3);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).map((polygon) => (polygon || []).map(toLatLngRing).filter((ring) => ring.length >= 3)).filter((polygon) => polygon.length > 0);
  return [];
}

function geometryToOuterRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    const outer = toLatLngRing((geometry.coordinates || [])[0]);
    return outer.length >= 3 ? [outer] : [];
  }
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).map((polygon) => toLatLngRing((polygon || [])[0])).filter((ring) => ring.length >= 3);
  return [];
}

function isCampaignRegion(region) {
  return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId);
}

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

function regionHasParent(region, regions) {
  const hierarchy = region?.hierarchy || {};
  const parentId = hierarchy.parentId == null ? "" : String(hierarchy.parentId);
  const parentName = normalizeName(hierarchy.parentName);
  const parentType = hierarchy.parentType || null;
  if (!parentId && !parentName) return false;
  return regions.some((candidate) => {
    if (!candidate || candidate === region) return false;
    const candidateType = candidate?.hierarchy?.type || candidate?.type || null;
    if (parentType && candidateType && candidateType !== parentType) return false;
    const candidateId = String(candidate.id ?? candidate.importMeta?.sourceId ?? "");
    const candidateName = normalizeName(candidate.name);
    return (parentId && candidateId === parentId) || (parentName && candidateName === parentName);
  });
}

function hierarchyCandidates(regions) {
  const stateRegions = store.get().regions || {};
  const countries = Array.isArray(stateRegions.countries) ? stateRegions.countries : [];
  const nested = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (!item) continue;
      nested.push(item);
      const children = [
        ...(Array.isArray(item.provinces) ? item.provinces : []),
        ...(Array.isArray(item.districts) ? item.districts : []),
        ...(Array.isArray(item.neighborhoods) ? item.neighborhoods : []),
        ...(Array.isArray(item.children) ? item.children : [])
      ];
      if (children.length) walk(children);
    }
  };
  walk(countries);
  return [...regions, ...nested];
}

function findHierarchyParent(region, candidates) {
  const hierarchy = region?.hierarchy || {};
  const parentId = hierarchy.parentId == null ? "" : String(hierarchy.parentId);
  const parentName = normalizeName(hierarchy.parentName);
  const parentType = hierarchy.parentType || null;
  if (!parentId && !parentName) return null;
  return candidates.find((candidate) => {
    if (!candidate || candidate === region) return false;
    const candidateType = candidate?.hierarchy?.type || candidate?.type || null;
    if (parentType && candidateType && candidateType !== parentType) return false;
    const candidateId = String(candidate.id ?? candidate.importMeta?.sourceId ?? "");
    const candidateName = normalizeName(candidate.name);
    return (parentId && candidateId === parentId) || (parentName && candidateName === parentName);
  }) || null;
}

function hierarchyTooltipText(region, regions) {
  const candidates = hierarchyCandidates(regions);
  const chain = [];
  const visited = new Set();
  let current = region;
  while (current && !visited.has(current)) {
    visited.add(current);
    const name = String(current.name || current.properties?.name || "Alan").trim();
    if (name) chain.unshift(name);
    current = findHierarchyParent(current, candidates);
  }
  const hierarchy = region?.hierarchy || {};
  if (chain.length === 1 && hierarchy.countryName) chain.unshift(String(hierarchy.countryName).trim());
  else if (chain.length > 1 && hierarchy.countryName && !chain.some((name) => normalizeName(name) === normalizeName(hierarchy.countryName))) chain.unshift(String(hierarchy.countryName).trim());
  return chain.filter(Boolean).join("-");
}

function regionCategory(region) {
  const type = String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
  if (["province", "provinces", "il"].includes(type)) return "province";
  if (["district", "districts", "ilce", "ilçe"].includes(type)) return "district";
  if (["neighborhood", "neighbourhood", "mahalle"].includes(type)) return "neighborhood";
  if (["cemetery", "mezarlik", "mezarlık"].includes(type)) return "cemetery";
  return "special";
}

function isOpenServiceRegion(region) {
  if (!region || typeof region !== "object") return false;
  if (region.status === "outside" || region.status === "closed" || isCampaignRegion(region)) return false;
  return Boolean(region.geometry);
}

function sameRegionIdentity(a, b) {
  if (!a || !b) return false;
  const aType = regionType(a);
  const bType = regionType(b);
  if (aType && bType && aType !== bType) return false;
  const aIds = [a.id, a.importMeta?.sourceId, a.importMeta?.properties?.id].filter((value) => value != null).map(String);
  const bIds = [b.id, b.importMeta?.sourceId, b.importMeta?.properties?.id].filter((value) => value != null).map(String);
  if (aIds.some((id) => bIds.includes(id))) return true;
  return normalizeName(a.name || a.properties?.name) === normalizeName(b.name || b.properties?.name);
}

function serviceMaskRoots(regions) {
  const openRegions = (Array.isArray(regions) ? regions : []).filter(isOpenServiceRegion);
  if (!openRegions.length) return [];
  const candidates = hierarchyCandidates(openRegions);
  const roots = [];
  for (const region of openRegions) {
    const visited = new Set([region]);
    let current = findHierarchyParent(region, candidates);
    let hasOpenAncestor = false;
    while (current && !visited.has(current)) {
      visited.add(current);
      if (openRegions.some((candidate) => sameRegionIdentity(candidate, current))) {
        hasOpenAncestor = true;
        break;
      }
      current = findHierarchyParent(current, candidates);
    }
    if (!hasOpenAncestor) roots.push(region);
  }
  return roots;
}

function renderOutsideMask(mapState, serviceRings, settings) {
  mapState.mask.clearLayers();
  const outer = [[89, -180], [89, 180], [-89, 180], [-89, -180], [89, -180]];
  const holes = serviceRings.filter((ring) => ring.length >= 3).map((ring) => ring.slice().reverse());
  L.polygon([outer, ...holes], { stroke: false, fillColor: settings.outsideColor, fillOpacity: settings.outsideOpacity, interactive: false }).addTo(mapState.mask);
  if (mapState.overlayVisibility.mask) {
    if (!mapState.map.hasLayer(mapState.mask)) mapState.mask.addTo(mapState.map);
  } else if (mapState.map.hasLayer(mapState.mask)) {
    mapState.map.removeLayer(mapState.mask);
  }
}

function syncRegionLayerVisibility(mapState) {
  for (const layer of mapState.regionLayers) {
    const kind = layer._regionLayerKind;
    if (!kind) continue;
    const categoryVisible = mapState.overlayVisibility[kind] !== false;
    const isShown = mapState.polygons.hasLayer(layer);
    if (categoryVisible && !isShown) mapState.polygons.addLayer(layer);
    if (!categoryVisible && isShown) mapState.polygons.removeLayer(layer);
  }
}

export function setOverlayVisibility(mapState, name, visible) {
  if (!(name in DEFAULT_OVERLAY_VISIBILITY)) return false;
  mapState.overlayVisibility[name] = Boolean(visible);
  if (name === "mask") {
    if (mapState.overlayVisibility.mask) mapState.mask.addTo(mapState.map);
    else mapState.map.removeLayer(mapState.mask);
    return true;
  }
  if (["province", "district", "neighborhood", "cemetery", "special"].includes(name)) {
    syncRegionLayerVisibility(mapState);
    return true;
  }
  for (const layer of mapState.regionLayers) {
    const kind = layer._regionLayerKind;
    if (name === "regions" && kind !== "special") {
      if (visible) mapState.polygons.addLayer(layer);
      else mapState.polygons.removeLayer(layer);
    }
  }
  return true;
}

export function getOverlayVisibility(mapState) {
  return { ...mapState.overlayVisibility };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringBounds(ring) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lng] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

function ringContainsRing(parentRing, childRing) {
  if (!parentRing?.length || !childRing?.length) return false;
  const p = childRing[Math.floor(childRing.length / 2)];
  const pb = ringBounds(parentRing);
  const cb = ringBounds(childRing);
  if (cb.minLat < pb.minLat || cb.maxLat > pb.maxLat || cb.minLng < pb.minLng || cb.maxLng > pb.maxLng) return false;
  return pointInRing(p, parentRing);
}

function serviceChildRings(region, regions) {
  return regions.filter((candidate) => {
    if (!candidate || candidate === region) return false;
    if (candidate.status === "outside" || candidate.status === "closed" || isCampaignRegion(candidate)) return false;
    return regionHasParent(candidate, [region, ...regions]);
  }).flatMap((child) => geometryToOuterRings(child.geometry));
}

function addServiceHoles(latLngs, holes) {
  if (!holes.length) return latLngs;
  if (!Array.isArray(latLngs[0])) return latLngs;
  if (Array.isArray(latLngs[0][0]) && Array.isArray(latLngs[0][0][0])) {
    return latLngs.map((polygon) => {
      if (!polygon?.length) return polygon;
      const outer = polygon[0];
      const matching = holes.filter((ring) => ringContainsRing(outer, ring));
      return [outer, ...polygon.slice(1), ...matching];
    });
  }
  const outer = latLngs[0];
  const matching = holes.filter((ring) => ringContainsRing(outer, ring));
  return [outer, ...latLngs.slice(1), ...matching];
}

function scopeRootTypes(access) {
  if (!access?.loaded) return new Set();
  const roleName = String(access.role?.name || access.role || "").trim().toLowerCase();
  if (roleName === "super_admin" || (access.permissions || []).includes("*")) return new Set();
  const types = new Set();
  for (const scope of access.scopes || []) {
    if (scope?.district_id) types.add("district");
    else if (scope?.province_id) types.add("province");
    else if (scope?.country_id) types.add("country");
  }
  return types;
}

function regionType(region) {
  return String(region?.hierarchy?.type || region?.type || "").trim().toLowerCase();
}

function isRootViewportRegion(region, rootTypes) {
  const type = regionType(region);
  if (rootTypes.has("province") && ["province", "provinces", "il"].includes(type)) return true;
  if (rootTypes.has("district") && ["district", "districts", "ilce", "ilçe"].includes(type)) return true;
  if (rootTypes.has("country") && ["country", "countries", "ülke"].includes(type)) return true;
  return false;
}

export function fitInitialVisibleAccess(mapState) {
  if (mapState.initialAccessFitDone) return false;
  const access = window.RegionConsoleRBAC?.access || null;
  if (!access?.loaded) return false;
  const regions = store.get().regions?.custom || [];
  const visibleRegions = regions.filter((region) => isRegionVisible(access, region));
  const rootTypes = scopeRootTypes(access);
  const viewportRegions = rootTypes.size ? visibleRegions.filter((region) => isRootViewportRegion(region, rootTypes)) : visibleRegions;
  const candidates = viewportRegions.length ? viewportRegions : visibleRegions;
  const coordinates = [];
  for (const region of candidates) {
    for (const ring of geometryToOuterRings(region?.geometry)) coordinates.push(...ring);
  }
  if (!coordinates.length) return false;
  mapState.map.fitBounds(L.latLngBounds(coordinates), { padding: [42, 42], maxZoom: 13, animate: false });
  mapState.initialAccessFitDone = true;
  return true;
}

function regionRenderDepth(region) {
  const type = regionType(region);
  if (["country", "countries", "ülke"].includes(type)) return 0;
  if (["province", "provinces", "il"].includes(type)) return 1;
  if (["district", "districts", "ilce", "ilçe"].includes(type)) return 2;
  if (["neighborhood", "neighbourhood", "mahalle"].includes(type)) return 3;
  return region?.hierarchy?.parentId || region?.hierarchy?.parentName ? 1 : 4;
}

function regionLayerPriority(region) {
  const depth = regionRenderDepth(region);
  const category = regionCategory(region);
  const categoryPriority = { country: 0, special: 1, province: 2, district: 3, neighborhood: 4, cemetery: 5 };
  return depth * 10 + (categoryPriority[category] ?? 1);
}

function orderRegionsForHitTesting(regions) {
  return [...regions].sort((a, b) => {
    const priorityDiff = regionLayerPriority(a) - regionLayerPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

export function renderRegionsOnMap(mapState, regions = [], settings = null) {
  const normalized = normalizeSettings(settings || store.get().mapSettings);
  const access = window.RegionConsoleRBAC?.access || null;
  const visibleRegions = (regions || []).filter((region) => isRegionVisible(access, region));
  const orderedRegions = orderRegionsForHitTesting(visibleRegions);
  mapState.polygons.clearLayers();
  mapState.regionLayers = [];
  const bounds = [];
  const serviceRings = serviceMaskRoots(visibleRegions).flatMap((region) => geometryToOuterRings(region.geometry));

  for (const region of orderedRegions) {
    const geometry = region?.geometry;
    const rawLatLngs = geometryToLatLngs(geometry);
    if (!rawLatLngs.length) continue;
    const outside = region.status === "outside";
    const closed = region.status === "closed";
    const campaign = isCampaignRegion(region);
    const category = regionCategory(region);
    const fillColor = outside ? normalized.outsideColor : closed ? normalized.closedColor : campaign ? normalized.campaignColor : "transparent";
    const fillOpacity = outside ? normalized.outsideOpacity : closed ? normalized.closedOpacity : campaign ? normalized.campaignOpacity : 0;
    const latLngs = closed ? addServiceHoles(rawLatLngs, serviceChildRings(region, visibleRegions)) : rawLatLngs;
    const polygon = L.polygon(latLngs, { color: normalized.boundaryColor, weight: normalized.boundaryWeight, fillColor, fillOpacity });
    polygon._regionId = region.id;
    polygon._regionLayerKind = category;
    polygon._regionCategory = category;
    polygon._regionStatus = outside ? "outside" : closed ? "closed" : campaign ? "campaign" : "service";
    polygon.options._baseFillOpacity = fillOpacity;
    polygon.bindTooltip(hierarchyTooltipText(region, visibleRegions) || region.name || "Alan", { sticky: true, direction: "top", opacity: 0.96, className: "region-hierarchy-tooltip" });
    polygon.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      const currentRegions = store.get().regions?.custom || [];
      const currentRegion = currentRegions.find((item) => item && String(item.id) === String(polygon._regionId)) || null;
      if (!currentRegion || !isRegionVisible(window.RegionConsoleRBAC?.access || null, currentRegion)) return;
      for (const layer of mapState.regionLayers) {
        if (!layer?.options) continue;
        layer.setStyle({ weight: normalized.boundaryWeight, fillOpacity: layer.options._baseFillOpacity ?? layer.options.fillOpacity });
      }
      polygon.setStyle({ weight: Math.min(8, normalized.boundaryWeight + 1.5), fillOpacity: Math.min(0.9, fillOpacity + 0.12) });
      store.update("regions", { selectedId: currentRegion.id });
      openRegionActions(currentRegion, mapState);
      mapState.map.fitBounds(polygon.getBounds(), { padding: [36, 36], maxZoom: 12, animate: true });
    });
    mapState.regionLayers.push(polygon);
    if (mapState.overlayVisibility[category] !== false) polygon.addTo(mapState.polygons);
    const allPoints = Array.isArray(latLngs[0]?.[0]) ? latLngs.flat(2) : latLngs.flat();
    allPoints.forEach((point) => bounds.push(point));
  }

  renderOutsideMask(mapState, serviceRings, normalized);
  return bounds;
}

export function fitToCoordinates(mapState, coordinates = [], padding = [30, 30]) {
  if (!coordinates.length) return false;
  const latLngs = coordinates.filter((point) => Array.isArray(point) && point.length >= 2).map(([lng, lat]) => [Number(lat), Number(lng)]);
  if (!latLngs.length) return false;
  mapState.map.fitBounds(L.latLngBounds(latLngs), { padding, maxZoom: 15, animate: true });
  return true;
}

export function invalidateMap(mapState) {
  requestAnimationFrame(() => mapState.map.invalidateSize({ pan: false }));
}
