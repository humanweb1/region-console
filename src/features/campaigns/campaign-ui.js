import { store } from "../../state/store.js";
import { getElements, openDialog, toast } from "../../components/shell.js";

const elements = getElements();
let active = false;

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

function renderCampaigns() {
  const campaigns = Array.isArray(store.get().campaigns) ? store.get().campaigns : [];
  openDialog(elements, "Kampanyalar", `
    <div class="campaign-toolbar">
      <div class="campaign-toolbar-copy"><strong>Kampanya yönetimi</strong><span>İndirim, tarih ve kullanım koşullarını tek ekrandan yönetin.</span></div>
      <button id="newCampaign" class="button button-primary" type="button">Yeni kampanya</button>
    </div>
    <div class="campaign-list">
      ${campaigns.length ? campaigns.map((campaign) => `
        <article class="campaign-card">
          <div class="campaign-card-main">
            <div class="campaign-card-title"><strong>${escapeHtml(campaign.name)}</strong><span class="campaign-status">${escapeHtml(campaignStatus(campaign))}</span></div>
            <small>${escapeHtml(campaign.description || "Açıklama yok")}</small>
            <div class="campaign-meta">
              <span>İndirim: <b>${escapeHtml(discountSummary(campaign))}</b></span>
              <span>Başlangıç: <b>${escapeHtml(formatDate(campaign.startDate))}</b></span>
              <span>Bitiş: <b>${escapeHtml(formatDate(campaign.endDate))}</b></span>
              ${campaign.promoCode ? `<span>Kod: <b>${escapeHtml(campaign.promoCode)}</b></span>` : ""}
              ${campaign.minimumCartAmount ? `<span>Min. sepet: <b>${escapeHtml(money(campaign.minimumCartAmount, campaign.currency))}</b></span>` : ""}
            </div>
          </div>
        </article>`).join("") : `<p class="dialog-muted">Henüz kampanya yok.</p>`}
    </div>
  `);
  elements.dialogBody.querySelector("#newCampaign")?.addEventListener("click", openCampaignForm);
}

function openCampaignForm() {
  openDialog(elements, "Yeni kampanya", `
    <form id="campaignForm" class="dialog-form campaign-form" novalidate>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">Temel bilgiler</div>
        <label>Kampanya adı<input name="name" required maxlength="120" placeholder="Örn. Yaz Fırsatı"></label>
        <label>Kampanya detayları<textarea name="description" rows="3" maxlength="1000" placeholder="Kampanyanın kapsamı ve koşulları"></textarea></label>
      </div>
      <div class="campaign-form-grid">
        <label>Başlangıç tarihi<input name="startDate" type="datetime-local" required></label>
        <label>Bitiş tarihi <small>(opsiyonel)</small><input name="endDate" type="datetime-local"></label>
      </div>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">İndirim</div>
        <div class="campaign-form-grid">
          <label>İndirim şekli<select name="discountType" id="campaignDiscountType"><option value="percentage">Yüzde (%)</option><option value="fixed">Sabit tutar</option></select></label>
          <label>İndirim miktarı<input name="discountValue" type="number" min="0" step="0.01" required placeholder="Örn. 20"></label>
          <label id="campaignCurrencyWrap">Para birimi<select name="currency"><option value="TRY">TRY ₺</option><option value="USD">USD $</option><option value="EUR">EUR €</option></select></label>
          <label>Minimum sepet tutarı <small>(opsiyonel)</small><input name="minimumCartAmount" type="number" min="0" step="0.01" placeholder="Örn. 500"></label>
          <label id="campaignMaxDiscountWrap">Maksimum indirim tutarı <small>(opsiyonel)</small><input name="maxDiscountAmount" type="number" min="0" step="0.01" placeholder="Örn. 250"></label>
        </div>
      </div>
      <div class="campaign-form-section">
        <div class="campaign-form-section-title">Kampanya kodu ve kullanım</div>
        <div class="campaign-form-grid">
          <label>Kampanya kodu <small>(opsiyonel)</small><input name="promoCode" maxlength="40" placeholder="Örn. YAZ20" autocapitalize="characters"></label>
          <label>Kullanım limiti <small>(opsiyonel)</small><input name="usageLimit" type="number" min="1" step="1" placeholder="Sınırsız"></label>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button" id="cancelCampaign">İptal</button>
        <button type="submit" class="button button-primary">Kampanyayı oluştur</button>
      </div>
      <p id="campaignFormError" class="form-error" role="alert"></p>
    </form>
  `);

  const form = elements.dialogBody.querySelector("#campaignForm");
  const discountType = form.querySelector("#campaignDiscountType");
  const maxDiscountWrap = form.querySelector("#campaignMaxDiscountWrap");
  const startDate = form.querySelector('[name="startDate"]');
  const endDate = form.querySelector('[name="endDate"]');
  const syncDiscount = () => {
    maxDiscountWrap.hidden = discountType.value !== "percentage";
  };
  discountType.addEventListener("change", syncDiscount);
  syncDiscount();

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  startDate.value = now.toISOString().slice(0, 16);

  form.querySelector("#cancelCampaign").addEventListener("click", renderCampaigns);
  form.addEventListener("submit", (event) => {
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

    const campaign = {
      id: crypto.randomUUID(),
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
      usedCount: 0,
      status: "aktif",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const before = store.dataSnapshot();
    store.set({ campaigns: [...store.get().campaigns, campaign] });
    store.recordHistory("Kampanya oluşturuldu", before, store.dataSnapshot());
    window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
    toast(elements, `“${name}” kampanyası oluşturuldu.`);
    renderCampaigns();
  });
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
}

const style = document.createElement("style");
style.textContent = `
.campaign-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}.campaign-toolbar-copy{display:grid;gap:3px}.campaign-toolbar-copy span{font-size:12px;opacity:.65}.campaign-card{padding:14px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(15,23,42,.35);margin-bottom:9px}.campaign-card-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.campaign-status{font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(52,211,153,.12);color:#34d399}.campaign-card-main small{display:block;margin-top:5px;opacity:.68}.campaign-meta{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px;font-size:11px;opacity:.72}.campaign-meta b{opacity:1;color:inherit}.campaign-form{display:grid;gap:16px}.campaign-form-section{display:grid;gap:10px}.campaign-form-section-title{font-weight:700;font-size:13px}.campaign-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.campaign-form label{display:grid;gap:6px;font-size:12px}.campaign-form label small{opacity:.55;font-weight:400}.campaign-form input,.campaign-form textarea,.campaign-form select{width:100%;box-sizing:border-box}.campaign-form textarea{resize:vertical;min-height:76px}.campaign-form .dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}.campaign-form-error{min-height:18px}.campaign-form [hidden]{display:none!important}@media(max-width:650px){.campaign-toolbar{align-items:stretch;flex-direction:column}.campaign-form-grid{grid-template-columns:1fr}}
`;
document.head.appendChild(style);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", install, { once: true });
} else {
  install();
}
window.addEventListener("region-console:campaigns-open", renderCampaigns);
