import { store } from "../../state/store.js";
import { getElements } from "../../components/shell.js";

const elements = getElements();
const MODE_KEY = "region-console.files-display-mode";
const LEGACY_MODE_KEY = "region-console.files-view-mode";
const MODES = ["list", "icons", "table", "json"];
const TYPE_LABELS = {
  country: "Ülke",
  province: "İl",
  district: "İlçe",
  neighborhood: "Mahalle",
  cemetery: "Mezarlık",
  independent: "Özel Alan"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c");
}

function mode() {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return MODES.includes(value) ? value : "list";
  } catch {
    return "list";
  }
}

function setMode(value) {
  try {
    localStorage.setItem(MODE_KEY, value);
    if (value === "list" || value === "icons") localStorage.setItem(LEGACY_MODE_KEY, value);
  } catch {
    // no-op
  }
}

function files() {
  const state = store.get();
  const registry = Array.isArray(state.importedFiles) ? state.importedFiles : [];
  const regions = Array.isArray(state.regions?.custom) ? state.regions.custom : [];
  const byName = new Map();

  registry.forEach((file) => {
    if (file?.name) byName.set(String(file.name), { ...file, regionCount: 0, regions: [] });
  });
  regions.forEach((region) => {
    const name = String(region?.importMeta?.sourceFile || "");
    if (!name) return;
    if (!byName.has(name)) byName.set(name, { name, size: null, importedAt: region.importMeta?.importedAt || null, regionCount: 0, regions: [] });
    const file = byName.get(name);
    file.regionCount += 1;
    file.regions.push(region);
    if (!file.importedAt) file.importedAt = region.importMeta?.importedAt || region.createdAt || null;
  });
  return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
}

function typeLabel(region) {
  return TYPE_LABELS[region?.hierarchy?.type || region?.type || "independent"] || "Özel Alan";
}

function location(region) {
  const h = region?.hierarchy || {};
  const parts = [h.countryName, h.provinceName, h.districtName, h.neighborhoodName].filter(Boolean);
  return parts.join(" / ") || "—";
}

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function deleteButton(name) {
  return `<button class="button file-delete files-mode-delete" type="button" data-file-name="${escapeHtml(name)}">Sil</button>`;
}

function renderTable(items) {
  const rows = items.map((file) => {
    const types = [...new Set(file.regions.map(typeLabel))].join(", ") || "—";
    const locations = [...new Set(file.regions.map(location).filter((value) => value !== "—"))].slice(0, 2).join(" · ") || "—";
    return `<tr data-file-search="${escapeHtml(`${file.name} ${types} ${locations} ${file.regionCount}`)}"><td><strong>${escapeHtml(file.name)}</strong></td><td>${escapeHtml(types)}</td><td title="${escapeHtml(locations)}">${escapeHtml(locations)}</td><td>${file.regionCount}</td><td>${formatSize(file.size)}</td><td>${file.importedAt ? escapeHtml(new Date(file.importedAt).toLocaleString("tr-TR")) : "—"}</td><td>${deleteButton(file.name)}</td></tr>`;
  }).join("");
  return `<div class="files-table-wrap"><table class="files-table"><thead><tr><th>Dosya</th><th>Tür</th><th>Konum</th><th>Bölge</th><th>Boyut</th><th>Tarih</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="files-table-empty">Sonuç bulunamadı.</td></tr>`}</tbody></table></div>`;
}

function renderJson(items) {
  return `<div class="files-json-list">${items.map((file) => {
    const payload = {
      file: { name: file.name, size: file.size ?? null, importedAt: file.importedAt ?? null, regionCount: file.regionCount },
      regions: file.regions
    };
    return `<details class="files-json-item"><summary><span>📄 ${escapeHtml(file.name)}</span><small>${file.regionCount} bölge</small></summary><div class="files-json-actions">${deleteButton(file.name)}</div><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></details>`;
  }).join("") || `<p class="dialog-muted">Sonuç bulunamadı.</p>`}</div>`;
}

function enhanceToolbar() {
  const toolbar = elements.dialogBody?.querySelector(".files-dialog-toolbar");
  if (!toolbar) return;
  const current = mode();
  const row = toolbar.querySelector(".files-toolbar-row");
  if (!row) return;
  row.querySelector(".files-view-switch")?.remove();

  const switcher = document.createElement("div");
  switcher.className = "files-view-switch files-display-switch";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Dosya gösterim tipi");
  const buttons = [
    ["list", "☰", "Liste"],
    ["icons", "▦", "Simge"],
    ["table", "▤", "Tablo"],
    ["json", "{ }", "JSON"]
  ];
  buttons.forEach(([value, icon, label]) => {
    const button = document.createElement("button");
    button.className = `files-view-button ${current === value ? "active" : ""}`;
    button.type = "button";
    button.dataset.displayMode = value;
    button.title = `${label} görünümü`;
    button.setAttribute("aria-label", `${label} görünümü`);
    button.textContent = icon;
    switcher.appendChild(button);
  });
  row.appendChild(switcher);

  switcher.querySelectorAll("[data-display-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.displayMode;
      const search = toolbar.querySelector("#filesSearch")?.value || "";
      setMode(next);
      if (next === "list" || next === "icons") {
        document.querySelector("#filesButton")?.click();
        setTimeout(() => {
          const nextSearch = elements.dialogBody?.querySelector("#filesSearch");
          if (nextSearch && search) {
            nextSearch.value = search;
            nextSearch.dispatchEvent(new Event("input", { bubbles: true }));
          }
          enhanceToolbar();
        }, 0);
        return;
      }
      renderCustomMode(next, search);
      enhanceToolbar();
    });
  });
}

function renderCustomMode(nextMode, query = "") {
  const items = files();
  const normalized = normalize(query);
  const filtered = normalized
    ? items.filter((file) => normalize(`${file.name} ${file.regions.map((region) => `${region.name || ""} ${typeLabel(region)} ${location(region)}`).join(" ")}`).includes(normalized))
    : items;
  const tree = elements.dialogBody?.querySelector("#filesTree");
  if (!tree) return;
  tree.className = `files-tree files-custom-mode files-mode-${nextMode}`;
  tree.innerHTML = nextMode === "table" ? renderTable(filtered) : renderJson(filtered);
  bindCustomDeletes();
}

function bindCustomDeletes() {
  elements.dialogBody?.querySelectorAll(".files-mode-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const original = [...elements.dialogBody.querySelectorAll(".file-delete:not(.files-mode-delete)")]
        .find((item) => item.dataset.fileName === button.dataset.fileName);
      if (original) original.click();
    });
  });
}

function enhanceOpenDialog() {
  setTimeout(() => {
    enhanceToolbar();
    if (mode() === "table" || mode() === "json") {
      const search = elements.dialogBody?.querySelector("#filesSearch")?.value || "";
      renderCustomMode(mode(), search);
      enhanceToolbar();
    }
  }, 0);
}

document.addEventListener("DOMContentLoaded", () => {
  elements.filesButton?.addEventListener("click", enhanceOpenDialog);
});
if (document.readyState !== "loading") {
  elements.filesButton?.addEventListener("click", enhanceOpenDialog);
}
