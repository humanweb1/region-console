export function renderRegions(container, countries = [], query = "", custom = []) {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeCustom = Array.isArray(custom) ? custom : [];

  const matches = (region) => {
    if (!normalized) return true;
    return JSON.stringify(region).toLocaleLowerCase("tr-TR").includes(normalized);
  };

  const entries = [
    ...safeCountries.filter(matches).map((country) => ({ type: "country", data: country })),
    ...safeCustom.filter(matches).map((region) => ({ type: "custom", data: region }))
  ].sort((a, b) => String(a.data?.name || "").localeCompare(String(b.data?.name || ""), "tr-TR", {
    sensitivity: "base"
  }));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">Henüz bölge verisi yok.</div>`;
    return;
  }

  container.innerHTML = entries.map(({ type, data }) => {
    if (type === "custom") {
      return `
        <div class="region-item region-item-custom">
          <button type="button" class="region-row" data-region-id="${escapeHtml(data.id || "")}">
            <span class="region-name">⌂ &nbsp;${escapeHtml(data.name || "İsimsiz")}</span>
            <b>${data.status === "outside" ? "Dış" : "Hiz"}</b>
          </button>
        </div>
      `;
    }

    return `
      <div class="region-item">
        <button type="button" class="region-row" data-country-id="${escapeHtml(data.id || "")}">
          <span class="region-name">› &nbsp;▱ ${escapeHtml(data.name || "İsimsiz")}</span>
          <b>${Number(data.count || 0)}</b>
        </button>
      </div>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
