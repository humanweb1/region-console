export function createDrawingController(mapState, onChange) {
  let active = false;
  let draft = null;
  let points = [];
  let finishHandler = null;

  function emit() {
    onChange({
      active,
      draft,
      points: points.slice(),
      area: draft ? L.GeometryUtil?.geodesicArea?.(draft.getLatLngs()[0]) || 0 : 0
    });
  }

  function clearDraft() {
    if (draft) mapState.polygons.removeLayer(draft);
    draft = null;
    points = [];
  }

  function finish() {
    if (points.length < 3) return false;
    draft = L.polygon(points, {
      color: "#ffd400",
      weight: 3,
      fillOpacity: 0.28
    }).addTo(mapState.polygons);
    points = draft.getLatLngs()[0].slice();
    active = false;
    mapState.map.doubleClickZoom.enable();
    if (finishHandler) mapState.map.off("dblclick", finishHandler);
    finishHandler = null;
    emit();
    return true;
  }

  function handleClick(event) {
    if (!active) return;
    points.push(event.latlng);
    if (draft) mapState.polygons.removeLayer(draft);
    draft = L.polygon(points, {
      color: "#ffd400",
      weight: 3,
      dashArray: "6 6",
      fillOpacity: 0.12
    }).addTo(mapState.polygons);
    emit();
  }

  function handleDoubleClick() {
    finish();
  }

  function begin() {
    clearDraft();
    active = true;
    mapState.map.doubleClickZoom.disable();
    mapState.map.on("click", handleClick);
    finishHandler = handleDoubleClick;
    mapState.map.on("dblclick", finishHandler);
    emit();
  }

  function cancel() {
    mapState.map.off("click", handleClick);
    if (finishHandler) mapState.map.off("dblclick", finishHandler);
    finishHandler = null;
    mapState.map.doubleClickZoom.enable();
    clearDraft();
    active = false;
    emit();
  }

  function clear() {
    cancel();
    mapState.polygons.clearLayers();
    emit();
  }

  function consumeDraft() {
    if (!draft || points.length < 3) return null;

    // Persist geometry as standard GeoJSON [longitude, latitude].
    const coordinates = points.map((point) => [point.lng, point.lat]);
    if (
      coordinates.length
      && (coordinates[0][0] !== coordinates.at(-1)[0]
        || coordinates[0][1] !== coordinates.at(-1)[1])
    ) {
      coordinates.push([...coordinates[0]]);
    }

    const bounds = draft.getBounds();
    return {
      id: crypto.randomUUID(),
      type: "custom",
      name: `Özel Alan ${new Date().toLocaleString("tr-TR")}`,
      status: "service",
      geometry: {
        type: "Polygon",
        coordinates: [coordinates]
      },
      bounds: [
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()]
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  return {
    begin,
    cancel,
    clear,
    finish,
    consumeDraft,
    isActive: () => active,
    getDraft: () => draft,
    getPoints: () => points.slice()
  };
}
