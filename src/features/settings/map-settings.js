import { store } from "../../state/store.js";
import { upsertState } from "../../services/cloud.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const DEFAULTS = {
  boundaryColor: "#ffffff",
  boundaryWeight: 1.5,
  outsideColor: "#4b5563",
  outsideOpacity: 0.55,
  campaignColor: "#ffd400",
  campaignOpacity: 0.55
};

const elements = getElements();

function installStyles() {
  if (document.getElementById("mapSettingsStyles")) return;
  const style = document.createElement("style");
  style.id = "mapSettingsStyles";
  style.textContent = `
    .map-settings-form{display:grid;gap:12px;min-width:min(440px,80vw)}
    .map-settings-group{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--panel-2)}
    .map-settings-group>strong{font-size:11px;color:var(--text)}
    .settings-row,.settings-range>span{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}
    .settings-row input[type=color]{width:34px;height:24px;padding:2px;border:1px solid var(--border);border-radius:5px;background:transparent;cursor:pointer}
    .settings-range{display:grid;gap:6px}.settings-range output{color:var(--text);font-variant-numeric:tabular-nums}
    .settings-range input[type=range]{width:100%;accent-color:var(--accent)}
    .map-settings-actions{display:flex;justify-content:flex-end;gap:6px}.map-settings-actions .button{min-height:30px;font-size:11px}
    @media(max-width:720px){.map-settings-form{min-width:0}}
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

async function saveSettings(nextSettings, before) {
  store.update("mapSettings", nextSettings);
  store.recordHistory("Harita ayarları güncellendi", before, store.dataSnapshot());

  const session = store.get().auth.session;
  if (!session?.access_token) return;

  try {
    store.update("cloud", { status: "loading", error: null });
    const snapshot = store.dataSnapshot();
    const saved = await upsertState(session.access_token, {
      ...snapshot.regions,
      campaigns: snapshot.campaigns,
      history: store.get().history.entries,
      importedFiles: snapshot.importedFiles,
      mapSettings: snapshot.mapSettings
    });
    store.update("cloud", {
      status: "ready",
      version: saved?.version || Date.now(),
      updatedAt: saved?.updated_at || new Date().toISOString(),
      error: null
    });
  } catch (error) {
    console.error("[Region Console] Map settings save failed:", error);
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Harita ayarları buluta kaydedilemedi: ${error.message}`);
  }
}

