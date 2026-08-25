import { getOverlayVisibility, setOverlayVisibility } from "./map.js";

const LAYERS = [
  { id: "province", label: "İller", description: "İl sınırları" },
  { id: "district", label: "İlçeler", description: "İlçe sınırları" },
  { id: "neighborhood", label: "Mahalleler", description: "Mahalle sınırları" },
  { id: "cemetery", label: "Mezarlıklar", description: "Mezarlık alanları" },
  { id: "special", label: "Özel Alanlar", description: "Bağımsız ve özel bölgeler" },
  { id: "mask", label: "Dış alan maskesi", description: "Hizmet alanı dışındaki harita maskesi" }
];

function install() {
  const controls = document.querySelector(".map-controls");
  if (!controls || document.getElementById("layersButton")) return;
  const wrapper = document.createElement("div");
  wrapper.className = "layers-control";
  wrapper.innerHTML = `<button id="layersButton" class="map-layer" type="button" aria-expanded="false" aria-controls="layersPopover" title="Harita katmanları">Katmanlar</button><div id="layersPopover" class="layers-popover" hidden><strong>Katmanlar</strong><div class="layers-list">${LAYERS.map((layer) => `<label class="layer-toggle"><input type="checkbox" data-layer-id="${layer.id}" checked><span><b>${layer.label}</b><small>${layer.description}</small></span></label>`).join("")}</div></div>`;
  controls.appendChild(wrapper);
  const button = wrapper.querySelector("#layersButton");
  const popover = wrapper.querySelector("#layersPopover");
  function close() { popover.hidden = true; button.setAttribute("aria-expanded", "false"); }
  function sync() { const mapState = window.__regionConsoleMapState; if (!mapState) return; const visibility = getOverlayVisibility(mapState); wrapper.querySelectorAll("input[data-layer-id]").forEach((input) => { input.checked = visibility[input.dataset.layerId] !== false; }); }
  button.addEventListener("click", (event) => { event.stopPropagation(); const opening = popover.hidden; if (opening) sync(); popover.hidden = !opening; button.setAttribute("aria-expanded", String(opening)); });
  wrapper.addEventListener("click", (event) => event.stopPropagation());
  wrapper.querySelectorAll("input[data-layer-id]").forEach((input) => { input.addEventListener("change", () => { const mapState = window.__regionConsoleMapState; if (!mapState) return; setOverlayVisibility(mapState, input.dataset.layerId, input.checked); }); });
  document.addEventListener("click", (event) => { if (!wrapper.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !popover.hidden) { close(); button.focus(); } });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
