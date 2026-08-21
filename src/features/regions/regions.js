export function renderRegions(container, countries = [], query = "", custom = []) {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeCustom = Array.isArray(custom) ? custom : [];

  const sortByName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "tr-TR", {
    sensitivity: "base"
  });

  const visibleCountries = safeCountries
    .filter((country) => {
      if (!normalized) return true;
      return JSON.stringify(country).toLocaleLowerCase("tr-TR").includes(normalized);
    })
    .sort(sortByName);

  const visibleCustom = safeCustom
    .filter((region) => {
      if (!normalized) return true;
      return JSON.stringify(region).toLocaleLowerCase("tr-TR").includes(normalized);
    })
    .sort(sortByName);

  const countryMarkup = visibleCountries.map((country) => `
    <div class="region-item">
      <button type="button" class="region-row" data-country-id="${escapeHtml(country.id || "")}">
        <span class="region-name">› &nbsp;▱ ${escapeHtml(country.name || "İsimsiz")}</span>
        <b>${Number(country.count || 0)}</b>
      </button>
    </div>
  `).join("");

  const customMarkup = visibleCustom.map((region) => `
    <div class="region-item region-item-custom">
      <button type="button" class="region-row" data-region-id="${escapeHtml(region.id || "")}">
        <span class="region-name">⌂ &nbsp;${escapeHtml(region.name || "İsimsiz")}</span>
        <b>${region.status === "outside" ? "Dış" : "Hiz"}</b>
      </button>
    </div>
  `).join("");

  if (!countryMarkup && !customMarkup) {
    container.innerHTML = `<div class="empty-state">Henüz bölge verisi yok.</div>`;
    return;
  }

  container.innerHTML = `${countryMarkup}${customMarkup}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
