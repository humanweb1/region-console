import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const elements = getElements();
let active = false;
let expiryTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: currency || "TRY", maximumFractionDigits: 2 }).format(number);
}

function campaignStatus(campaign) {
  const now = Date.now();
  const start = campaign.startDate ? new Date(campaign.startDate).getTime() : null;
  const end = campaign.endDate ? new Date(campaign.endDate).getTime() : null;
  if (start && now < start) return "Planlandı";
  if (end && now > end) return "Sona erdi";
  return "Aktif";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

function discountSummary(campaign) {
  if (campaign.discountType === "percentage") {
    const max = campaign.maxDiscountAmount ? ` · Maks. ${money(campaign.maxDiscountAmount, campaign.currency)}` : "";
    return `%${campaign.discountValue || 0}${max}`;
  }
  return `${money(campaign.discountValue, campaign.currency)} indirim`;
}

async function persistCampaigns() {
  const session = store.get().auth?.session;
  if (!session?.access_token) return;
  try {
    const snapshot = store.dataSnapshot();
    await saveState(session.access_token, {
      ...snapshot.regions,
      campaigns: snapshot.campaigns,
      history: store.get().history.entries,
      importedFiles: snapshot.importedFiles,
      mapSettings: snapshot.mapSettings
    });
  } catch (error) {
    console.error("[Region Console] Campaign save failed:", error);
    toast(elements, `Kampanya buluta kaydedilemedi: ${error.message}`);
  }
}

function walkRegions(items, callback) {
  for (const region of items || []) {
    if (!region) continue;
    callback(region);
    walkRegions(region.provinces, callback);
    walkRegions(region.districts, callback);
    walkRegions(region.neighborhoods, callback);
    walkRegions(region.cemeteries, callback);
    walkRegions(region.children, callback);
  }
}

async function expireEndedCampaigns() {
  const campaigns = Array.isArray(store.get().campaigns) ? store.get().campaigns : [];
  const expiredIds = new Set(
    campaigns
      .filter((campaign) => campaign.endDate && new Date(campaign.endDate).getTime() <= Date.now() && !campaign.expiredAt)
      .map((campaign) => String(campaign.id))
  );
  if (!expiredIds.size) return false;

  const before = store.dataSnapshot();
  const nowIso = new Date().toISOString();
  const nextCampaigns = campaigns.map((campaign) =>
    expiredIds.has(String(campaign.id))
      ? { ...campaign, status: "expired", expiredAt: nowIso, updatedAt: nowIso }
      : campaign
  );
  const nextCustom = (store.get().regions?.custom || []).map((region) =>
    expiredIds.has(String(region.campaignId))
      ? { ...region, campaignId: null, campaign: false, status: region.status === "campaign" ? "service" : region.status, updatedAt: nowIso }
      : region
  );
  const countries = structuredClone(store.get().regions?.countries || []);
  walkRegions(countries, (region) => {
    if (!expiredIds.has(String(region.campaignId))) return;
    region.campaignId = null;
    region.campaign = false;
    if (region.status === "campaign") region.status = "service";
    region.updatedAt = nowIso;
  });

  store.set({
    campaigns: nextCampaigns,
    regions: { ...store.get().regions, custom: nextCustom, countries }
  });
  store.recordHistory("Süresi dolan kampanyalar otomatik sonlandırıldı", before, store.dataSnapshot());
  await persistCampaigns();
  window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
  return true;
}

function renderCampaigns() {
  const campaigns = Array.isArray(store.get().campaigns) ? store.get().campaigns : [];
  openDialog(elements, "Kampanyalar", `
    <div class="campaign-toolbar">
      <div class="campaign-toolbar-copy"><strong>Kampanya yönetimi</strong><span>İndirim, tarih ve kullanım koşullarını tek ekrandan yönetin.</span></div>
      <button id="newCampaign" class="button button-primary" type="button">Yeni kampanya</button>
    </div>
    <div class="campaign-list">
      ${campaigns.length ? campaigns.map((campaign) => `
        <article class="campaign-card" data-campaign-id="${escapeHtml(campaign.id)}">
          <div class="campaign-card-main">
            <div class="campaign-card-title"><strong>${escapeHtml(campaign.name)}</strong><span class="campaign-status">${escapeHtml(campaignStatus(campaign))}</span></div>
            <small>${escapeHtml(campaign.description || "Açıklama yok")}</small>
            <div class="campaign-meta">
              <span>İndirim: <b>${escapeHtml(discountSummary(campaign))}</b></span>
              <span>Başlangıç: <b>${escapeHtml(formatDate(campaign.startDate))}</b></span>
              <span>Bitiş: <b>${escapeHtml(formatDate(campaign.endDate))}</b></span>
              ${campaign.promoCode ? `<span>Kod: <b>${escapeHtml(campaign.promoCode)}</b></span>` : ""}
              ${campaign.minimumCartAmount ? `<span>Min. sepet: <b>${escapeHtml(money(campaign.minimumCartAmount, campaign.currency))}</b></span>` : ""}
              ${campaign.usageLimit ? `<span>Kullanım: <b>${escapeHtml(`${campaign.usedCount || 0}/${campaign.usageLimit}`)}</b></span>` : ""}
            </div>
          </div>
          <div class="campaign-card-actions">
            <button class="button campaign-edit-button" type="button" data-campaign-action="edit">Düzenle</button>
            <button class="button button-danger campaign-delete-button" type="button" data-campaign-action="delete">Sil</button>
          </div>
        </article>`).join("") : `<p class="dialog-muted">Henüz kampanya yok.</p>`}
    </div>
  `);
  elements.dialogBody.querySelector("#newCampaign")?.addEventListener("click", () => openCampaignForm(null));
  elements.dialogBody.querySelectorAll("[data-campaign-action='edit']").forEach((button) => {
    button.addEventListener("click", () => openCampaignForm(button.closest("[data-campaign-id]")?.dataset.campaignId || null));
  });
  elements.dialogBody.querySelectorAll("[data-campaign-action='delete']").forEach((button) => {
    button.addEventListener("click", () => openDeleteConfirmation(button.closest("[data-campaign-id]")?.dataset.campaignId || null));
  });
}

function openDeleteConfirmation(campaignId) {
  const campaign = (store.get().campaigns || []).find((item) => String(item.id) === String(campaignId));
  if (!campaign) return;
  openDialog(elements, "Kampanyayı sil", `
    <div class="campaign-delete-dialog">
      <p><strong>${escapeHtml(campaign.name)}</strong> kampanyasını silmek istediğinize emin misiniz?</p>
      <p class="dialog-muted">Bu işlem kampanya kaydını ve bu kampanyaya bağlı bölgelerdeki kampanya bağlantısını kaldırır. İşlem geçmişe kaydedilir.</p>
      <div class="dialog-actions">
        <button type="button" class="button" id="cancelCampaignDelete">İptal</button>
        <button type="button" class="button button-danger" id="confirmCampaignDelete">Kampanyayı sil</button>
      </div>
    </div>
  `);
  elements.dialogBody.querySelector("#cancelCampaignDelete")?.addEventListener("click", renderCampaigns);
  elements.dialogBody.querySelector("#confirmCampaignDelete")?.addEventListener("click", async () => {
    const before = store.dataSnapshot();
    const nowIso = new Date().toISOString();
    const custom = (store.get().regions?.custom || []).map((region) =>
      String(region.campaignId) === String(campaignId)
        ? { ...region, campaignId: null, campaign: false, status: region.status === "campaign" ? "service" : region.status, updatedAt: nowIso }
        : region
    );
    const countries = structuredClone(store.get().regions?.countries || []);
    walkRegions(countries, (region) => {
      if (String(region.campaignId) !== String(campaignId)) return;
      region.campaignId = null;
      region.campaign = false;
      if (region.status === "campaign") region.status = "service";
      region.updatedAt = nowIso;
    });
    store.set({
      campaigns: (store.get().campaigns || []).filter((item) => String(item.id) !== String(campaignId)),
      regions: { ...store.get().regions, custom, countries }
    });
    store.recordHistory(`Kampanya silindi: ${campaign.name}`, before, store.dataSnapshot());
    await persistCampaigns();
    window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
    toast(elements, `“${campaign.name}” kampanyası silindi.`);
    renderCampaigns();
  });
}

function openCampaignForm(campaignId = null) {
  const existing = campaignId ? (store.get().campaigns || []).find((item) => String(item.id) === String(campaignId)) : null;
  if (campaignId && !existing) return renderCampaigns();
  const editing = Boolean(existing);
  const toLocalInput = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  };
  openDialog(elements, editing ? "Kampanyayı düzenle" : "Yeni kampanya", `
    <form id="campaignForm" class="dialog-form campaign-form" novalidate>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">Temel bilgiler</div>
        <label>Kampanya adı<input name="name" required maxlength="120" placeholder="Örn. Yaz Fırsatı" value="${escapeHtml(existing?.name || "")}"></label>
        <label>Kampanya detayları<textarea name="description" rows="3" maxlength="1000" placeholder="Kampanyanın kapsamı ve koşulları">${escapeHtml(existing?.description || "")}</textarea></label>
      </div>
      <div class="campaign-form-grid">
        <label>Başlangıç tarihi<input name="startDate" type="datetime-local" required value="${escapeHtml(toLocalInput(existing?.startDate))}"></label>
        <label>Bitiş tarihi <small>(opsiyonel)</small><input name="endDate" type="datetime-local" value="${escapeHtml(toLocalInput(existing?.endDate))}"></label>
      </div>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">İndirim</div>
        <div class="campaign-form-grid">
          <label>İndirim şekli<select name="discountType" id="campaignDiscountType"><option value="percentage" ${existing?.discountType === "percentage" || !existing ? "selected" : ""}>Yüzde (%)</option><option value="fixed" ${existing?.discountType === "fixed" ? "selected" : ""}>Sabit tutar</option></select></label>
          <label>İndirim miktarı<input name="discountValue" type="number" min="0" step="0.01" required placeholder="Örn. 20" value="${escapeHtml(existing?.discountValue ?? "")}"></label>
          <label>Para birimi<select name="currency"><option value="TRY" ${existing?.currency === "TRY" || !existing ? "selected" : ""}>TRY ₺</option><option value="USD" ${existing?.currency === "USD" ? "selected" : ""}>USD $</option><option value="EUR" ${existing?.currency === "EUR" ? "selected" : ""}>EUR €</option></select></label>
          <label>Minimum sepet tutarı <small>(opsiyonel)</small><input name="minimumCartAmount" type="number" min="0" step="0.01" placeholder="Örn. 500" value="${escapeHtml(existing?.minimumCartAmount ?? "")}"></label>
          <label id="campaignMaxDiscountWrap">Maksimum indirim tutarı <small>(opsiyonel)</small><input name="maxDiscountAmount" type="number" min="0" step="0.01" placeholder="Örn. 250" value="${escapeHtml(existing?.maxDiscountAmount ?? "")}"></label>
        </div>
      </div>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">Kampanya kodu ve kullanım</div>
        <div class="campaign-form-grid">
          <label>Kampanya kodu <small>(opsiyonel)</small><input name="promoCode" maxlength="40" placeholder="Örn. YAZ20" autocapitalize="characters" value="${escapeHtml(existing?.promoCode || "")}"></label>
          <label>Kullanım limiti <small>(opsiyonel)</small><input name="usageLimit" type="number" min="1" step="1" placeholder="Sınırsız" value="${escapeHtml(existing?.usageLimit ?? "")}"></label>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button" id="cancelCampaign">İptal</button>
        <button type="submit" class="button button-primary">${editing ? "Değişiklikleri kaydet" : "Kampanyayı oluştur"}</button>
      </div>
      <p id="campaignFormError" class="form-error" role="alert"></p>
    </form>
  `);

  const form = elements.dialogBody.querySelector("#campaignForm");
  const discountType = form.querySelector("#campaignDiscountType");
  const maxDiscountWrap = form.querySelector("#campaignMaxDiscountWrap");
  const startDate = form.querySelector('[name="startDate"]');
  const syncDiscount = () => { maxDiscountWrap.hidden = discountType.value !== "percentage"; };
  discountType.addEventListener("change", syncDiscount);
  syncDiscount();
  if (!editing) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    startDate.value = now.toISOString().slice(0, 16);
  }

  form.querySelector("#cancelCampaign").addEventListener("click", renderCampaigns);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    const start = String(data.get("startDate") || "");
    const end = String(data.get("endDate") || "");
    const discountTypeValue = String(data.get("discountType") || "percentage");
    const discountValue = Number(data.get("discountValue"));
    const currency = String(data.get("currency") || "TRY");
    const minimumCartAmount = data.get("minimumCartAmount") === "" ? null : Number(data.get("minimumCartAmount"));
    const maxDiscountAmount = discountTypeValue === "percentage" && data.get("maxDiscountAmount") !== "" ? Number(data.get("maxDiscountAmount")) : null;
    const promoCode = String(data.get("promoCode") || "").trim().toUpperCase();
    const usageLimit = data.get("usageLimit") === "" ? null : Number(data.get("usageLimit"));
    const error = form.querySelector("#campaignFormError");
    const startMs = start ? new Date(start).getTime() : NaN;
    const endMs = end ? new Date(end).getTime() : null;

    if (!name) return (error.textContent = "Kampanya adı zorunludur.");
    if (!start || Number.isNaN(startMs)) return (error.textContent = "Başlangıç tarihi zorunludur.");
    if (end && (endMs === null || Number.isNaN(endMs) || endMs <= startMs)) return (error.textContent = "Bitiş tarihi başlangıç tarihinden sonra olmalıdır.");
    if (!Number.isFinite(discountValue) || discountValue <= 0) return (error.textContent = "İndirim miktarı 0'dan büyük olmalıdır.");
    if (discountTypeValue === "percentage" && discountValue > 100) return (error.textContent = "Yüzde indirimi 100'ü geçemez.");
    if (minimumCartAmount !== null && (!Number.isFinite(minimumCartAmount) || minimumCartAmount < 0)) return (error.textContent = "Minimum sepet tutarı geçersiz.");
    if (maxDiscountAmount !== null && (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0)) return (error.textContent = "Maksimum indirim tutarı geçersiz.");
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) return (error.textContent = "Kullanım limiti en az 1 olmalıdır.");

    const nowIso = new Date().toISOString();
    const campaign = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      name,
      description,
      startDate: new Date(start).toISOString(),
      endDate: end ? new Date(end).toISOString() : null,
      discountType: discountTypeValue,
      discountValue,
      currency,
      minimumCartAmount,
      maxDiscountAmount,
      promoCode: promoCode || null,
      usageLimit,
      usedCount: existing?.usedCount || 0,
      status: "aktif",
      expiredAt: null,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso
    };

    const before = store.dataSnapshot();
    const campaigns = existing
      ? store.get().campaigns.map((item) => String(item.id) === String(existing.id) ? campaign : item)
      : [...store.get().campaigns, campaign];
    store.set({ campaigns });
    store.recordHistory(existing ? `Kampanya düzenlendi: ${name}` : "Kampanya oluşturuldu", before, store.dataSnapshot());
    window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
    await persistCampaigns();
    toast(elements, existing ? `“${name}” kampanyası güncellendi.` : `“${name}” kampanyası oluşturuldu.`);
    renderCampaigns();
  });
}

