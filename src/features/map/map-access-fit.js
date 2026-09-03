import { store } from "../../state/store.js";
import { fitInitialVisibleAccess } from "./map.js";

let scheduled = false;
let attempts = 0;

function fitWhenReady() {
  const mapState = window.__regionConsoleMapState;
  if (!mapState?.map) return false;
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
  if (mapState) mapState.initialAccessFitDone = false;
  attempts = 0;
  scheduleFit();
});

store.subscribe(() => {
  const mapState = window.__regionConsoleMapState;
  if (!mapState || mapState.initialAccessFitDone) return;
  scheduleFit();
});

scheduleFit();
