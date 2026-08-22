import { config } from "./config.js";
import { store } from "../state/store.js";
import { restoreSession, restoreRecoverySession, getRecoverySession, updatePassword, signOut, inviteSubUser } from "../services/auth.js";
import { loadState, upsertState } from "../services/cloud.js";
import { getElements, showLogin, showConsole, setCloudStatus, toast, openDialog } from "../components/shell.js";
import { renderLogin } from "../features/auth/login.js";
import { createMap, setLayer, resetView, invalidateMap, renderRegionsOnMap, fitToCoordinates } from "../features/map/map.js";
import { renderRegions } from "../features/regions/regions.js";
import { importRegionData } from "../features/regions/importer.js";
import { createDrawingController } from "../features/drawing/drawing.js";
import { bindPanels } from "../features/ui/panels.js";

const elements = getElements();
let mapState = null;
let drawing = null;
let saveTimer = null;

function allCustomRegions() {
  return store.get().regions.custom || [];
}

function countHierarchy(items, key) {
  return (items || []).reduce((sum, item) => {
    const children = Array.isArray(item[key]) ? item[key] : [];
    return sum + children.length + countHierarchy(children, key);
  }, 0);
}

function stats() {
  const state = store.get();
  const custom = allCustomRegions();
  const countries = state.regions.countries || [];
  const provinces = countHierarchy(countries, "provinces") || countHierarchy(countries, "children");
  const districts = countries.reduce((sum, country) => {
    const provincesList = country.provinces || country.children || [];
    return sum + countHierarchy(provincesList, "districts") + countHierarchy(provincesList, "children");
  }, 0);
  return {
    countries: countries.length,
    provinces,
    districts,
    area: custom.length,
    service: custom.filter((item) => item.status !== "outside").length,
    outside: custom.filter((item) => item.status === "outside").length
  };
}

function regionCoordinates(region) {
  const geometry = region?.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates?.flat() || [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates?.flat(2) || [];
  return [];
}

function bindRegionFocus() {
  elements.regionTree.querySelectorAll("[data-region-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const region = allCustomRegions().find((item) => String(item.id) === String(button.dataset.regionId));
      if (!region) return;
      const coordinates = regionCoordinates(region);
      if (coordinates.length) {
        fitToCoordinates(mapState, coordinates, [45, 45]);
      }
      store.update("regions", { selectedId: region.id });
      elements.regionTree.querySelectorAll(".region-row").forEach((row) => row.classList.remove("selected"));
      button.classList.add("selected");
      document.dispatchEvent(new CustomEvent("region-console:region-selected", {
        detail: { region, mapState }
      }));
    });
  });
}

function render() {
  const state = store.get();
  elements.versionLabel.textContent = `v${config.version}`;

  const statusMap = {
    ready: ["● Bulut bağlı · kaydedildi", "ready"],
    empty: ["● Bulut bağlı · veri yok", "empty"],
    error: ["● Bulut bağlantı hatası", "error"],
    loading: ["● Bulut kaydediliyor…", "loading"]
  };
  const status = statusMap[state.cloud.status];
  if (status) setCloudStatus(elements, status[0], status[1]);

  renderRegions(elements.regionTree, state.regions.countries, "", allCustomRegions());
  bindRegionFocus();
  const current = stats();
  elements.statCountries.textContent = current.countries;
  elements.statProvinces.textContent = current.provinces;
  elements.statDistricts.textContent = current.districts;
  elements.statArea.textContent = current.area;
  elements.statService.textContent = current.service;
  elements.statOutside.textContent = current.outside;

  if (mapState) renderRegionsOnMap(mapState, allCustomRegions());
}

