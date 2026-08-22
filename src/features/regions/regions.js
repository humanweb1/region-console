export function renderRegions(container, countries = [], query = "", custom = []) {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const safeCountries = Array.isArray(countries) ? countries : [];
  const allCustom = (Array.isArray(custom) ? custom : []).filter(Boolean);
  const customByParent = new Map();

  allCustom.forEach((region) => {
    const parentId = region?.hierarchy?.parentId;
    if (parentId == null || parentId === "") return;
    const key = String(parentId);
    if (!customByParent.has(key)) customByParent.set(key, []);
    customByParent.get(key).push(region);
  });

  const matches = (region) => {
    if (!normalized) return true;
    return JSON.stringify(region).toLocaleLowerCase("tr-TR").includes(normalized);
  };

  const childrenFor = (node, type) => {
    const keys = {
      country: ["provinces", "children"],
      province: ["districts", "children"],
      district: ["neighborhoods", "children"],
      neighborhood: ["cemeteries", "children"]
    };
    const nested = (keys[type] || []).flatMap((key) => Array.isArray(node?.[key]) ? node[key] : []);
    const customChildren = customByParent.get(String(node?.id || "")) || [];
    return [...nested, ...customChildren];
  };

  const nodeType = (node, fallback = "independent") => {
    const value = String(node?.type || node?.hierarchy?.type || fallback).toLowerCase();
    if (["country", "province", "district", "neighborhood", "cemetery"].includes(value)) return value;
    return "independent";
  };

  const typeLabel = {
    country: "Ülke",
    province: "İl",
    district: "İlçe",
    neighborhood: "Mahalle",
    cemetery: "Mezarlık",
    independent: "Özel"
  };

  const renderNode = (node, type, depth = 0, source = "hierarchy") => {
    const resolvedType = nodeType(node, type);
    const children = childrenFor(node, resolvedType);
    const id = escapeHtml(node?.id || "");
    const name = escapeHtml(node?.name || "İsimsiz");
    const canAddChild = ["country", "province", "district", "neighborhood"].includes(resolvedType);
    const childType = { country: "province", province: "district", district: "neighborhood", neighborhood: "cemetery" }[resolvedType];
    const isCustom = source === "custom" || Boolean(node?.geometry) || resolvedType === "independent";
    const selected = isCustom ? `data-region-id="${id}"` : `data-country-id="${id}"`;
    const deleteAttr = isCustom
      ? `data-delete-region-id="${id}"`
      : `data-delete-node-id="${id}" data-delete-node-type="${resolvedType}"`;
    const indent = Math.min(depth, 8) * 14;
    const hasChildren = children.length > 0;

    return `
      <div class="region-item ${isCustom ? "region-item-custom" : ""}" data-region-depth="${depth}" style="--region-indent:${indent}px">
        <div class="region-row-wrap">
          <button type="button" class="region-row" ${selected}>
            <span class="region-name"><span class="region-kind">${typeLabel[resolvedType]}</span>${name}</span>
            <b>${children.length}</b>
          </button>
          ${canAddChild ? `<button type="button" class="region-row-action" data-add-child-type="${childType}" data-parent-id="${id}" data-parent-type="${resolvedType}" aria-label="${typeLabel[childType]} ekle" title="${typeLabel[childType]} ekle">+</button>` : ""}
          <button type="button" class="region-row-action region-row-delete" ${deleteAttr} aria-label="Sil" title="Sil">×</button>
        </div>
        ${hasChildren ? `<div class="region-children">${children.filter(matches).sort(sortByName).map((child) => renderNode(child, nodeType(child, childType), depth + 1, child.geometry ? "custom" : "hierarchy")).join("")}</div>` : ""}
      </div>
    `;
  };

  const topCountries = safeCountries.filter(matches).sort(sortByName).map((country) => renderNode(country, "country", 0, "hierarchy"));
  const customRoots = allCustom
    .filter((region) => !region?.hierarchy?.parentId)
    .filter(matches)
    .sort(sortByName)
    .map((region) => renderNode(region, nodeType(region), 0, "custom"));

  const html = [...topCountries, ...customRoots].join("");
  container.innerHTML = html || `<div class="empty-state">Henüz bölge verisi yok.</div>`;
}

function sortByName(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), "tr-TR", { sensitivity: "base" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
