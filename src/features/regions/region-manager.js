import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";

const elements = getElements();

const TYPE_LABELS = {
  country: "Ülke",
  province: "İl",
  district: "İlçe",
  neighborhood: "Mahalle",
  cemetery: "Mezarlık",
  independent: "Özel Bölge"
};

const CHILD_TYPE = {
  country: "province",
  province: "district",
  district: "neighborhood",
  neighborhood: "cemetery"
};

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function makeNode(type, name, code = "", status = "service") {
  const now = new Date().toISOString();
  const node = { id: crypto.randomUUID(), type, name: name.trim(), code: code.trim(), status, createdAt: now, updatedAt: now };
  const childKey = { country: "provinces", province: "districts", district: "neighborhoods", neighborhood: "cemeteries" }[type];
  if (childKey) node[childKey] = [];
  return node;
}

function findNode(nodes, id, type = null) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (String(node.id) === String(id) && (!type || String(node.type || "country") === type)) return node;
    const children = node.provinces || node.districts || node.neighborhoods || node.cemeteries || node.children;
    const found = findNode(children, id, type);
    if (found) return found;
  }
  return null;
}

function updateNodeChildren(nodes, parentId, parentType, child) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const nodeType = node.type || "country";
    if (String(node.id) === String(parentId) && nodeType === parentType) {
      const key = { country: "provinces", province: "districts", district: "neighborhoods", neighborhood: "cemetery" }[parentType] || { country: "provinces", province: "districts", district: "neighborhoods", neighborhood: "cemeteries" }[parentType];
      return { ...node, [key]: [...(Array.isArray(node[key]) ? node[key] : []), child], updatedAt: new Date().toISOString() };
    }
    const next = { ...node };
    ["provinces", "districts", "neighborhoods", "cemeteries"].forEach((key) => {
      if (Array.isArray(node[key])) next[key] = updateNodeChildren(node[key], parentId, parentType, child);
    });
    return next;
  });
}

function removeNode(nodes, id, type = null) {
  const result = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (String(node.id) === String(id) && (!type || String(node.type || "country") === type)) continue;
    const next = { ...node };
    ["provinces", "districts", "neighborhoods", "cemeteries"].forEach((key) => {
      if (Array.isArray(node[key])) next[key] = removeNode(node[key], id, type);
    });
    result.push(next);
  }
  return result;
}

function hasDescendants(node) {
  return ["provinces", "districts", "neighborhoods", "cemeteries", "children"].some((key) => Array.isArray(node?.[key]) && node[key].length);
}

function persist() {
  const session = store.get().auth.session;
  if (!session?.access_token) return Promise.resolve();
  const snapshot = store.dataSnapshot();
  return saveState(session.access_token, {
    ...snapshot.regions,
    campaigns: snapshot.campaigns,
    history: store.get().history.entries,
    importedFiles: snapshot.importedFiles,
    mapSettings: snapshot.mapSettings
  }).then((saved) => {
    store.update("cloud", { status: "ready", version: saved?.version || Date.now(), updatedAt: saved?.updated_at || new Date().toISOString(), error: null });
  }).catch((error) => {
    store.update("cloud", { status: "error", error: error.message });
    toast(elements, `Bulut kaydı başarısız: ${error.message}`);
  });
}

function commit(label, updater) {
  const before = store.dataSnapshot();
  updater();
  store.recordHistory(label, before, store.dataSnapshot());
  return persist();
}