async function persistState() {
  const session = store.get().auth.session;
  if (!session?.access_token) return;
  store.update("cloud", { status: "loading", error: null });
  try {
    const saved = await upsertState(session.access_token, {
      ...store.dataSnapshot().regions,
      campaigns: store.get().campaigns,
      history: store.get().history.entries,
      importedFiles: store.get().importedFiles
    });
    store.update("cloud", {
      status: "ready",
      version: saved?.version || Date.now(),
      updatedAt: saved?.updated_at || new Date().toISOString(),
      error: null
    });
  } catch (error) {
    console.error("[Region Console] Cloud save failed:", error);
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Bulut kaydı başarısız: ${error.message}`);
    throw error;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistState().catch(() => {}), 700);
}

function commitData(label, updater) {
  const before = store.dataSnapshot();
  updater();
  const after = store.dataSnapshot();
  store.recordHistory(label, before, after);
  render();
  scheduleSave();
}

function addCustomRegion(region) {
  commitData("Alan eklendi", () => {
    const custom = [...store.get().regions.custom, region];
    store.update("regions", { custom });
  });
}

function handleSave() {
  if (!drawing) return;
  const draft = drawing.consumeDraft();
  if (draft) {
    addCustomRegion(draft);
    drawing.cancel();
    elements.editBar.hidden = true;
    toast(elements, "Alan kaydedildi.");
    return;
  }
  persistState().then(() => toast(elements, "Değişiklikler buluta kaydedildi.")).catch(() => {});
}

function handleDelete() {
  if (!allCustomRegions().length) {
    toast(elements, "Silinecek özel alan yok.");
    return;
  }
  if (!window.confirm("Tüm özel çizim alanları silinsin mi? Bu işlem geri alınabilir.")) return;
  commitData("Özel alanlar temizlendi", () => {
    store.update("regions", { custom: [] });
  });
  toast(elements, "Özel alanlar temizlendi. Geri al ile kurtarabilirsiniz.");
}

function showHistory() {
  const entries = store.get().history.entries.slice().reverse();
  openDialog(elements, "Değişiklik geçmişi", entries.length
    ? `<div class="history-list">${entries.map((entry, index) => `<div class="history-item"><strong>${escapeHtml(entry.label)}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span><small>#${entries.length - index}</small></div>`).join("")}</div>`
    : `<p class="dialog-muted">Henüz kaydedilmiş bir değişiklik yok.</p>`);
}

function showCampaigns() {
  const campaigns = store.get().campaigns;
  openDialog(elements, "Kampanyalar", `<div class="dialog-toolbar"><button id="newCampaign" class="button button-primary">Yeni kampanya</button></div><div class="campaign-list">${campaigns.length ? campaigns.map((campaign) => `<article class="campaign-card"><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.status || "aktif")}</span><small>${escapeHtml(campaign.description || "Açıklama yok")}</small></article>`).join("") : `<p class="dialog-muted">Henüz kampanya yok.</p>`}</div>`);
  elements.dialogBody.querySelector("#newCampaign")?.addEventListener("click", () => {
    const name = window.prompt("Kampanya adı:");
    if (!name?.trim()) return;
    const current = store.get();
    const campaignsNext = [...current.campaigns, { id: crypto.randomUUID(), name: name.trim(), status: "active", description: "" }];
    store.update("campaigns", campaignsNext);
    render();
    scheduleSave();
    showCampaigns();
  });
}

function showUsers() {
  const users = store.get().users || [];
  openDialog(elements, "Kullanıcılar", `<div class="dialog-toolbar"><strong>${users.length} kullanıcı</strong></div><div class="user-list">${users.map((user) => `<article class="user-card"><strong>${escapeHtml(user.full_name || user.email || "Kullanıcı")}</strong><span>${escapeHtml(user.role_name || user.role || "kullanıcı")}</span></article>`).join("") || `<p class="dialog-muted">Henüz kullanıcı yok.</p>`}</div>`);
}

async function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".geojson,.json,application/geo+json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await importRegionData(file);
      const current = store.get();
      const nextRegistry = [...(current.importedFiles || []), ...(result.files || [])];
      if (result.regions?.length) {
        const before = store.dataSnapshot();
        const freshRegions = result.regions;
        const currentCustom = current.regions.custom || [];
        const existingIds = new Set(currentCustom.map((item) => String(item.id)));
        const duplicates = freshRegions.filter((item) => existingIds.has(String(item.id))).length;
        const uniqueRegions = freshRegions.filter((item) => !existingIds.has(String(item.id)));
        store.replaceData({
          regions: {
            ...current.regions,
            custom: [...currentCustom, ...uniqueRegions],
            selectedId: null
          },
          campaigns: current.campaigns,
          importedFiles: nextRegistry
        }, { recordHistory: false });
        store.recordHistory("GeoJSON içe aktarıldı", before, store.dataSnapshot());

        render();
        const coordinates = importedMapCoordinates(uniqueRegions);
        if (coordinates.length) fitToCoordinates(mapState, coordinates);

        const duplicateMessage = duplicates ? ` ${duplicates} tekrar kayıt atlandı.` : "";
        const skippedMessage = result.skippedCount ? ` ${result.skippedCount} geçersiz geometri atlandı.` : "";
        scheduleSave();
        toast(elements, `${uniqueRegions.length} bölge içe aktarıldı.${duplicateMessage}${skippedMessage}`);
        return;
      }

      render();
      const coordinates = importedMapCoordinates(store.get().regions.custom);
      if (coordinates.length) fitToCoordinates(mapState, coordinates);
      scheduleSave();
      toast(elements, `${result.importedCount} kayıt içe aktarıldı.`);
    } catch (error) {
      console.error("[Region Console] Import failed:", error);
      toast(elements, `İçe aktarma başarısız: ${error.message || "Bilinmeyen hata"}`);
    }
  };
  input.click();
}

async function startApplication(session) {
  store.update("auth", { status: "authenticated", session, user: session.user || null });
  showConsole(elements);

  if (!mapState) {
    mapState = createMap();
    drawing = createDrawingController(mapState, ({ active, points = [] }) => {
      elements.editBar.hidden = !active && points.length < 3;
      elements.selectedArea.textContent = `${points.length} nokta`;
    });
    bindPanels(elements, mapState, drawing, {
      onLayer: (name) => setLayer(mapState, name),
      onResetMap: () => resetView(mapState),
      onTheme: toggleTheme,
      onLogout: logout,
      onUndo: () => { if (store.undo()) { render(); scheduleSave(); } },
      onRedo: () => { if (store.redo()) { render(); scheduleSave(); } },
      onSave: handleSave,
      onCampaigns: showCampaigns,
      onUsers: showUsers,
      onSearch: (query) => { renderRegions(elements.regionTree, store.get().regions.countries, query, allCustomRegions()); bindRegionFocus(); },
      onTool: (tool) => {
        if (tool === "draw") drawing.begin();
        if (tool === "delete") handleDelete();
        if (tool === "history") showHistory();
        if (tool === "import") importData();
        if (tool === "export") exportData();
        if (tool === "settings") showUsers();
        if (tool === "edit") toast(elements, "Düzenlemek için önce bir alan seçin.");
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") drawing?.cancel();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo(); else store.undo();
        render();
        scheduleSave();
      }
    });
    window.addEventListener("resize", () => invalidateMap(mapState), { passive: true });
  }

  store.update("cloud", { status: "loading", error: null });
  render();

  try {
    const remote = await loadState(session.access_token);
    if (remote?.state) {
      store.loadPersisted(remote.state);
      store.update("cloud", { status: "ready", version: remote.version || null, updatedAt: remote.updated_at || null, error: null });
      renderRegionsOnMap(mapState, allCustomRegions());
      const coordinates = importedMapCoordinates(allCustomRegions());
      if (coordinates.length) fitToCoordinates(mapState, coordinates);
    } else {
      store.update("cloud", { status: "empty" });
    }
  } catch (error) {
    console.error("[Region Console] Cloud load failed:", error);
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Bulut verisi yüklenemedi: ${error.message}`);
  }
  render();
  invalidateMap(mapState);
}

