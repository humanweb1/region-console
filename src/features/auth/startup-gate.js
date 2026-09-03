import { store } from "../../state/store.js";
import { getElements, showStartup, releaseStartup } from "../../components/shell.js";

const elements = getElements();
let released = false;
let sessionStartedAt = 0;
let lastStatus = "";
let mapRefitAttempts = 0;

window.RegionConsoleStartup = window.RegionConsoleStartup || {};
window.RegionConsoleStartup.ready = false;

function setStep(step, state = "loading", detail = "") {
  const node = document.querySelector(`[data-startup-step="${step}"]`);
  if (!node) return;
  node.dataset.state = state;
  const detailNode = node.querySelector("[data-startup-detail]");
  if (detailNode && detail) detailNode.textContent = detail;
}

function refitMapAfterStartup() {
  const mapState = window.__regionConsoleMapState;
  const map = mapState?.map;
  if (!map) {
    if (mapRefitAttempts++ < 100) window.setTimeout(refitMapAfterStartup, 50);
    return;
  }

  const container = map.getContainer?.();
  const rect = container?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    if (mapRefitAttempts++ < 100) window.setTimeout(refitMapAfterStartup, 50);
    return;
  }

  const layers = (mapState.regionLayers || []).filter((layer) => layer?.getBounds?.()?.isValid?.());
  map.invalidateSize({ pan: false });
  if (!layers.length) {
    mapRefitAttempts = 0;
    return;
  }

  const bounds = L.latLngBounds([]);
  layers.forEach((layer) => bounds.extend(layer.getBounds()));
  if (!bounds.isValid()) return;

  map.fitBounds(bounds, {
    padding: [42, 42],
    maxZoom: 13,
    animate: false
  });
  mapState.initialAccessFitDone = true;
  mapRefitAttempts = 0;
}

function updateProgress() {
  if (released) return;
  const state = store.get();
  const access = window.RegionConsoleRBAC?.access || null;
  const mapReady = Boolean(window.__regionConsoleMapState?.map);
  const cloudReady = state.cloud?.status === "ready" || state.cloud?.status === "empty" || state.cloud?.status === "error";
  const accessReady = Boolean(access?.loaded);

  setStep("session", "done", "Oturum doğrulandı");
  setStep("access", accessReady ? "done" : "loading", accessReady ? "Yetkiler hazır" : "Yetkiler arka planda hazırlanıyor…");
  setStep("data", cloudReady ? (state.cloud.status === "error" ? "warning" : "done") : "loading", cloudReady ? (state.cloud.status === "error" ? "Bulut verisi alınamadı; mevcut oturum açılıyor" : "Bölge verileri hazır") : "Bölge verileri hazırlanıyor…");
  setStep("map", mapReady ? "done" : "loading", mapReady ? "Harita hazır" : "Harita hazırlanıyor…");

  const status = `${accessReady}:${cloudReady}:${mapReady}:${state.cloud?.status}`;
  if (status !== lastStatus) {
    lastStatus = status;
    const completed = [accessReady, cloudReady, mapReady].filter(Boolean).length;
    const progress = Math.round((completed / 3) * 100);
    const progressNode = document.getElementById("startupProgress");
    if (progressNode) progressNode.style.setProperty("--startup-progress", `${progress}%`);
    const percent = document.getElementById("startupPercent");
    if (percent) percent.textContent = `${progress}%`;
  }

  // Cloud data and the map instance are the hard startup requirements. RBAC continues
  // in the background so a slow permission request cannot leave the user on a blank page.
  if (!cloudReady || !mapReady) return;
  released = true;
  window.RegionConsoleStartup.ready = true;
  releaseStartup(elements);
  mapRefitAttempts = 0;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(refitMapAfterStartup);
  });
}

window.RegionConsoleStartup.begin = (session) => {
  sessionStartedAt = Date.now();
  released = false;
  window.RegionConsoleStartup.ready = false;
  mapRefitAttempts = 0;
  const name = session?.user?.user_metadata?.name || session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Kullanıcı";
  const title = document.getElementById("startupTitle");
  if (title) title.textContent = `Hoş geldiniz, ${name}`;
  showStartup(elements);
  updateProgress();
};

window.RegionConsoleStartup.abort = () => {
  released = true;
  window.RegionConsoleStartup.ready = false;
};

store.subscribe(updateProgress);
window.addEventListener("region-console:rbac-updated", updateProgress);
window.addEventListener("region-console:rbac-error", updateProgress);
window.addEventListener("load", updateProgress, { once: true });

setStep("session", "loading", "Oturum bekleniyor…");
if (sessionStartedAt) updateProgress();
