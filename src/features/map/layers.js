import { getElements, openDialog } from "../../components/shell.js";

const layerDefinitions = [
  { key: "country", label: "Ülke", icon: "▱" },
  { key: "province", label: "İl", icon: "⌂" },
  { key: "district", label: "İlçe", icon: "⌑" },
  { key: "neighborhood", label: "Mahalle", icon: "⌗" },
  { key: "cemetery", label: "Mezarlık", icon: "†" },
  { key: "special", label: "Özel Bölge", icon: "◇" },
  { key: "service", label: "Hizmete Açık Alan", icon: "●" },
  { key: "outside", label: "Hizmete Kapalı Alan", icon: "○" },
  { key: "campaign", label: "Kampanyalı Alan", icon: "◆" }
];

const visibility = {
  country: true,
  province: true,
  district: true,
  neighborhood: true,
  cemetery: true,
  special: true,
  service: true,
  outside: true,
  campaign: true
};

window.__regionConsoleLayerVisibility = { ...visibility };

function publish() {
  window.__regionConsoleLayerVisibility = { ...visibility };
  document.dispatchEvent(new CustomEvent("region-console:layers-changed", {
    detail: { visibility: { ...visibility } }
  }));
}

function renderDialog() {
  const elements = getElements();
  const allSelected = layerDefinitions.every(({ key }) => visibility[key]);

  openDialog(elements, "Katmanlar", `
    <div class="layer-dialog">
      <div class="layer-dialog-head">
        <span>Haritada gösterilecek katmanları seçin.</span>
        <button id="layersSelectAll" class="button" type="button">${allSelected ? "Tümünü kaldır" : "Tümünü seç"}</button>
      </div>
      <div class="layer-options">
        ${layerDefinitions.map(({ key, label, icon }) => `
          <label class="layer-option">
            <span class="layer-option-main"><span class="layer-option-icon" aria-hidden="true">${icon}</span><span>${label}</span></span>
            <input type="checkbox" data-layer-key="${key}" ${visibility[key] ? "checked" : ""}>
          </label>
        `).join("")}
      </div>
    </div>
  `);

  elements.dialogBody.querySelectorAll("input[data-layer-key]").forEach((input) => {
    input.addEventListener("change", () => {
      visibility[input.dataset.layerKey] = input.checked;
      publish();
      renderDialog();
    });
  });

  elements.dialogBody.querySelector("#layersSelectAll")?.addEventListener("click", () => {
    const next = !layerDefinitions.every(({ key }) => visibility[key]);
    layerDefinitions.forEach(({ key }) => {
      visibility[key] = next;
    });
    publish();
    renderDialog();
  });
}

document.addEventListener("region-console:layers-open", renderDialog);