function renderSettings() {
  installStyles();
  const settings = { ...DEFAULTS, ...store.get().mapSettings };
  openDialog(elements, "Harita ayarları", `
    <div class="map-settings-form">
      <div class="map-settings-group">
        <strong>Sınırlar</strong>
        <label class="settings-row"><span>Sınır rengi</span><input id="settingBoundaryColor" type="color" value="${escapeHtml(settings.boundaryColor)}"></label>
        <label class="settings-range"><span>Kalınlık <output id="settingBoundaryWeightValue">${Number(settings.boundaryWeight).toFixed(1)} px</output></span><input id="settingBoundaryWeight" type="range" min="0.5" max="8" step="0.5" value="${Number(settings.boundaryWeight)}"></label>
      </div>
      <div class="map-settings-group">
        <strong>Hizmet dışı alan</strong>
        <label class="settings-row"><span>Alan rengi</span><input id="settingOutsideColor" type="color" value="${escapeHtml(settings.outsideColor)}"></label>
        <label class="settings-range"><span>Opaklık <output id="settingOutsideOpacityValue">${percent(settings.outsideOpacity)}</output></span><input id="settingOutsideOpacity" type="range" min="0" max="1" step="0.05" value="${Number(settings.outsideOpacity)}"></label>
      </div>
      <div class="map-settings-group">
        <strong>Kampanyalı alan</strong>
        <label class="settings-row"><span>Alan rengi</span><input id="settingCampaignColor" type="color" value="${escapeHtml(settings.campaignColor)}"></label>
        <label class="settings-range"><span>Opaklık <output id="settingCampaignOpacityValue">${percent(settings.campaignOpacity)}</output></span><input id="settingCampaignOpacity" type="range" min="0" max="1" step="0.05" value="${Number(settings.campaignOpacity)}"></label>
      </div>
      <div class="map-settings-actions"><button id="resetMapSettings" class="button" type="button">Varsayılanlar</button><button id="saveMapSettings" class="button button-primary" type="button">Uygula</button></div>
    </div>
  `);

  const body = elements.dialogBody;
  const boundaryWeight = body.querySelector("#settingBoundaryWeight");
  const outsideOpacity = body.querySelector("#settingOutsideOpacity");
  const campaignOpacity = body.querySelector("#settingCampaignOpacity");

  boundaryWeight.addEventListener("input", () => {
    body.querySelector("#settingBoundaryWeightValue").textContent = `${Number(boundaryWeight.value).toFixed(1)} px`;
  });
  outsideOpacity.addEventListener("input", () => {
    body.querySelector("#settingOutsideOpacityValue").textContent = percent(outsideOpacity.value);
  });
  campaignOpacity.addEventListener("input", () => {
    body.querySelector("#settingCampaignOpacityValue").textContent = percent(campaignOpacity.value);
  });

  body.querySelector("#resetMapSettings").addEventListener("click", () => {
    body.querySelector("#settingBoundaryColor").value = DEFAULTS.boundaryColor;
    body.querySelector("#settingBoundaryWeight").value = DEFAULTS.boundaryWeight;
    body.querySelector("#settingOutsideColor").value = DEFAULTS.outsideColor;
    body.querySelector("#settingOutsideOpacity").value = DEFAULTS.outsideOpacity;
    body.querySelector("#settingCampaignColor").value = DEFAULTS.campaignColor;
    body.querySelector("#settingCampaignOpacity").value = DEFAULTS.campaignOpacity;
    body.querySelector("#settingBoundaryWeightValue").textContent = `${DEFAULTS.boundaryWeight.toFixed(1)} px`;
    body.querySelector("#settingOutsideOpacityValue").textContent = percent(DEFAULTS.outsideOpacity);
    body.querySelector("#settingCampaignOpacityValue").textContent = percent(DEFAULTS.campaignOpacity);
  });

  body.querySelector("#saveMapSettings").addEventListener("click", async () => {
    const before = store.dataSnapshot();
    const nextSettings = {
      boundaryColor: body.querySelector("#settingBoundaryColor").value,
      boundaryWeight: Number(boundaryWeight.value),
      outsideColor: body.querySelector("#settingOutsideColor").value,
      outsideOpacity: Number(outsideOpacity.value),
      campaignColor: body.querySelector("#settingCampaignColor").value,
      campaignOpacity: Number(campaignOpacity.value)
    };

    const button = body.querySelector("#saveMapSettings");
    button.disabled = true;
    button.textContent = "Kaydediliyor…";
    await saveSettings(nextSettings, before);
    elements.appDialog.close();
    toast(elements, "Harita ayarları uygulandı.");
  });
}

function installMenuItem() {
  const menu = document.getElementById("headerMenu");
  if (!menu || document.getElementById("settingsButton")) return;
  const button = document.createElement("button");
  button.id = "settingsButton";
  button.className = "header-menu-item";
  button.type = "button";
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m19 13.5 1.2 1-.9 1.6-1.5-.5a7.4 7.4 0 0 1-1.7 1l-.2 1.6h-1.9l-.5-1.5a7.5 7.5 0 0 1-2 0l-.5 1.5H9.1l-.2-1.6a7.4 7.4 0 0 1-1.7-1l-1.5.5-.9-1.6 1.2-1a7.5 7.5 0 0 1 0-2.1l-1.2-1 .9-1.6 1.5.5a7.4 7.4 0 0 1 1.7-1l.2-1.6H11l.5 1.5a7.5 7.5 0 0 1 2 0l.5-1.5h1.9l.2 1.6a7.4 7.4 0 0 1 1.7 1l1.5-.5.9 1.6-1.2 1a7.5 7.5 0 0 1 0 2.1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span>Ayarlar</span>`;
  button.addEventListener("click", () => {
    menu.hidden = true;
    document.getElementById("menuButton")?.setAttribute("aria-expanded", "false");
    renderSettings();
  });
  menu.appendChild(button);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installMenuItem, { once: true });
} else {
  installMenuItem();
}
