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
import { openRegionActions } from "../features/regions/region-actions.js";

const elements = getElements();
let mapState = null;
let drawing = null;
let saveTimer = null;

function allCustomRegions() {
  return store.get().regions.custom || [];
}

document.addEventListener("region-console:region-selected", (event) => {
  const { region, mapState: selectedMapState } = event.detail || {};
  if (!region || !selectedMapState) return;
  openRegionActions(region, selectedMapState);
});

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
    service: custom.filter((item) => item.status !== "outside" && item.status !== "closed").length,
    outside: custom.filter((item) => item.status === "outside" || item.status === "closed").length
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
      if (coordinates.length) fitToCoordinates(mapState, coordinates, [45, 45]);
      store.update("regions", { selectedId: region.id });
      elements.regionTree.querySelectorAll(".region-row").forEach((row) => row.classList.remove("selected"));
      button.classList.add("selected");
      document.dispatchEvent(new CustomEvent("region-console:region-selected", { detail: { region, mapState } }));
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
      importedFiles: store.get().importedFiles,
      mapSettings: store.get().mapSettings
    });
    store.update("cloud", { status: "ready", version: saved?.version || Date.now(), updatedAt: saved?.updated_at || new Date().toISOString(), error: null });
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
  commitData("Alan eklendi", () => store.update("regions", { custom: [...store.get().regions.custom, region] }));
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
  if (!allCustomRegions().length) return toast(elements, "Silinecek özel alan yok.");
  if (!window.confirm("Tüm özel çizim alanları silinsin mi? Bu işlem geri alınabilir.")) return;
  commitData("Özel alanlar temizlendi", () => store.update("regions", { custom: [] }));
  toast(elements, "Özel alanlar temizlendi. Geri al ile kurtarabilirsiniz.");
}

function showHistory() {
  const entries = store.get().history.entries.slice().reverse();
  openDialog(elements, "Değişiklik geçmişi", entries.length ? `<div class="history-list">${entries.map((entry, index) => `<div class="history-item"><strong>${escapeHtml(entry.label)}</strong><span>${new Date(entry.createdAt).toLocaleString("tr-TR")}</span><small>#${entries.length - index}</small></div>`).join("")}</div>` : `<p class="dialog-muted">Henüz kaydedilmiş bir değişiklik yok.</p>`);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function showCampaigns() {
  const campaigns = store.get().campaigns;
  openDialog(elements, "Kampanyalar", `<div class="dialog-toolbar"><button id="newCampaign" class="button button-primary">Yeni kampanya</button></div><div class="campaign-list">${campaigns.length ? campaigns.map((campaign) => `<article class="campaign-card"><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.status || "aktif")}</span><small>${escapeHtml(campaign.description || "Açıklama yok")}</small></article>`).join("") : `<p class="dialog-muted">Henüz kampanya yok.</p>`}</div>`);
  elements.dialogBody.querySelector("#newCampaign")?.addEventListener("click", () => {
    const name = window.prompt("Kampanya adı:");
    if (!name?.trim()) return;
    const description = window.prompt("Kampanya açıklaması:") || "";
    commitData("Kampanya oluşturuldu", () => store.set({ campaigns: [...store.get().campaigns, { id: crypto.randomUUID(), name: name.trim(), description, status: "aktif", createdAt: new Date().toISOString() }] }));
    showCampaigns();
  });
}

