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
    polygons: L.featureGroup().addTo(map)
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

function geometryToLatLngs(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return (geometry.coordinates || []).map((ring) =>
      (ring || []).map(([lat, lng]) => [lat, lng])
    );
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) =>
      (polygon || []).map((ring) =>
        (ring || []).map(([lat, lng]) => [lat, lng])
      )
    );
  }

  return [];
}

export function renderRegionsOnMap(mapState, regions = []) {
  mapState.polygons.clearLayers();
  const bounds = [];

  for (const region of regions) {
    const rings = geometryToLatLngs(region?.geometry);
    if (!rings.length) continue;

    const validRings = rings.filter((ring) => ring.length >= 3);
    if (!validRings.length) continue;

    const polygon = L.polygon(validRings, {
      color: region.status === "outside" ? "#9aa0a5" : "#16c784",
      weight: 2,
      fillOpacity: 0.28
    });
    polygon.bindTooltip(region.name || region.properties?.name || "Alan");
    polygon.on("click", () => {
      polygon.setStyle({ weight: 4, fillOpacity: 0.42 });
    });
    polygon.addTo(mapState.polygons);
    validRings.flat().forEach((point) => bounds.push(point));
  }

  return bounds;
}

export function fitToCoordinates(mapState, coordinates = [], padding = [30, 30]) {
  if (!coordinates.length) return false;
  mapState.map.fitBounds(L.latLngBounds(coordinates), {
    padding,
    maxZoom: 15,
    animate: true
  });
  return true;
}

export function invalidateMap(mapState) {
  requestAnimationFrame(() => mapState.map.invalidateSize({ pan: false }));
}
