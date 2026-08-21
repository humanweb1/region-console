export function createMap() {
  const map = L.map("map", {
    center: [39.0, 35.0],
    zoom: 5,
    zoomControl: false,
    attributionControl: true
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
  layers[name].addTo(map);
}

export function resetView(mapState) {
  mapState.map.setView([39.0, 35.0], 5);
}

export function invalidateMap(mapState) {
  requestAnimationFrame(() => mapState.map.invalidateSize({ pan: false }));
}
