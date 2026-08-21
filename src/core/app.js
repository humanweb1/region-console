import { config } from "./config.js";

import { store } from "../state/store.js";

import {
  restoreSession,
  restoreRecoverySession,
  getRecoverySession,
  updatePassword,
  signOut
} from "../services/auth.js";

import { loadState } from "../services/cloud.js";

import {
  getElements,
  showLogin,
  showConsole,
  setCloudStatus,
  toast
} from "../components/shell.js";

import { renderLogin } from "../features/auth/login.js";

import {
  createMap,
  setLayer,
  resetView,
  invalidateMap
} from "../features/map/map.js";

import { renderRegions } from "../features/regions/regions.js";

import {
  createDrawingController
} from "../features/drawing/drawing.js";

import { bindPanels } from "../features/ui/panels.js";

const elements = getElements();

let mapState = null;
let drawing = null;

function render() {
  const state = store.get();

  elements.versionLabel.textContent =
    `v${config.version}`;

  if (state.cloud.status === "ready") {
    setCloudStatus(
      elements,
      "● Bulut bağlı · kaydedildi",
      "ready"
    );
  } else if (state.cloud.status === "empty") {
    setCloudStatus(
      elements,
      "● Bulut bağlı · veri yok",
      "empty"
    );
  } else if (state.cloud.status === "error") {
    setCloudStatus(
      elements,
      "● Bulut bağlantı hatası",
      "error"
    );
  }

  renderRegions(
    elements.regionTree,
    state.regions.countries
  );

  elements.statCountries.textContent =
    state.regions.countries.length;

  elements.statProvinces.textContent = "0";
  elements.statDistricts.textContent = "0";
  elements.statArea.textContent = "0";
  elements.statService.textContent = "0";
  elements.statOutside.textContent = "0";
}

async function startApplication(session) {
  store.update("auth", {
    status: "authenticated",
    session,
    user: session.user || null
  });

  showConsole(elements);

  if (!mapState) {
    mapState = createMap();

    drawing = createDrawingController(
      mapState,
      ({ active }) => {
        elements.editBar.hidden = !active;
      }
    );

    bindPanels(elements, mapState, drawing, {
      onLayer: (name) => {
        setLayer(mapState, name);
      },

      onResetMap: () => {
        resetView(mapState);
      },

      onTheme: toggleTheme,

      onLogout: logout,

      onSearch: (query) => {
        renderRegions(
          elements.regionTree,
          store.get().regions.countries,
          query
        );
      },

      onTool: (tool) => {
        if (tool === "draw") {
          drawing.begin();
        }

        if (tool === "delete") {
          drawing.clear();
        }
      }
    });

    window.addEventListener(
      "resize",
      () => invalidateMap(mapState),
      { passive: true }
    );
  }

  store.update("cloud", {
    status: "loading",
    error: null
  });

  render();

  try {
    const remote = await loadState(
      session.access_token
    );

    if (remote?.state) {
      const state = remote.state;

      store.update("regions", {
        countries: Array.isArray(state.countries)
          ? state.countries
          : [],

        custom: Array.isArray(state.custom)
          ? state.custom
          : [],

        selectedId: null
      });

      store.update("cloud", {
        status: "ready",
        version: remote.version || null,
        error: null
      });
    } else {
      store.update("cloud", {
        status: "empty"
      });
    }
  } catch (error) {
    console.error(
      "[Region Console] Cloud load failed:",
      error
    );

    store.update("cloud", {
      status: "error",
      error: error.message
    });

    toast(
      elements,
      `Bulut verisi yüklenemedi: ${error.message}`
    );
  }

  render();
  invalidateMap(mapState);
}

async function logout() {
  await signOut();

  store.reset();

  elements.editBar.hidden = true;

  showLogin(elements);

  toast(
    elements,
    "Oturum kapatıldı."
  );
}

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "light"
      ? "dark"
      : "light";

  document.documentElement.dataset.theme = next;

  localStorage.setItem(
    "region-console-theme",
    next
  );
}

/**
 * Şifre sıfırlama ekranını oluşturur.
 *
 * Mevcut login component'ine dokunmuyoruz.
 * Recovery sırasında loginView içeriğini geçici olarak
 * reset ekranıyla değiştiriyoruz.
 */
