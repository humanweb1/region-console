import { store } from "../../state/store.js";
import { fitInitialVisibleAccess } from "./map.js";

let scheduled = false;
let attempts = 0;

function ensureMaskPaneOrder(mapState) {
  const pane = mapState?.map?.getPane?.("region-mask");
  if (!pane) return false;
  // The mask must sit above transparent region polygons. Otherwise the
  // polygon layer cannot visually reveal the map through the mask holes.
  pane.style.zIndex = "450";
  pane.style.pointerEvents = "none";
  return true;
}

function fitWhenReady() {
  const mapState = window.__regionConsoleMapState;
  if (!mapState?.map) return false;
  ensureMaskPaneOrder(mapState);
  if (mapState.initialAccessFitDone) return true;
  return fitInitialVisibleAccess(mapState);
}

function scheduleFit() {
  if (scheduled) return;
  scheduled = true;
  attempts += 1;
  setTimeout(() => {
    scheduled = false;
    if (fitWhenReady()) {
      attempts = 0;
      return;
    }
    if (attempts < 40) scheduleFit();
  }, 50);
}

window.addEventListener("region-console:rbac-updated", () => {
  const mapState = window.__regionConsoleMapState;
  if (mapState) {
    mapState.initialAccessFitDone = false;
    ensureMaskPaneOrder(mapState);
  }
  attempts = 0;
  scheduleFit();
});

store.subscribe(() => {
  const mapState = window.__regionConsoleMapState;
  if (!mapState) return;
  ensureMaskPaneOrder(mapState);
  if (mapState.initialAccessFitDone) return;
  scheduleFit();
});

scheduleFit();
