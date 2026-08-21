import { store } from "../../state/store.js";

const DEFAULT_MAP_SETTINGS = {
  boundaryColor: "#ffffff",
  boundaryWeight: 1.5,
  outsideColor: "#4b5563",
  outsideOpacity: 0.55,
  campaignColor: "#ffd400",
  campaignOpacity: 0.55
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

  return {
    map,
    layers: { standard, satellite },
    polygons: L.featureGroup().addTo(map),
    mask: L.featureGroup().addTo(map)
  };
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
    campaignOpacity: Math.max(0, Math.min(1, Number(settings.campaignOpacity ?? DEFAULT_MAP_SETTINGS.campaignOpacity)))
  };
}

function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return (geometry.coordinates || []).map((ring) => (ring || []).map(([lng, lat]) => [lat, lng]));
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) =>
      (polygon || []).map((ring) => (ring || []).map(([lng, lat]) => [lat, lng]))
    );
  }
  return [];
}

function isCampaignRegion(region) {
  return region?.status === "campaign" || region?.campaign === true || Boolean(region?.campaignId);
}

function renderOutsideMask(mapState, serviceRings, settings) {
  mapState.mask.clearLayers();
  const outer = [[89, -180], [89, 180], [-89, 180], [-89, -180], [89, -180]];
  const holes = serviceRings.filter((ring) => ring.length >= 3).map((ring) => ring.slice().reverse());

  L.polygon([outer, ...holes], {
    stroke: false,
    fillColor: settings.outsideColor,
    fillOpacity: settings.outsideOpacity,
    interactive: false
  }).addTo(mapState.mask);
}

export function renderRegionsOnMap(mapState, regions = [], settings = null) {
  const normalized = normalizeSettings(settings || store.get().mapSettings);
  mapState.polygons.clearLayers();
  const bounds = [];
  const serviceRings = [];

  for (const region of regions) {
    const rings = geometryToLatLngs(region?.geometry);
    if (!rings.length) continue;
    const validRings = rings.filter((ring) => ring.length >= 3);
    if (!validRings.length) continue;

    const outside = region.status === "outside";
    const campaign = isCampaignRegion(region);
    const fillColor = outside ? normalized.outsideColor : campaign ? normalized.campaignColor : "transparent";
    const fillOpacity = outside
      ? Math.min(0.9, normalized.outsideOpacity + 0.08)
      : campaign
        ? normalized.campaignOpacity
        : 0.04;

    const polygon = L.polygon(validRings, {
      color: normalized.boundaryColor,
      weight: normalized.boundaryWeight,
      fillColor,
      fillOpacity
    });
    polygon.bindTooltip(region.name || region.properties?.name || "Alan");
    polygon.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      mapState.polygons.eachLayer((layer) => {
        if (!layer.options) return;
        layer.setStyle({
          weight: normalized.boundaryWeight,
          fillOpacity: layer.options._baseFillOpacity ?? layer.options.fillOpacity
        });
      });
      polygon.setStyle({
        weight: Math.min(8, normalized.boundaryWeight + 1.5),
        fillOpacity: Math.min(0.9, fillOpacity + 0.12)
      });
      store.update("regions", { selectedId: region.id });
      document.dispatchEvent(new CustomEvent("region-console:region-selected", {
        detail: { region, polygon, mapState }
      }));
      mapState.map.fitBounds(polygon.getBounds(), { padding: [36, 36], maxZoom: 12, animate: true });
    });
    polygon.options._baseFillOpacity = fillOpacity;
    polygon.addTo(mapState.polygons);
    validRings.flat().forEach((point) => bounds.push(point));

    if (!outside) serviceRings.push(validRings[0]);
  }

  renderOutsideMask(mapState, serviceRings, normalized);
  return bounds;
}

export function fitToCoordinates(mapState, coordinates = [], padding = [30, 30]) {
  if (!coordinates.length) return false;
  mapState.map.fitBounds(L.latLngBounds(coordinates), { padding, maxZoom: 15, animate: true });
  return true;
}

export function invalidateMap(mapState) {
  requestAnimationFrame(() => mapState.map.invalidateSize({ pan: false }));
}