function showPasswordReset(elements, recoverySession) {
  const view = elements.loginView;

  view.hidden = false;

  view.innerHTML = `
    <div class="login-card password-reset-card">
      <div class="login-brand">
        <h1>Region Console</h1>
        <p>Hesabınız için yeni bir şifre belirleyin.</p>
      </div>

      <form id="passwordResetForm" novalidate>
        <label class="field">
          <span>Yeni şifre</span>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            placeholder="En az 8 karakter"
          >
        </label>

        <label class="field">
          <span>Yeni şifre tekrar</span>
          <input
            id="newPasswordConfirm"
            name="newPasswordConfirm"
            type="password"
            autocomplete="new-password"
            minlength="8"
            required
            placeholder="Şifrenizi tekrar girin"
          >
        </label>

        <p
          id="passwordResetError"
          class="form-error"
          hidden
          role="alert"
        ></p>

        <button
          id="passwordResetButton"
          class="button button-primary"
          type="submit"
        >
          Şifreyi güncelle
        </button>
      </form>
    </div>
  `;

  const form = view.querySelector(
    "#passwordResetForm"
  );

  const passwordInput = view.querySelector(
    "#newPassword"
  );

  const confirmInput = view.querySelector(
    "#newPasswordConfirm"
  );

  const errorElement = view.querySelector(
    "#passwordResetError"
  );

  const button = view.querySelector(
    "#passwordResetButton"
  );

  if (!recoverySession?.user) {
    errorElement.textContent =
      "Şifre sıfırlama oturumu geçersiz.";

    errorElement.hidden = false;

    button.disabled = true;

    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    errorElement.hidden = true;
    errorElement.textContent = "";

    const password = passwordInput.value;
    const confirmation = confirmInput.value;

    if (password.length < 8) {
      errorElement.textContent =
        "Şifre en az 8 karakter olmalıdır.";

      errorElement.hidden = false;

      return;
    }

    if (password !== confirmation) {
      errorElement.textContent =
        "Şifreler aynı değil.";

      errorElement.hidden = false;

      return;
    }

    button.disabled = true;
    button.textContent = "Güncelleniyor…";

    try {
      await updatePassword(password);

      sessionStorage.removeItem(
        "region-console-recovery"
      );

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );

      showLogin(elements);

      toast(
        elements,
        "Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz."
      );
    } catch (error) {
      console.error(
        "[Region Console] Password reset failed:",
        error
      );

      errorElement.textContent =
        error.message ||
        "Şifre güncellenemedi.";

      errorElement.hidden = false;

      button.disabled = false;
      button.textContent = "Şifreyi güncelle";
    }
  });
}

async function bootstrap() {
  document.documentElement.dataset.theme =
    localStorage.getItem(
      "region-console-theme"
    ) || "dark";

  store.subscribe(render);

  /*
   * ÖNCE recovery kontrolü.
   *
   * Bunun restoreSession() öncesinde yapılması kritik.
   * Aksi halde recovery linki normal login akışına düşer.
   */
  try {
    const recoverySession =
      await restoreRecoverySession();

    if (recoverySession) {
      showPasswordReset(
        elements,
        recoverySession
      );

      return;
    }
  } catch (error) {
    console.error(
      "[Region Console] Recovery session failed:",
      error
    );

    showLogin(elements);

    toast(
      elements,
      error.message ||
        "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş."
    );

    return;
  }

  /*
   * Hash temizlenmiş ama sessionStorage'da
   * recovery session varsa onu da kontrol ediyoruz.
   */
  try {
    const existingRecovery =
      await getRecoverySession();

    if (existingRecovery) {
      showPasswordReset(
        elements,
        existingRecovery
      );

      return;
    }
  } catch (error) {
    console.error(
      "[Region Console] Recovery restore failed:",
      error
    );

    sessionStorage.removeItem(
      "region-console-recovery"
    );
  }

  renderLogin(
    elements.loginView,
    startApplication
  );

  try {
    const session =
      await restoreSession();

    if (session) {
      await startApplication(session);
    } else {
      showLogin(elements);

      store.update("auth", {
        status: "anonymous"
      });
    }
  } catch (error) {
    console.error(
      "[Region Console] Bootstrap failed:",
      error
    );

    showLogin(elements);
  }
}

bootstrap();