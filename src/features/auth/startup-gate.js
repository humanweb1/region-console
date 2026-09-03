import { store } from "../../state/store.js";
import { getElements, showStartup, releaseStartup } from "../../components/shell.js";
import { fitInitialVisibleAccess } from "../map/map.js";

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

function fitScopedMapBeforeRelease() {
  const mapState = window.__regionConsoleMapState;
  const map = mapState?.map;
  if (!map) return false;

  const container = map.getContainer?.();
  const rect = container?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;

  map.invalidateSize({ pan: false });
  return fitInitialVisibleAccess(mapState);
}

function refitMapAfterStartup() {
  const mapState = window.__regionConsoleMapState;
  const map = mapState?.map;
  if (!map) {
    if (mapRefitAttempts++ < 100) window.setTimeout(refitMapAfterStartup, 50);
    return;
  }

  if (!mapState.initialAccessFitDone) fitScopedMapBeforeRelease();
  map.invalidateSize({ pan: false });
  mapRefitAttempts = 0;
}

function updateProgress() {
  if (released) return;
  const state = store.get();
  const access = window.RegionConsoleRBAC?.access || null;
  const mapState = window.__regionConsoleMapState;
  const mapReady = Boolean(mapState?.map);
  const accessReady = Boolean(access?.loaded);
  const accessFitReady = Boolean(mapState?.initialAccessFitDone);
  const cloudReady = state.cloud?.status === "ready" || state.cloud?.status === "empty" || state.cloud?.status === "error";

  setStep("session", "done", "Oturum doğrulandı");
  setStep("access", accessReady ? "done" : "loading", accessReady ? "Yetkiler hazır" : "Yetkiler kontrol ediliyor…");
  setStep("data", cloudReady ? (state.cloud.status === "error" ? "warning" : "done") : "loading", cloudReady ? (state.cloud.status === "error" ? "Bulut verisi alınamadı; mevcut oturum açılıyor" : "Bölge verileri hazır") : "Bölge verileri hazırlanıyor…");
  setStep("map", mapReady && accessFitReady ? "done" : "loading", mapReady && accessFitReady ? "Harita hazır" : "Harita yetki alanına göre hazırlanıyor…");

  if (cloudReady && mapReady && accessReady && !accessFitReady) {
    fitScopedMapBeforeRelease();
  }

  const nextAccessFitReady = Boolean(mapState?.initialAccessFitDone);
  const status = `${accessReady}:${nextAccessFitReady}:${cloudReady}:${mapReady}:${state.cloud?.status}`;
  if (status !== lastStatus) {
    lastStatus = status;
    const completed = [accessReady, cloudReady, mapReady && nextAccessFitReady].filter(Boolean).length;
    const progress = Math.round((completed / 3) * 100);
    const progressNode = document.getElementById("startupProgress");
    if (progressNode) progressNode.style.setProperty("--startup-progress", `${progress}%`);
    const percent = document.getElementById("startupPercent");
    if (percent) percent.textContent = `${progress}%`;
  }

  if (!cloudReady || !mapReady || !accessReady || !nextAccessFitReady) return;

  released = true;
  window.RegionConsoleStartup.ready = true;
  releaseStartup(elements);
  elements.consoleView.style.visibility = "visible";
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
  lastStatus = "";
  const name = session?.user?.user_metadata?.name || session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Kullanıcı";
  const title = document.getElementById("startupTitle");
  if (title) title.textContent = `Hoş geldiniz, ${name}`;
  showStartup(elements);
  elements.consoleView.style.visibility = "hidden";

  const mapState = window.__regionConsoleMapState;
  if (mapState) mapState.initialAccessFitDone = false;
  window.requestAnimationFrame(() => {
    mapState?.map?.invalidateSize?.({ pan: false });
    updateProgress();
  });
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
