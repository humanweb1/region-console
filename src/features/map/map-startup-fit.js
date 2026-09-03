function scheduleStartupFit() {
  const mapState = window.__regionConsoleMapState;
  const map = mapState?.map;
  if (!map) return;

  const container = map.getContainer?.();
  const rect = container?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    window.setTimeout(scheduleStartupFit, 50);
    return;
  }

  const layers = (mapState.regionLayers || []).filter((layer) => layer?.getBounds?.()?.isValid?.());
  if (!layers.length) return;

  map.invalidateSize({ pan: false });
  const bounds = L.latLngBounds([]);
  layers.forEach((layer) => bounds.extend(layer.getBounds()));
  if (!bounds.isValid()) return;

  map.fitBounds(bounds, {
    padding: [42, 42],
    maxZoom: 13,
    animate: false
  });
  mapState.initialAccessFitDone = true;
}

window.addEventListener("region-console:startup-ready", () => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scheduleStartupFit);
  });
});
