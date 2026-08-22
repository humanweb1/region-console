import { store } from "../../state/store.js";

const DEFAULT_MAP_SETTINGS = {
  boundaryColor: "#ffffff",
  boundaryWeight: 1.5,
  outsideColor: "#4b5563",
  outsideOpacity: 0.55,
  campaignColor: "#ffd400",
  campaignOpacity: 0.55
};

const DEFAULT_LAYER_VISIBILITY = {
  country: true,
  province: true,
  district: true,
  neighborhood: true,
  cemetery: true,
  special: true,
  service: true,
  outside: true,
  campaign: true
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
    mask: L.featureGroup().addTo(map)
  };

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
    campaignOpacity: Math.max(0, Math.min(1, Number(settings.campaignOpacity ?? DEFAULT_MAP_SETTINGS.campaignOpacity)))
  };
}

function normalizeLayerVisibility(visibility = {}) {
  return { ...DEFAULT_LAYER_VISIBILITY, ...(visibility || {}) };
}

function normalizeLayerValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function regionProperties(region) {
  return region?.importMeta?.properties || region?.properties || {};
}

function resolveRegionLayer(region) {
  const properties = regionProperties(region);
  const raw = [
    region?.layerType,
    region?.layer,
    region?.regionType,
    region?.category,
    properties.layerType,
    properties.layer,
    properties.regionType,
    properties.category,
    properties.featureType,
    properties.type,
    properties.level,
    properties.admin_level,
    properties.adminLevel
  ].find((value) => value !== undefined && value !== null && value !== "");

  const normalized = normalizeLayerValue(raw);
  const numericAdmin = Number(raw);
  if (Number.isFinite(numericAdmin)) {
    if (numericAdmin <= 0) return "country";
    if (numericAdmin === 1) return "province";
    if (numericAdmin === 2) return "district";
    if (numericAdmin >= 3) return "neighborhood";
  }

  if (["country", "ulke", "admin0", "adm0", "national"].includes(normalized)) return "country";
  if (["province", "il", "state", "admin1", "adm1"].includes(normalized)) return "province";
  if (["district", "ilce", "county", "admin2", "adm2"].includes(normalized)) return "district";
  if (["neighborhood", "mahalle", "admin3", "adm3", "quarter"].includes(normalized)) return "neighborhood";
  if (["cemetery", "mezarlik", "mezarligi", "graveyard"].includes(normalized)) return "cemetery";
  if (["special", "ozel", "ozel_bolge", "custom"].includes(normalized)) return "special";

  return "special";
}

function resolveStatusLayer(region) {
  if (isCampaignRegion(region)) return "campaign";
  if (region?.status === "outside") return "outside";
  return "service";
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
  const visibility = normalizeLayerVisibility(window.__regionConsoleLayerVisibility || store.get().layerVisibility);
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
    if (!outside) serviceRings.push(...validRings);

    const regionLayer = resolveRegionLayer(region);
    const statusLayer = resolveStatusLayer(region);
    if (!visibility[regionLayer] || !visibility[statusLayer]) continue;

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
  }

  renderOutsideMask(mapState, serviceRings, normalized);
  return bounds;
}

// Persisted region geometry follows RFC 7946 GeoJSON order: [longitude, latitude].
// Leaflet uses [latitude, longitude], so the conversion happens only at this boundary.
function geometryToLatLngs(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return (geometry.coordinates || []).map((ring) =>
      (ring || []).map(([lng, lat]) => [Number(lat), Number(lng)])
    );
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) =>
      (polygon || []).map((ring) =>
        (ring || []).map(([lng, lat]) => [Number(lat), Number(lng)])
      )
    );
  }
  return [];
}

// fitToCoordinates also accepts standard GeoJSON [longitude, latitude] pairs.
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

// Re-render immediately when the layer chooser changes.
document.addEventListener("region-console:layers-changed", () => {
  const mapState = window.__regionConsoleMapState;
  if (!mapState) return;
  renderRegionsOnMap(mapState, store.get().regions.custom);
});
