export function renderRegions(container, countries = [], query = "", custom = []) {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeCustom = Array.isArray(custom) ? custom : [];

  const visibleCountries = safeCountries.filter((country) => {
    if (!normalized) return true;
    return JSON.stringify(country).toLocaleLowerCase("tr-TR").includes(normalized);
  });

  const visibleCustom = safeCustom.filter((region) => {
    if (!normalized) return true;
    return JSON.stringify(region).toLocaleLowerCase("tr-TR").includes(normalized);
  });

  const countryMarkup = visibleCountries.map((country) => `
    <div class="region-item">
      <button type="button" class="region-row">
        <span class="region-name">› &nbsp;▱ ${escapeHtml(country.name || "İsimsiz")}</span>
        <b>${Number(country.count || 0)}</b>
      </button>
    </div>
  `).join("");

  const customMarkup = visibleCustom.map((region) => `
    <div class="region-item region-item-custom">
      <button type="button" class="region-row" data-region-id="${escapeHtml(region.id || "")}">
        <span class="region-name">⌂ &nbsp;${escapeHtml(region.name || "İçe Aktarılan Alan")}</span>
        <b>${region.status === "outside" ? "Dış" : "Hiz"}</b>
      </button>
      <div class="region-meta">${escapeHtml(region.importMeta?.sourceFile || "İçe aktarıldı")}</div>
    </div>
  `).join("");

  if (!countryMarkup && !customMarkup) {
    container.innerHTML = `<div class="empty-state">Henüz bölge verisi yok.</div>`;
    return;
  }

  container.innerHTML = `
    ${countryMarkup}
    ${customMarkup ? `<div class="region-section-title">İçe aktarılan bölgeler</div>${customMarkup}` : ""}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
