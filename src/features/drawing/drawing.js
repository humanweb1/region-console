export function createDrawingController(mapState, onChange) {
  let active = false;
  let draft = null;

  function begin() {
    active = true;
    onChange({ active, draft });
  }

  function cancel() {
    active = false;
    if (draft) {
      mapState.polygons.removeLayer(draft);
      draft = null;
    }
    onChange({ active, draft });
  }

  function clear() {
    mapState.polygons.clearLayers();
    draft = null;
    onChange({ active, draft });
  }

  return {
    begin,
    cancel,
    clear,
    isActive: () => active,
    getDraft: () => draft
  };
}
