export function renderRegions(container, countries = [], query = "") {
  const normalized = query.trim().toLocaleLowerCase("tr-TR");

  const visible = countries.filter((country) => {
    if (!normalized) return true;
    return JSON.stringify(country).toLocaleLowerCase("tr-TR").includes(normalized);
  });

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state">Henüz bölge verisi yok.</div>`;
    return;
  }

  container.innerHTML = visible.map((country) => `
    <div class="region-item">
      <button type="button" class="region-row">
        <span class="region-name">› &nbsp;▱ ${escapeHtml(country.name || "İsimsiz")}</span>
        <b>${Number(country.count || 0)}</b>
      </button>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
