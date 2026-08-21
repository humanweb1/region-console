import { config } from "./config.js";
import { store } from "../state/store.js";
import { restoreSession, restoreRecoverySession, getRecoverySession, updatePassword, signOut, inviteSubUser } from "../services/auth.js";
import { loadState, upsertState } from "../services/cloud.js";
import { getElements, showLogin, showConsole, setCloudStatus, toast, openDialog } from "../components/shell.js";
import { renderLogin } from "../features/auth/login.js";
import { createMap, setLayer, resetView, invalidateMap, renderRegionsOnMap, fitToCoordinates } from "../features/map/map.js";
import { renderRegions } from "../features/regions/regions.js";
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

  renderRegions(elements.regionTree, state.regions.countries);
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
      history: store.get().history.entries
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
    const description = window.prompt("Kampanya açıklaması:") || "";
    commitData("Kampanya oluşturuldu", () => {
      store.set({ campaigns: [...store.get().campaigns, { id: crypto.randomUUID(), name: name.trim(), description, status: "aktif", createdAt: new Date().toISOString() }] });
    });
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
      await inviteSubUser(session?.access_token, {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        role: String(formData.get("role") || "sub_user")
      });
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

function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported?.regions) throw new Error("Geçersiz Region Console JSON dosyası.");
      const before = store.dataSnapshot();
      store.set({ regions: imported.regions, campaigns: Array.isArray(imported.campaigns) ? imported.campaigns : store.get().campaigns });
      store.recordHistory("JSON içe aktarıldı", before, store.dataSnapshot());
      render();
      scheduleSave();
      toast(elements, "Veri içe aktarıldı.");
    } catch (error) {
      toast(elements, `İçe aktarma başarısız: ${error.message}`);
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
      onSearch: (query) => renderRegions(elements.regionTree, store.get().regions.countries, query),
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
      const coordinates = allCustomRegions().flatMap((region) => region.geometry?.coordinates?.[0]?.map(([lat, lng]) => [lat, lng]) || []);
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
    if (password.value.length < 8) { error.textContent = "Şifre en az 8 karakter olmalıdır."; error.hidden = false; return; }
    if (password.value !== confirm.value) { error.textContent = "Şifreler aynı değil."; error.hidden = false; return; }
    button.disabled = true;
    button.textContent = "Güncelleniyor…";
    try {
      await updatePassword(password.value);
      sessionStorage.removeItem("region-console-recovery");
      window.history.replaceState({}, document.title, window.location.pathname);
      showLogin(elements);
      renderLogin(elements.loginView, startApplication);
      toast(elements, "Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz.");
    } catch (err) {
      error.textContent = err.message || "Şifre güncellenemedi.";
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Şifreyi güncelle";
    }
  });
}

async function bootstrap() {
  document.documentElement.dataset.theme = localStorage.getItem("region-console-theme") || "dark";
  store.subscribe(render);

  try {
    const recoverySession = await restoreRecoverySession();
    if (recoverySession) return showPasswordReset(elements, recoverySession);
  } catch (error) {
    showLogin(elements);
    toast(elements, error.message || "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş.");
    return;
  }

  try {
    const existingRecovery = await getRecoverySession();
    if (existingRecovery) return showPasswordReset(elements, existingRecovery);
  } catch {
    sessionStorage.removeItem("region-console-recovery");
  }

  renderLogin(elements.loginView, startApplication);
  try {
    const session = await restoreSession();
    if (session) await startApplication(session);
    else {
      showLogin(elements);
      store.update("auth", { status: "anonymous" });
    }
  } catch (error) {
    console.error("[Region Console] Bootstrap failed:", error);
    showLogin(elements);
  }
}

bootstrap();
