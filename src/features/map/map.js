import { store } from "../../state/store.js";
import { openRegionActions } from "../regions/region-actions.js";

const DEFAULT_MAP_SETTINGS = {
  boundaryColor: "#ffffff",
  boundaryWeight: 1.5,
  outsideColor: "#4b5563",
  outsideOpacity: 0.55,
  closedColor: "#7c3aed",
  closedOpacity: 0.55,
  campaignColor: "#ffd400",
  campaignOpacity: 0.55
};

const DEFAULT_OVERLAY_VISIBILITY = {
  regions: true,
  outside: true,
  campaign: true,
  mask: true
};

export function createMap() {
  const map = L.map("map", {
    center: [39.0, 35.0],
    zoom: 5,
    zoomControl: false,
    attributionControl: true,
    doubleClickZoom: true
  });

  const standard = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }
  ).addTo(map);

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" }
  );

  const mapState = {
    map,
    layers: { standard, satellite },
    polygons: L.featureGroup().addTo(map),
    mask: L.featureGroup().addTo(map),
    regionLayers: [],
    overlayVisibility: { ...DEFAULT_OVERLAY_VISIBILITY }
  };

  let previousRegions = store.get().regions.custom;
  let previousMapSettings = store.get().mapSettings;
  store.subscribe((state) => {
    const regionsChanged = state.regions.custom !== previousRegions;
    const settingsChanged = state.mapSettings !== previousMapSettings;
    if (!regionsChanged && !settingsChanged) return;
    previousRegions = state.regions.custom;
    previousMapSettings = state.mapSettings;
    renderRegionsOnMap(mapState, state.regions.custom, state.mapSettings);
  });

  window.__regionConsoleMapState = mapState;
  return mapState;
}

export function setLayer(mapState, name) {
  const { map, layers } = mapState;
  Object.values(layers).forEach((layer) => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
  (layers[name] || layers.standard).addTo(map);
}

export function resetView(mapState) {
  mapState.map.setView([39.0, 35.0], 5);
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
  return (ring || [])
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)]);
}

function geometryToLatLngs(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return (geometry.coordinates || [])
      .map(toLatLngRing)
      .filter((ring) => ring.length >= 3);
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => (polygon || []).map(toLatLngRing).filter((ring) => ring.length >= 3))
      .filter((polygon) => polygon.length > 0);
  }

  return [];
}

function geometryToOuterRings(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    const outer = toLatLngRing((geometry.coordinates || [])[0]);
    return outer.length >= 3 ? [outer] : [];
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((polygon) => toLatLngRing((polygon || [])[0]))
      .filter((ring) => ring.length >= 3);
  }

  return [];
}

function isCampaignRegion(region) {
  return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId);
}

function renderOutsideMask(mapState, serviceRings, settings) {
  mapState.mask.clearLayers();
  const outer = [[89, -180], [89, 180], [-89, 180], [-89, -180], [89, -180]];
  const holes = serviceRings
    .filter((ring) => ring.length >= 3)
    .map((ring) => ring.slice().reverse());

  L.polygon([outer, ...holes], {
    stroke: false,
    fillColor: settings.outsideColor,
    fillOpacity: settings.outsideOpacity,
    interactive: false
  }).addTo(mapState.mask);

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
    const shouldShow = mapState.overlayVisibility[kind];
    const isShown = mapState.polygons.hasLayer(layer);
    if (shouldShow && !isShown) mapState.polygons.addLayer(layer);
    if (!shouldShow && isShown) mapState.polygons.removeLayer(layer);
  }
}

export function setOverlayVisibility(mapState, name, visible) {
  if (!(name in DEFAULT_OVERLAY_VISIBILITY)) return false;
  mapState.overlayVisibility[name] = Boolean(visible);

  if (name === "mask") {
    if (mapState.overlayVisibility.mask) {
      mapState.mask.addTo(mapState.map);
    } else {
      mapState.map.removeLayer(mapState.mask);
    }
    return true;
  }

  syncRegionLayerVisibility(mapState);
  return true;
}

export function getOverlayVisibility(mapState) {
  return { ...mapState.overlayVisibility };
}

export function renderRegionsOnMap(mapState, regions = [], settings = null) {
  const normalized = normalizeSettings(settings || store.get().mapSettings);
  mapState.polygons.clearLayers();
  mapState.regionLayers = [];
  const bounds = [];
  const serviceRings = [];

  for (const region of regions) {
    const geometry = region?.geometry;
    const latLngs = geometryToLatLngs(geometry);
    if (!latLngs.length) continue;

    const outside = region.status === "outside";
    const closed = region.status === "closed";
    const campaign = isCampaignRegion(region);
    const kind = outside ? "outside" : campaign ? "campaign" : "regions";
    const fillColor = outside
      ? normalized.outsideColor
      : closed
        ? normalized.closedColor
        : campaign
          ? normalized.campaignColor
          : "transparent";
    const fillOpacity = outside
      ? normalized.outsideOpacity
      : closed
        ? normalized.closedOpacity
        : campaign
          ? normalized.campaignOpacity
          : 0.04;

    // Leaflet's Polygon expects one polygon as rings or a MultiPolygon as
    // an array of polygons. Keeping the nesting from GeoJSON is critical:
    // flattening MultiPolygon parts makes the second island/ring a hole.
    const polygon = L.polygon(latLngs, {
      color: normalized.boundaryColor,
      weight: normalized.boundaryWeight,
      fillColor,
      fillOpacity
    });

    polygon.bindTooltip(region.name || region.properties?.name || "Alan");
    polygon.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      for (const layer of mapState.regionLayers) {
        if (!layer.options) continue;
        layer.setStyle({
          weight: normalized.boundaryWeight,
          fillOpacity: layer.options._baseFillOpacity ?? layer.options.fillOpacity
        });
      }
      polygon.setStyle({
        weight: Math.min(8, normalized.boundaryWeight + 1.5),
        fillOpacity: Math.min(0.9, fillOpacity + 0.12)
      });
      store.update("regions", { selectedId: region.id });
      openRegionActions(region, mapState);
      mapState.map.fitBounds(polygon.getBounds(), { padding: [36, 36], maxZoom: 12, animate: true });
    });

    polygon.options._baseFillOpacity = fillOpacity;
    polygon._regionLayerKind = kind;
    mapState.regionLayers.push(polygon);
    if (mapState.overlayVisibility[kind]) polygon.addTo(mapState.polygons);

    const allPoints = Array.isArray(latLngs[0]?.[0])
      ? latLngs.flat(2)
      : latLngs.flat();
    allPoints.forEach((point) => bounds.push(point));

    if (!outside) serviceRings.push(...geometryToOuterRings(geometry));
  }

  renderOutsideMask(mapState, serviceRings, normalized);
  return bounds;
}

export function fitToCoordinates(mapState, coordinates = [], padding = [30, 30]) {
  if (!coordinates.length) return false;
  const latLngs = coordinates
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)]);
  if (!latLngs.length) return false;
  mapState.map.fitBounds(L.latLngBounds(latLngs), { padding, maxZoom: 15, animate: true });
  return true;
}

export function invalidateMap(mapState) {
  requestAnimationFrame(() => mapState.map.invalidateSize({ pan: false }));
}