function openAddDialog({ parentId = null, parentType = null } = {}) {
  const defaultType = parentType ? CHILD_TYPE[parentType] : "country";
  const allowedTypes = parentType ? [defaultType] : ["country", "independent"];
  const options = allowedTypes.map((type) => `<option value="${type}">${TYPE_LABELS[type]}</option>`).join("");
  const parent = parentId ? findNode(store.get().regions.countries, parentId, parentType) || (store.get().regions.custom || []).find((item) => String(item.id) === String(parentId)) : null;
  const parentText = parent ? `<p class="dialog-muted">Üst bölge: <strong>${escapeHtml(parent.name)}</strong> · ${TYPE_LABELS[parentType]}</p>` : "";

  openDialog(elements, parentId ? `${TYPE_LABELS[defaultType]} ekle` : "Bölge ekle", `<form id="regionCreateForm" class="dialog-form">${parentText}<label>Bölge tipi<select id="createRegionType" name="type">${options}</select></label><label>Ad<input name="name" autocomplete="off" required placeholder="Bölge adı"></label><label>Kod <span class="dialog-muted">(isteğe bağlı)</span><input name="code" autocomplete="off" placeholder="Örn. TR"></label>${!parentId ? `<label>Durum<select name="status"><option value="service">Hizmet Verilen</option><option value="outside">Hizmet Dışı</option></select></label>` : ""}<div class="dialog-actions"><button id="regionCreateCancel" class="button" type="button">Vazgeç</button><button class="button button-primary" type="submit">Ekle</button></div></form>`);

  elements.dialogBody.querySelector("#regionCreateCancel")?.addEventListener("click", () => closeDialog(elements));
  elements.dialogBody.querySelector("#regionCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const type = String(data.get("type") || defaultType);
    const name = String(data.get("name") || "").trim();
    const code = String(data.get("code") || "").trim();
    if (!name) return toast(elements, "Bölge adı zorunludur.");

    const node = makeNode(type, name, code, String(data.get("status") || "service"));
    if (parentId) {
      await commit(`${TYPE_LABELS[type]} eklendi`, () => {
        const current = store.get();
        if (findNode(current.regions.countries, parentId, parentType)) {
          store.update("regions", { countries: updateNodeChildren(current.regions.countries, parentId, parentType, node) });
          return;
        }
        const custom = Array.isArray(current.regions.custom) ? current.regions.custom : [];
        store.update("regions", { custom: [...custom, { ...node, hierarchy: { type, label: TYPE_LABELS[type], level: 1, parentType, parentId: String(parentId), rootType: "country" } }] });
      });
    } else if (type === "country") {
      await commit("Ülke eklendi", () => store.update("regions", { countries: [...(store.get().regions.countries || []), node] }));
    } else {
      await commit("Özel bölge eklendi", () => {
        const custom = Array.isArray(store.get().regions.custom) ? store.get().regions.custom : [];
        store.update("regions", { custom: [...custom, { ...node, type: "independent", hierarchy: { type: "independent", label: TYPE_LABELS.independent, level: 0, parentType: null, parentId: null, rootType: "independent" } }] });
      });
    }
    closeDialog(elements);
    toast(elements, `${TYPE_LABELS[type]} eklendi.`);
  });
}

async function deleteRegion(id) {
  const current = store.get();
  const custom = Array.isArray(current.regions.custom) ? current.regions.custom : [];
  const region = custom.find((item) => String(item.id) === String(id));
  if (!region) return;
  const descendants = custom.filter((item) => String(item?.hierarchy?.parentId) === String(id));
  if (!window.confirm(`“${region.name || "Bölge"}” silinsin mi${descendants.length ? ` ve ${descendants.length} alt bölge` : ""}?`)) return;
  await commit("Bölge silindi", () => {
    const removeIds = new Set([String(id)]);
    let changed = true;
    while (changed) {
      changed = false;
      custom.forEach((item) => {
        if (item?.hierarchy?.parentId && removeIds.has(String(item.hierarchy.parentId)) && !removeIds.has(String(item.id))) {
          removeIds.add(String(item.id));
          changed = true;
        }
      });
    }
    store.update("regions", { custom: custom.filter((item) => !removeIds.has(String(item.id))), selectedId: null });
  });
  document.getElementById("regionActionPanel")?.remove();
  toast(elements, "Bölge silindi.");
}

async function deleteNode(id, type) {
  const current = store.get();
  const node = findNode(current.regions.countries, id, type);
  if (!node) return;
  if (!window.confirm(`“${node.name || "Bölge"}” silinsin mi${hasDescendants(node) ? " ve alt katmanları" : ""}?`)) return;
  await commit(`${TYPE_LABELS[type]} silindi`, () => store.update("regions", { countries: removeNode(current.regions.countries, id, type), selectedId: null }));
  toast(elements, `${TYPE_LABELS[type]} silindi.`);
}

elements.addRegionButton?.addEventListener("click", () => openAddDialog());

elements.regionTree?.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-child-type]");
  if (addButton) {
    event.preventDefault();
    event.stopPropagation();
    openAddDialog({ parentId: addButton.dataset.parentId, parentType: addButton.dataset.parentType });
    return;
  }
  const customDelete = event.target.closest("[data-delete-region-id]");
  if (customDelete) {
    event.preventDefault();
    event.stopPropagation();
    deleteRegion(customDelete.dataset.deleteRegionId);
    return;
  }
  const nodeDelete = event.target.closest("[data-delete-node-id]");
  if (nodeDelete) {
    event.preventDefault();
    event.stopPropagation();
    deleteNode(nodeDelete.dataset.deleteNodeId, nodeDelete.dataset.deleteNodeType);
  }
});

document.addEventListener("region-console:add-region", () => openAddDialog());