async function logout() {
  await signOut();
  store.reset();
  elements.editBar.hidden = true;
  showLogin(elements);
  toast(elements, "Oturum kapatıldı.");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("region-console-theme", next);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function showPasswordReset(elements, recoverySession) {
  const view = elements.loginView;
  view.hidden = false;
  view.innerHTML = `<div class="login-card password-reset-card"><div class="login-brand">Region Console</div><p>Hesabınız için yeni bir şifre belirleyin.</p><form id="passwordResetForm"><label>Yeni şifre<input id="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Yeni şifre tekrar<input id="newPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required></label><p id="passwordResetError" class="form-error" hidden></p><button id="passwordResetButton" class="button button-primary" type="submit">Şifreyi güncelle</button></form></div>`;
  const form = view.querySelector("#passwordResetForm");
  const password = view.querySelector("#newPassword");
  const confirm = view.querySelector("#newPasswordConfirm");
  const error = view.querySelector("#passwordResetError");
  const button = view.querySelector("#passwordResetButton");
  if (!recoverySession?.user) { error.textContent = "Şifre sıfırlama oturumu geçersiz."; error.hidden = false; button.disabled = true; return; }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (password.value !== confirm.value) { error.textContent = "Şifreler eşleşmiyor."; error.hidden = false; return; }
    button.disabled = true;
    try {
      await updatePassword(recoverySession.access_token, password.value);
      sessionStorage.removeItem("region-console-recovery-session");
      toast(elements, "Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.");
      renderLogin(view);
    } catch (updateError) {
      error.textContent = updateError.message || "Şifre güncellenemedi.";
      error.hidden = false;
      button.disabled = false;
    }
  });
}

function importedMapCoordinates(regions) {
  return (regions || []).flatMap((region) => regionCoordinates(region));
}

async function exportData() {
  const state = store.dataSnapshot();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `region-console-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function boot() {
  const recoverySession = getRecoverySession();
  if (recoverySession) {
    showPasswordReset(elements, recoverySession);
    return;
  }
  renderLogin(elements.loginView);
  const session = await restoreSession();
  if (session) {
    await startApplication(session);
    return;
  }
  showLogin(elements);
}

restoreRecoverySession();
boot().catch((error) => {
  console.error("[Region Console] Boot failed:", error);
  showLogin(elements);
});