async function refreshCampaignExpiry() {
  try {
    const changed = await expireEndedCampaigns();
    if (changed && document.getElementById("campaignForm") == null && elements.dialogBody?.querySelector(".campaign-list")) renderCampaigns();
  } catch (error) {
    console.error("[Region Console] Campaign expiry check failed:", error);
  }
}

function install() {
  if (active) return;
  const button = document.getElementById("campaignButton");
  if (!button) return;
  active = true;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    renderCampaigns();
  }, true);
  refreshCampaignExpiry();
  expiryTimer = window.setInterval(refreshCampaignExpiry, 60 * 1000);
  window.addEventListener("region-console:campaigns-changed", refreshCampaignExpiry);
}

const style = document.createElement("style");
style.textContent = `
.campaign-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}.campaign-toolbar-copy{display:grid;gap:3px}.campaign-toolbar-copy span{font-size:12px;opacity:.65}.campaign-card{padding:14px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(15,23,42,.35);margin-bottom:9px}.campaign-card-main{min-width:0}.campaign-card-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.campaign-status{font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(52,211,153,.12);color:#34d399}.campaign-card-main small{display:block;margin-top:5px;opacity:.68}.campaign-meta{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px;font-size:11px;opacity:.72}.campaign-meta b{opacity:1;color:inherit}.campaign-card-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,.12)}.campaign-form{display:grid;gap:16px}.campaign-form-section{display:grid;gap:10px}.campaign-form-section-title{font-weight:700;font-size:13px}.campaign-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.campaign-form label{display:grid;gap:6px;font-size:12px}.campaign-form label small{opacity:.55;font-weight:400}.campaign-form input,.campaign-form textarea,.campaign-form select{width:100%;box-sizing:border-box}.campaign-form textarea{resize:vertical;min-height:76px}.campaign-form .dialog-actions,.campaign-delete-dialog .dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}.campaign-form [hidden]{display:none!important}.campaign-delete-dialog{display:grid;gap:12px}.button-danger{border-color:rgba(248,113,113,.35)!important;color:#f87171!important}.button-danger:hover{background:rgba(248,113,113,.1)!important}@media(max-width:650px){.campaign-toolbar{align-items:stretch;flex-direction:column}.campaign-form-grid{grid-template-columns:1fr}}
`;
document.head.appendChild(style);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", install, { once: true });
} else {
  install();
}
window.addEventListener("region-console:campaigns-open", renderCampaigns);