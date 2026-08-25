import { store } from "../../state/store.js";
import { saveState } from "../../services/cloud.js";
import { getElements, openDialog, closeDialog, toast } from "../../components/shell.js";

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
  if (campaign?.expiredAt || campaign?.status === "expired" || campaign?.status === "limit_reached") {
    return campaign?.status === "limit_reached" ? "Limiti doldu" : "Süresi doldu";
  }
  const now = Date.now();
  const start = campaign?.startDate ? new Date(campaign.startDate).getTime() : null;
  const end = campaign?.endDate ? new Date(campaign.endDate).getTime() : null;
  const limit = Number(campaign?.usageLimit);
  const used = Number(campaign?.usedCount || 0);
  if (Number.isFinite(limit) && limit > 0 && used >= limit) return "Limiti doldu";
  if (start && now < start) return "Yaklaşan";
  if (end && now >= end) return "Süresi doldu";
  return "Aktif";
}

function isCampaignUsable(campaign) {
  return campaignStatus(campaign) === "Aktif";
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

function allRegions() {
  const result = [];
  const seen = new Set();
  const add = (region, path = []) => {
    if (!region?.id || seen.has(String(region.id))) return;
    seen.add(String(region.id));
    result.push({ region, path: [...path, region.name || "Bölge"] });
  };
  const visit = (items, path = []) => {
    for (const region of items || []) {
      if (!region) continue;
      add(region, path);
      const next = [...path, region.name || "Bölge"];
      visit(region.provinces, next);
      visit(region.districts, next);
      visit(region.neighborhoods, next);
      visit(region.cemeteries, next);
      visit(region.children, next);
    }
  };
  visit(store.get().regions?.countries || []);
  visit(store.get().regions?.custom || []);
  return result.sort((a, b) => a.path.join("/").localeCompare(b.path.join("/"), "tr-TR"));
}

function regionCampaignId(region) {
  return region?.campaignId ? String(region.campaignId) : "";
}

async function expireCampaigns() {
  const campaigns = Array.isArray(store.get().campaigns) ? store.get().campaigns : [];
  const now = Date.now();
  const toExpire = new Map();
  for (const campaign of campaigns) {
    const endMs = campaign.endDate ? new Date(campaign.endDate).getTime() : null;
    const limit = Number(campaign.usageLimit);
    const used = Number(campaign.usedCount || 0);
    if (campaign.expiredAt || campaign.status === "expired" || campaign.status === "limit_reached") continue;
    if ((endMs && Number.isFinite(endMs) && endMs <= now) || (Number.isFinite(limit) && limit > 0 && used >= limit)) {
      toExpire.set(String(campaign.id), Number.isFinite(limit) && limit > 0 && used >= limit ? "limit_reached" : "expired");
    }
  }
  if (!toExpire.size) return false;

  const before = store.dataSnapshot();
  const nowIso = new Date().toISOString();
  const nextCampaigns = campaigns.map((campaign) => {
    const reason = toExpire.get(String(campaign.id));
    return reason ? { ...campaign, status: reason, expiredAt: nowIso, updatedAt: nowIso } : campaign;
  });
  const nextCustom = (store.get().regions?.custom || []).map((region) => {
    const reason = toExpire.get(regionCampaignId(region));
    if (!reason) return region;
    return { ...region, campaignId: null, campaign: false, status: region.status === "campaign" ? "service" : region.status, updatedAt: nowIso };
  });
  const countries = structuredClone(store.get().regions?.countries || []);
  walkRegions(countries, (region) => {
    const reason = toExpire.get(regionCampaignId(region));
    if (!reason) return;
    region.campaignId = null;
    region.campaign = false;
    if (region.status === "campaign") region.status = "service";
    region.updatedAt = nowIso;
  });

  store.set({ campaigns: nextCampaigns, regions: { ...store.get().regions, custom: nextCustom, countries } });
  const labels = [...toExpire.values()];
  const limitCount = labels.filter((item) => item === "limit_reached").length;
  const timeCount = labels.length - limitCount;
  store.recordHistory(`Kampanyalar otomatik sonlandırıldı (${timeCount} süre, ${limitCount} limit)`, before, store.dataSnapshot());
  await persistCampaigns();
  window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
  return true;
}

function statusCounts(campaigns) {
  return campaigns.reduce((counts, campaign) => {
    const status = campaignStatus(campaign);
    if (status === "Yaklaşan") counts.upcoming += 1;
    if (status === "Aktif") counts.active += 1;
    if (status === "Süresi doldu") counts.expired += 1;
    if (status === "Limiti doldu") counts.limit += 1;
    return counts;
  }, { upcoming: 0, active: 0, expired: 0, limit: 0 });
}

function renderCampaigns() {
  const campaigns = Array.isArray(store.get().campaigns) ? store.get().campaigns : [];
  const counts = statusCounts(campaigns);
  const campaignedRegions = allRegions().filter(({ region }) => Boolean(regionCampaignId(region)));
  const currentTab = elements.dialogBody?.dataset?.campaignTab || "active";
  const tab = ["upcoming", "expired", "limit", "active", "regions"].includes(currentTab) ? currentTab : "active";
  const filteredCampaigns = campaigns.filter((campaign) => {
    if (tab === "upcoming") return campaignStatus(campaign) === "Yaklaşan";
    if (tab === "expired") return campaignStatus(campaign) === "Süresi doldu";
    if (tab === "limit") return campaignStatus(campaign) === "Limiti doldu";
    if (tab === "active") return campaignStatus(campaign) === "Aktif";
    return true;
  });

  openDialog(elements, "Kampanyalar", `
    <div class="campaign-toolbar">
      <div class="campaign-toolbar-copy"><strong>Kampanya yönetimi</strong><span>Durumları takip edin, kampanyaları yönetin ve bölgelerde toplu işlem yapın.</span></div>
      <div class="campaign-toolbar-actions">
        <button id="bulkCampaign" class="button" type="button">Toplu kampanya</button>
        <button id="bulkCloseCampaign" class="button button-danger" type="button">Toplu kapat</button>
        <button id="newCampaign" class="button button-primary" type="button">Yeni kampanya</button>
      </div>
    </div>
    <div class="campaign-tabs" role="tablist">
      <button class="campaign-tab ${tab === "upcoming" ? "active" : ""}" data-campaign-tab="upcoming">Yaklaşan <b>${counts.upcoming}</b></button>
      <button class="campaign-tab ${tab === "expired" ? "active" : ""}" data-campaign-tab="expired">Süresi dolan <b>${counts.expired}</b></button>
      <button class="campaign-tab ${tab === "limit" ? "active" : ""}" data-campaign-tab="limit">Limiti dolan <b>${counts.limit}</b></button>
      <button class="campaign-tab ${tab === "active" ? "active" : ""}" data-campaign-tab="active">Aktif <b>${counts.active}</b></button>
      <button class="campaign-tab ${tab === "regions" ? "active" : ""}" data-campaign-tab="regions">Kampanyalı bölgeler <b>${campaignedRegions.length}</b></button>
    </div>
    ${tab === "regions" ? renderCampaignedRegions(campaignedRegions) : `
      <div class="campaign-list">
        ${filteredCampaigns.length ? filteredCampaigns.map((campaign) => renderCampaignCard(campaign)).join("") : `<p class="dialog-muted">Bu kategoride kampanya bulunmuyor.</p>`}
      </div>
    `}
  `);

  elements.dialogBody.dataset.campaignTab = tab;
  elements.dialogBody.querySelectorAll("[data-campaign-tab]").forEach((button) => button.addEventListener("click", () => {
    elements.dialogBody.dataset.campaignTab = button.dataset.campaignTab;
    renderCampaigns();
  }));
  elements.dialogBody.querySelector("#newCampaign")?.addEventListener("click", () => openCampaignForm(null));
  elements.dialogBody.querySelector("#bulkCampaign")?.addEventListener("click", () => openBulkRegionDialog("apply"));
  elements.dialogBody.querySelector("#bulkCloseCampaign")?.addEventListener("click", () => openBulkRegionDialog("close"));
  elements.dialogBody.querySelectorAll("[data-campaign-action='edit']").forEach((button) => button.addEventListener("click", () => openCampaignForm(button.closest("[data-campaign-id]")?.dataset.campaignId || null)));
  elements.dialogBody.querySelectorAll("[data-campaign-action='delete']").forEach((button) => button.addEventListener("click", () => openDeleteConfirmation(button.closest("[data-campaign-id]")?.dataset.campaignId || null)));
}

function renderCampaignCard(campaign) {
  const status = campaignStatus(campaign);
  const limit = Number(campaign.usageLimit);
  const used = Number(campaign.usedCount || 0);
  return `
    <article class="campaign-card" data-campaign-id="${escapeHtml(campaign.id)}">
      <div class="campaign-card-main">
        <div class="campaign-card-title"><strong>${escapeHtml(campaign.name)}</strong><span class="campaign-status campaign-status-${status === "Aktif" ? "active" : status === "Limiti doldu" ? "limit" : status === "Süresi doldu" ? "expired" : "upcoming"}">${escapeHtml(status)}</span></div>
        <small>${escapeHtml(campaign.description || "Açıklama yok")}</small>
        <div class="campaign-meta">
          <span>İndirim: <b>${escapeHtml(discountSummary(campaign))}</b></span>
          <span>Başlangıç: <b>${escapeHtml(formatDate(campaign.startDate))}</b></span>
          <span>Bitiş: <b>${escapeHtml(formatDate(campaign.endDate))}</b></span>
          ${campaign.promoCode ? `<span>Kod: <b>${escapeHtml(campaign.promoCode)}</b></span>` : ""}
          ${campaign.minimumCartAmount ? `<span>Min. sepet: <b>${escapeHtml(money(campaign.minimumCartAmount, campaign.currency))}</b></span>` : ""}
          ${campaign.usageLimit ? `<span>Limit: <b>${escapeHtml(`${used}/${limit}`)}</b></span>` : `<span>Limit: <b>Sınırsız</b></span>`}
        </div>
      </div>
      <div class="campaign-card-actions">
        <button class="button campaign-edit-button" type="button" data-campaign-action="edit">Düzenle</button>
        <button class="button button-danger campaign-delete-button" type="button" data-campaign-action="delete">Sil</button>
      </div>
    </article>`;
}

function renderCampaignedRegions(items) {
  if (!items.length) return `<p class="dialog-muted">Henüz kampanyalı bölge yok.</p>`;
  return `<div class="bulk-region-list">${items.map(({ region, path }) => {
    const campaign = (store.get().campaigns || []).find((item) => String(item.id) === String(region.campaignId));
    return `<label class="bulk-region-row"><input type="checkbox" value="${escapeHtml(region.id)}" data-region-check><span><strong>${escapeHtml(region.name || "Bölge")}</strong><small>${escapeHtml(path.join(" / "))}</small></span><em>${escapeHtml(campaign?.name || "Tanımsız kampanya")}</em></label>`;
  }).join("")}</div>`;
}

function openBulkRegionDialog(mode) {
  const regions = allRegions().filter(({ region }) => mode === "close" ? Boolean(regionCampaignId(region)) : true);
  if (!regions.length) return toast(elements, mode === "close" ? "Kampanyalı bölge bulunmuyor." : "Uygulanabilecek bölge bulunmuyor.");
  const campaigns = (store.get().campaigns || []).filter(isCampaignUsable);
  if (mode === "apply" && !campaigns.length) return toast(elements, "Toplu uygulama için aktif kampanya bulunmuyor.");
  openDialog(elements, mode === "apply" ? "Toplu kampanya uygula" : "Toplu kampanya kapat", `
    <div class="bulk-campaign-dialog">
      <p class="dialog-muted">${mode === "apply" ? "Kampanya uygulanacak bölgeleri seçin." : "Kampanyadan çıkarılacak bölgeleri seçin."}</p>
      ${mode === "apply" ? `<label>Kampanya<select id="bulkCampaignSelect">${campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}</option>`).join("")}</select></label>` : ""}
      <div class="bulk-region-tools"><input id="bulkRegionSearch" type="search" placeholder="Bölge ara..."><button id="bulkSelectAll" class="button" type="button">Tümünü seç</button><button id="bulkClearAll" class="button" type="button">Temizle</button></div>
      <div id="bulkRegionList" class="bulk-region-list">${regions.map(({ region, path }) => `<label class="bulk-region-row"><input type="checkbox" value="${escapeHtml(region.id)}" data-region-check><span><strong>${escapeHtml(region.name || "Bölge")}</strong><small>${escapeHtml(path.join(" / "))}</small></span>${regionCampaignId(region) ? `<em>${escapeHtml((store.get().campaigns || []).find((item) => String(item.id) === regionCampaignId(region))?.name || "Kampanya")}</em>` : ""}</label>`).join("")}</div>
      <div class="dialog-actions"><button id="bulkCancel" class="button" type="button">İptal</button><button id="bulkConfirm" class="button ${mode === "apply" ? "button-primary" : "button-danger"}" type="button">${mode === "apply" ? "Kampanyayı uygula" : "Kampanyaları kapat"}</button></div>
    </div>
  `);

  const list = elements.dialogBody.querySelector("#bulkRegionList");
  const search = elements.dialogBody.querySelector("#bulkRegionSearch");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase("tr-TR");
    list.querySelectorAll(".bulk-region-row").forEach((row) => {
      row.hidden = query && !row.textContent.toLocaleLowerCase("tr-TR").includes(query);
    });
  });
  elements.dialogBody.querySelector("#bulkSelectAll").addEventListener("click", () => list.querySelectorAll("[data-region-check]:not([disabled])").forEach((input) => { input.checked = true; }));
  elements.dialogBody.querySelector("#bulkClearAll").addEventListener("click", () => list.querySelectorAll("[data-region-check]").forEach((input) => { input.checked = false; }));
  elements.dialogBody.querySelector("#bulkCancel").addEventListener("click", renderCampaigns);
  elements.dialogBody.querySelector("#bulkConfirm").addEventListener("click", async () => {
    const ids = new Set([...list.querySelectorAll("[data-region-check]:checked")].map((input) => String(input.value)));
    if (!ids.size) return toast(elements, "En az bir bölge seçin.");
    const campaignId = mode === "apply" ? elements.dialogBody.querySelector("#bulkCampaignSelect").value : "";
    const before = store.dataSnapshot();
    const nowIso = new Date().toISOString();
    const updateRegion = (region) => {
      if (!ids.has(String(region.id))) return region;
      if (mode === "apply") return { ...region, campaignId, campaign: true, status: "campaign", updatedAt: nowIso };
      return { ...region, campaignId: null, campaign: false, status: region.status === "campaign" ? "service" : region.status, updatedAt: nowIso };
    };
    const custom = (store.get().regions?.custom || []).map(updateRegion);
    const countries = structuredClone(store.get().regions?.countries || []);
    walkRegions(countries, (region) => {
      if (!ids.has(String(region.id))) return;
      const next = updateRegion(region);
      Object.assign(region, next);
    });
    store.set({ regions: { ...store.get().regions, custom, countries } });
    store.recordHistory(mode === "apply" ? `${ids.size} bölgeye toplu kampanya uygulandı` : `${ids.size} bölgenin kampanyası toplu kapatıldı`, before, store.dataSnapshot());
    await persistCampaigns();
    window.dispatchEvent(new CustomEvent("region-console:campaigns-changed"));
    toast(elements, mode === "apply" ? `${ids.size} bölgeye kampanya uygulandı.` : `${ids.size} bölgenin kampanyası kapatıldı.`);
    renderCampaigns();
  });
}

function openDeleteConfirmation(campaignId) {
  const campaign = (store.get().campaigns || []).find((item) => String(item.id) === String(campaignId));
  if (!campaign) return;
  openDialog(elements, "Kampanyayı sil", `<div class="campaign-delete-dialog"><p><strong>${escapeHtml(campaign.name)}</strong> kampanyasını silmek istediğinize emin misiniz?</p><p class="dialog-muted">Kampanya kaydı ve bu kampanyaya bağlı bölge bağlantıları kaldırılır. İşlem geçmişe kaydedilir.</p><div class="dialog-actions"><button type="button" class="button" id="cancelCampaignDelete">İptal</button><button type="button" class="button button-danger" id="confirmCampaignDelete">Kampanyayı sil</button></div></div>`);
  elements.dialogBody.querySelector("#cancelCampaignDelete")?.addEventListener("click", renderCampaigns);
  elements.dialogBody.querySelector("#confirmCampaignDelete")?.addEventListener("click", async () => {
    const before = store.dataSnapshot();
    const nowIso = new Date().toISOString();
    const clear = (region) => String(region.campaignId) === String(campaignId) ? { ...region, campaignId: null, campaign: false, status: region.status === "campaign" ? "service" : region.status, updatedAt: nowIso } : region;
    const custom = (store.get().regions?.custom || []).map(clear);
    const countries = structuredClone(store.get().regions?.countries || []);
    walkRegions(countries, (region) => Object.assign(region, clear(region)));
    store.set({ campaigns: (store.get().campaigns || []).filter((item) => String(item.id) !== String(campaignId)), regions: { ...store.get().regions, custom, countries } });
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
  openDialog(elements, editing ? "Kampanyayı düzenle" : "Yeni kampanya", `<form id="campaignForm" class="dialog-form campaign-form" novalidate>
    <div class="campaign-form-section"><div class="campaign-form-section-title">Temel bilgiler</div><label>Kampanya adı<input name="name" required maxlength="120" placeholder="Örn. Yaz Fırsatı" value="${escapeHtml(existing?.name || "")}"></label><label>Kampanya detayları<textarea name="description" rows="3" maxlength="1000" placeholder="Kampanyanın kapsamı ve koşulları">${escapeHtml(existing?.description || "")}</textarea></label></div>
    <div class="campaign-form-grid"><label>Başlangıç tarihi<input name="startDate" type="datetime-local" required value="${escapeHtml(toLocalInput(existing?.startDate))}"></label><label>Bitiş tarihi <small>(opsiyonel)</small><input name="endDate" type="datetime-local" value="${escapeHtml(toLocalInput(existing?.endDate))}"></label></div>
    <div class="campaign-form-section"><div class="campaign-form-section-title">İndirim</div><div class="campaign-form-grid"><label>İndirim şekli<select name="discountType" id="campaignDiscountType"><option value="percentage" ${existing?.discountType === "percentage" || !existing ? "selected" : ""}>Yüzde (%)</option><option value="fixed" ${existing?.discountType === "fixed" ? "selected" : ""}>Sabit tutar</option></select></label><label>İndirim miktarı<input name="discountValue" type="number" min="0" step="0.01" required value="${escapeHtml(existing?.discountValue ?? "")}"></label><label>Para birimi<select name="currency"><option value="TRY" ${existing?.currency === "TRY" || !existing ? "selected" : ""}>TRY ₺</option><option value="USD" ${existing?.currency === "USD" ? "selected" : ""}>USD $</option><option value="EUR" ${existing?.currency === "EUR" ? "selected" : ""}>EUR €</option></select></label><label>Minimum sepet tutarı <small>(opsiyonel)</small><input name="minimumCartAmount" type="number" min="0" step="0.01" value="${escapeHtml(existing?.minimumCartAmount ?? "")}"></label><label id="campaignMaxDiscountWrap">Maksimum indirim tutarı <small>(opsiyonel)</small><input name="maxDiscountAmount" type="number" min="0" step="0.01" value="${escapeHtml(existing?.maxDiscountAmount ?? "")}"></label></div></div>
    <div class="campaign-form-section"><div class="campaign-form-section-title">Kampanya kodu ve kullanım</div><div class="campaign-form-grid"><label>Kampanya kodu <small>(opsiyonel)</small><input name="promoCode" maxlength="40" placeholder="Örn. YAZ20" autocapitalize="characters" value="${escapeHtml(existing?.promoCode || "")}"></label><label>Kullanım limiti <small>(opsiyonel)</small><input name="usageLimit" type="number" min="1" step="1" placeholder="Sınırsız" value="${escapeHtml(existing?.usageLimit ?? "")}"></label></div></div>
    <div class="dialog-actions"><button type="button" class="button" id="cancelCampaign">İptal</button><button type="submit" class="button button-primary">${editing ? "Değişiklikleri kaydet" : "Kampanyayı oluştur"}</button></div><p id="campaignFormError" class="form-error" role="alert"></p>
  </form>`);
  const form = elements.dialogBody.querySelector("#campaignForm");
  const discountType = form.querySelector("#campaignDiscountType");
  const maxDiscountWrap = form.querySelector("#campaignMaxDiscountWrap");
  const startDate = form.querySelector('[name="startDate"]');
  const syncDiscount = () => { maxDiscountWrap.hidden = discountType.value !== "percentage"; };
  discountType.addEventListener("change", syncDiscount); syncDiscount();
  if (!editing) { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); startDate.value = now.toISOString().slice(0, 16); }
  form.querySelector("#cancelCampaign").addEventListener("click", renderCampaigns);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form); const error = form.querySelector("#campaignFormError");
    const name = String(data.get("name") || "").trim(); const description = String(data.get("description") || "").trim();
    const start = String(data.get("startDate") || ""); const end = String(data.get("endDate") || "");
    const discountTypeValue = String(data.get("discountType") || "percentage"); const discountValue = Number(data.get("discountValue")); const currency = String(data.get("currency") || "TRY");
    const minimumCartAmount = data.get("minimumCartAmount") === "" ? null : Number(data.get("minimumCartAmount"));
    const maxDiscountAmount = discountTypeValue === "percentage" && data.get("maxDiscountAmount") !== "" ? Number(data.get("maxDiscountAmount")) : null;
    const promoCode = String(data.get("promoCode") || "").trim().toUpperCase(); const usageLimit = data.get("usageLimit") === "" ? null : Number(data.get("usageLimit"));
    const startMs = start ? new Date(start).getTime() : NaN; const endMs = end ? new Date(end).getTime() : null;
    if (!name) return (error.textContent = "Kampanya adı zorunludur.");
    if (!start || Number.isNaN(startMs)) return (error.textContent = "Başlangıç tarihi zorunludur.");
    if (end && (endMs === null || Number.isNaN(endMs) || endMs <= startMs)) return (error.textContent = "Bitiş tarihi başlangıç tarihinden sonra olmalıdır.");
    if (!Number.isFinite(discountValue) || discountValue <= 0) return (error.textContent = "İndirim miktarı 0'dan büyük olmalıdır.");
    if (discountTypeValue === "percentage" && discountValue > 100) return (error.textContent = "Yüzde indirimi 100'ü geçemez.");
    if (minimumCartAmount !== null && (!Number.isFinite(minimumCartAmount) || minimumCartAmount < 0)) return (error.textContent = "Minimum sepet tutarı geçersiz.");
    if (maxDiscountAmount !== null && (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount < 0)) return (error.textContent = "Maksimum indirim tutarı geçersiz.");
    if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) return (error.textContent = "Kullanım limiti en az 1 olmalıdır.");
    if (usageLimit !== null && Number(existing?.usedCount || 0) > usageLimit) return (error.textContent = "Yeni kullanım limiti mevcut kullanımdan düşük olamaz.");
    const nowIso = new Date().toISOString();
    const campaign = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), name, description, startDate: new Date(start).toISOString(), endDate: end ? new Date(end).toISOString() : null, discountType: discountTypeValue, discountValue, currency, minimumCartAmount, maxDiscountAmount, promoCode: promoCode || null, usageLimit, usedCount: existing?.usedCount || 0, status: "active", expiredAt: null, createdAt: existing?.createdAt || nowIso, updatedAt: nowIso };
    const before = store.dataSnapshot();
    const campaigns = existing ? store.get().campaigns.map((item) => String(item.id) === String(existing.id) ? campaign : item) : [...store.get().campaigns, campaign];
    store.set({ campaigns });
    store.recordHistory(existing ? `Kampanya düzenlendi: ${name}` : "Kampanya oluşturuldu", before, store.dataSnapshot());
    window.dispatchEvent(new CustomEvent("region-console:campaigns-changed")); await persistCampaigns(); toast(elements, existing ? `“${name}” kampanyası güncellendi.` : `“${name}” kampanyası oluşturuldu.`); renderCampaigns();
  });
}

async function refreshCampaignExpiry() {
  try {
    const changed = await expireCampaigns();
    if (changed && document.getElementById("campaignForm") == null && elements.dialogBody?.querySelector(".campaign-list, .bulk-region-list")) renderCampaigns();
  } catch (error) { console.error("[Region Console] Campaign expiry check failed:", error); }
}

function install() {
  if (active) return;
  const button = document.getElementById("campaignButton");
  if (!button) return;
  active = true;
  button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); renderCampaigns(); }, true);
  refreshCampaignExpiry();
  expiryTimer = window.setInterval(refreshCampaignExpiry, 60 * 1000);
  window.addEventListener("region-console:campaigns-changed", refreshCampaignExpiry);
}

const style = document.createElement("style");
style.textContent = `
.campaign-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px}.campaign-toolbar-copy{display:grid;gap:3px}.campaign-toolbar-copy span{font-size:12px;opacity:.65}.campaign-toolbar-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.campaign-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(148,163,184,.14)}.campaign-tab{border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.28);color:inherit;border-radius:9px;padding:8px 10px;cursor:pointer;font-size:11px}.campaign-tab b{margin-left:5px;opacity:.7}.campaign-tab.active{background:rgba(250,204,21,.12);border-color:rgba(250,204,21,.4)}.campaign-card{padding:14px;border:1px solid rgba(148,163,184,.18);border-radius:12px;background:rgba(15,23,42,.35);margin-bottom:9px}.campaign-card-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.campaign-status{font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(52,211,153,.12);color:#34d399}.campaign-status-upcoming{color:#60a5fa;background:rgba(96,165,250,.12)}.campaign-status-expired{color:#f87171;background:rgba(248,113,113,.12)}.campaign-status-limit{color:#f59e0b;background:rgba(245,158,11,.12)}.campaign-card-main small{display:block;margin-top:5px;opacity:.68}.campaign-meta{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px;font-size:11px;opacity:.72}.campaign-meta b{opacity:1}.campaign-card-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,.12)}.campaign-form{display:grid;gap:16px}.campaign-form-section{display:grid;gap:10px}.campaign-form-section-title{font-weight:700;font-size:13px}.campaign-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.campaign-form label,.bulk-campaign-dialog>label{display:grid;gap:6px;font-size:12px}.campaign-form label small{opacity:.55;font-weight:400}.campaign-form input,.campaign-form textarea,.campaign-form select,.bulk-campaign-dialog select,.bulk-region-tools input{width:100%;box-sizing:border-box}.campaign-form textarea{resize:vertical;min-height:76px}.campaign-form .dialog-actions,.campaign-delete-dialog .dialog-actions,.bulk-campaign-dialog .dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}.campaign-form [hidden]{display:none!important}.bulk-campaign-dialog{display:grid;gap:12px}.bulk-region-tools{display:flex;gap:7px;align-items:center}.bulk-region-tools input{flex:1}.bulk-region-list{display:grid;gap:6px;max-height:420px;overflow:auto;padding-right:3px}.bulk-region-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:9px 10px;border:1px solid rgba(148,163,184,.14);border-radius:9px;background:rgba(15,23,42,.22);cursor:pointer}.bulk-region-row>span{display:grid;gap:2px;min-width:0}.bulk-region-row small{font-size:10px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bulk-region-row em{font-size:10px;font-style:normal;opacity:.7}.button-danger{border-color:rgba(248,113,113,.35)!important;color:#f87171!important}.button-danger:hover{background:rgba(248,113,113,.1)!important}.campaign-delete-dialog{display:grid;gap:12px}@media(max-width:700px){.campaign-toolbar{align-items:stretch;flex-direction:column}.campaign-toolbar-actions{justify-content:stretch}.campaign-toolbar-actions .button{flex:1}.campaign-form-grid{grid-template-columns:1fr}.bulk-region-tools{flex-wrap:wrap}.bulk-region-tools input{flex-basis:100%}.bulk-region-row{grid-template-columns:auto 1fr}.bulk-region-row em{grid-column:2}}
`;
document.head.appendChild(style);

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
else install();
window.addEventListener("region-console:campaigns-open", renderCampaigns);