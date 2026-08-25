export function createDrawingController(mapState, onChange) {
  let active = false;
  let draft = null;
  let points = [];
  let cursorPoint = null;
  let cursorLine = null;
  let finishHandler = null;
  let clickTimer = null;
  const pointMarkers = L.layerGroup().addTo(mapState.map);

  function emit() {
    onChange({
      active,
      draft,
      points: points.slice(),
      cursorPoint,
      area: draft ? L.GeometryUtil?.geodesicArea?.(draft.getLatLngs()[0]) || 0 : 0
    });
  }

  function clearClickTimer() {
    if (clickTimer) {
      window.clearTimeout(clickTimer);
      clickTimer = null;
    }
  }

  function clearCursorLine() {
    if (cursorLine) {
      mapState.polygons.removeLayer(cursorLine);
      cursorLine = null;
    }
  }

  function renderPointMarkers() {
    pointMarkers.clearLayers();
    points.forEach((point, index) => {
      const number = index + 1;
      const marker = L.marker(point, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "draw-point-marker-wrap",
          html: `<span class="draw-point-marker" aria-hidden="true">${number}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      });
      marker.bindTooltip(`Nokta ${number}`, { direction: "top", offset: [0, -10], opacity: 0.9 });
      pointMarkers.addLayer(marker);
    });
  }

  function clearDraft() {
    clearClickTimer();
    clearCursorLine();
    if (draft) mapState.polygons.removeLayer(draft);
    pointMarkers.clearLayers();
    draft = null;
    points = [];
    cursorPoint = null;
  }

  function renderDraft() {
    if (draft) mapState.polygons.removeLayer(draft);
    if (points.length < 2) {
      draft = null;
      renderPointMarkers();
      emit();
      return;
    }
    draft = L.polygon(points, {
      color: "#ffd400",
      weight: 3,
      dashArray: "6 6",
      fillOpacity: points.length >= 3 ? 0.12 : 0
    }).addTo(mapState.polygons);
    renderPointMarkers();
    emit();
  }

  function renderCursorLine() {
    clearCursorLine();
    if (!active || !cursorPoint || !points.length) return;
    cursorLine = L.polyline([points[points.length - 1], cursorPoint], {
      color: "#ffd400",
      weight: 2,
      dashArray: "4 5",
      opacity: 0.9,
      interactive: false
    }).addTo(mapState.polygons);
  }

  function handleMouseMove(event) {
    if (!active) return;
    cursorPoint = event.latlng;
    renderCursorLine();
    emit();
  }

  function finish() {
    clearClickTimer();
    if (points.length < 3) return false;
    clearCursorLine();
    if (draft) mapState.polygons.removeLayer(draft);
    draft = L.polygon(points, {
      color: "#ffd400",
      weight: 3,
      fillOpacity: 0.28
    }).addTo(mapState.polygons);
    points = draft.getLatLngs()[0].slice();
    active = false;
    cursorPoint = null;
    mapState.map.doubleClickZoom.enable();
    mapState.map.off("mousemove", handleMouseMove);
    if (finishHandler) mapState.map.off("dblclick", finishHandler);
    finishHandler = null;
    renderPointMarkers();
    emit();
    return true;
  }

  function addPoint(event) {
    if (!active) return;
    points.push(event.latlng);
    cursorPoint = event.latlng;
    renderDraft();
    renderCursorLine();
  }

  function handleClick(event) {
    if (!active) return;
    clearClickTimer();
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      addPoint(event);
    }, 180);
  }

  function handleDoubleClick() {
    clearClickTimer();
    finish();
  }

  function begin() {
    clearDraft();
    active = true;
    mapState.map.doubleClickZoom.disable();
    mapState.map.on("click", handleClick);
    mapState.map.on("mousemove", handleMouseMove);
    finishHandler = handleDoubleClick;
    mapState.map.on("dblclick", finishHandler);
    emit();
  }

  function cancel() {
    clearClickTimer();
    mapState.map.off("click", handleClick);
    mapState.map.off("mousemove", handleMouseMove);
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