function showUsers() {
  openDialog(elements, "Alt kullanıcı oluştur", `<p class="dialog-muted">Yönetici hesabından güvenli davet gönderin. Davet işlemi Supabase Edge Function üzerinden service-role anahtarını tarayıcıya açmadan yapılır.</p><form id="inviteUserForm" class="dialog-form"><label>Ad<input name="name" required></label><label>E-posta<input name="email" type="email" required></label><label>Rol<select name="role"><option value="sub_user">Alt kullanıcı</option><option value="viewer">Görüntüleyici</option></select></label><button class="button button-primary" type="submit">Davet gönder</button><p id="inviteUserError" class="form-error"></p></form>`);
  elements.dialogBody.querySelector("#inviteUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector("#inviteUserError");
    error.textContent = "";
    const session = store.get().auth.session;
    const formData = new FormData(form);
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await inviteSubUser(session?.access_token, { name: String(formData.get("name") || "").trim(), email: String(formData.get("email") || "").trim(), role: String(formData.get("role") || "sub_user") });
      elements.appDialog.close();
      toast(elements, "Alt kullanıcı daveti gönderildi.");
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(store.dataSnapshot(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `region-console-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importedMapCoordinates(regions) {
  return (regions || []).flatMap((region) => {
    const geometry = region?.geometry;
    if (!geometry) return [];
    if (geometry.type === "Polygon") return geometry.coordinates?.flat() || [];
    if (geometry.type === "MultiPolygon") return geometry.coordinates?.flat(2) || [];
    return [];
  });
}

function restoreRegionsSidebar(wasOpen) {
  if (!wasOpen || !elements.sidebar) return;
  elements.sidebar.hidden = false;
  elements.regionsToggle?.setAttribute("aria-expanded", "true");
}

function importData() {
  const sidebarWasOpen = elements.sidebar ? !elements.sidebar.hidden : false;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.geojson,application/json,application/geo+json,text/json";
  input.multiple = false;
  input.oncancel = () => restoreRegionsSidebar(sidebarWasOpen);
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return restoreRegionsSidebar(sidebarWasOpen);
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("Dosya boş.");
      let imported;
      try { imported = JSON.parse(text); } catch { throw new Error("Dosya geçerli JSON değil."); }
      const result = importRegionData(imported, file.name);
      const before = store.dataSnapshot();
      if (result.mode === "region-console") {
        store.replaceData({ regions: result.regions, campaigns: result.campaigns }, { recordHistory: false });
        store.recordHistory("Region Console JSON içe aktarıldı", before, store.dataSnapshot());
      } else {
        const current = store.get();
        const currentCustom = Array.isArray(current.regions.custom) ? current.regions.custom : [];
        const existingKeys = new Set(currentCustom.map((region) => region?.importMeta?.sourceId).filter((value) => value !== undefined && value !== null).map(String));
        const freshRegions = result.regions.custom.filter((region) => !existingKeys.has(String(region.importMeta?.sourceId)));
        const duplicates = result.importedCount - freshRegions.length;
        const importedAt = new Date().toISOString();
        const registry = Array.isArray(current.importedFiles) ? current.importedFiles : [];
        const nextRegistry = [...registry.filter((item) => String(item?.name) !== String(file.name)), { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type || "application/geo+json", importedAt, regionCount: freshRegions.length }];
        freshRegions.forEach((region) => { region.importMeta = { ...(region.importMeta || {}), sourceFile: file.name, importedAt }; });
        store.replaceData({ regions: { ...current.regions, custom: [...currentCustom, ...freshRegions], selectedId: null }, campaigns: current.campaigns, importedFiles: nextRegistry }, { recordHistory: false });
        store.recordHistory("GeoJSON içe aktarıldı", before, store.dataSnapshot());
        render();
        const coordinates = importedMapCoordinates(freshRegions);
        if (coordinates.length) fitToCoordinates(mapState, coordinates);
        const duplicateMessage = duplicates ? ` ${duplicates} tekrar kayıt atlandı.` : "";
        const skippedMessage = result.skippedCount ? ` ${result.skippedCount} geçersiz geometri atlandı.` : "";
        scheduleSave();
        restoreRegionsSidebar(sidebarWasOpen);
        toast(elements, `${freshRegions.length} bölge içe aktarıldı.${duplicateMessage}${skippedMessage}`);
        return;
      }
      render();
      const coordinates = importedMapCoordinates(store.get().regions.custom);
      if (coordinates.length) fitToCoordinates(mapState, coordinates);
      scheduleSave();
      restoreRegionsSidebar(sidebarWasOpen);
      toast(elements, `${result.importedCount} kayıt içe aktarıldı.`);
    } catch (error) {
      restoreRegionsSidebar(sidebarWasOpen);
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

async function bootstrap() {
  try {
    const recovery = await restoreRecoverySession();
    if (recovery) {
      const password = window.prompt("Yeni şifrenizi girin:");
      if (password) {
        await updatePassword(password);
        sessionStorage.removeItem("region-console-recovery");
        toast(elements, "Şifreniz güncellendi. Giriş yapabilirsiniz.");
      }
    }
  } catch (error) {
    console.error("[Region Console] Recovery bootstrap failed:", error);
  }

  try {
    const session = await restoreSession();
    if (session) {
      await startApplication(session);
      return;
    }
  } catch (error) {
    console.error("[Region Console] Session restore failed:", error);
  }

  showLogin(elements);
  renderLogin(elements.loginView, startApplication);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
