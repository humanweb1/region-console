import { store } from "../../state/store.js";
import { openDialog, toast } from "../../components/shell.js";
import { PERMISSIONS, can, getAccess, listUsers, createUser, updateUser, createRole, updateRole } from "../../services/rbac.js";

const button = document.getElementById("usersButton");
const dialog = {
  app: document.getElementById("appDialog"),
  body: document.getElementById("dialogBody"),
  title: document.getElementById("dialogTitle")
};
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const session = () => store.get().auth?.session || null;
let access = null;
let regionCatalog = [];

function opts(items, selected = "", placeholder = "Seçiniz") {
  return `<option value="">${placeholder}</option>` + (items || []).map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(selected) ? "selected" : ""}>${esc(x.name || x.title || "İsimsiz")}</option>`).join("");
}
function regionsByType(type) { return regionCatalog.filter((region) => String(region.type) === type); }
function childrenOf(parentId, type) {
  if (!parentId) return [];
  return regionCatalog.filter((region) => String(region.parent_id || "") === String(parentId) && (!type || String(region.type) === type));
}
function findRegion(id, type = null) {
  return regionCatalog.find((region) => String(region.id) === String(id) && (!type || String(region.type) === type)) || null;
}
function countries() { return regionsByType("country"); }
function countryProvinces(country) { return childrenOf(country?.id, "province"); }
function provinceDistricts(province) { return childrenOf(province?.id, "district"); }

function scopeRow(scope = {}) {
  return `<div class="rbac-scope-row"><select class="scope-country">${opts(countries(), scope.country_id, "Ülke")}</select><select class="scope-province"><option value="">İl</option></select><select class="scope-district"><option value="">İlçe</option></select><button type="button" class="button rbac-scope-remove">×</button></div>`;
}
function populate(row, scope = {}) {
  const countryId = scope.country_id || row.querySelector(".scope-country").value;
  const country = findRegion(countryId, "country");
  const provinces = countryProvinces(country);
  const provinceSelect = row.querySelector(".scope-province");
  const districtSelect = row.querySelector(".scope-district");
  provinceSelect.innerHTML = opts(provinces, scope.province_id, "İl");
  provinceSelect.disabled = !country || !provinces.length;
  const province = findRegion(scope.province_id || provinceSelect.value, "province");
  const districts = provinceDistricts(province);
  districtSelect.innerHTML = opts(districts, scope.district_id, "İlçe");
  districtSelect.disabled = !province || !districts.length;
}
function read(root) {
  return [...root.querySelectorAll(".rbac-scope-row")].map((row) => {
    const countryId = row.querySelector(".scope-country").value;
    const provinceId = row.querySelector(".scope-province").value;
    const districtId = row.querySelector(".scope-district").value;
    if (!countryId && !provinceId && !districtId) return null;
    const country = findRegion(countryId, "country");
    const province = findRegion(provinceId, "province");
    const district = findRegion(districtId, "district");
    return { country_id: countryId || null, country_name: country?.name || null, province_id: provinceId || null, province_name: province?.name || null, district_id: districtId || null, district_name: district?.name || null };
  }).filter(Boolean);
}
function wire(root, initial = []) {
  const list = root.querySelector(".rbac-scopes");
  root.querySelector(".rbac-scope-add")?.addEventListener("click", () => { list.insertAdjacentHTML("beforeend", scopeRow()); wireRow(list.lastElementChild); });
  initial.forEach((scope) => { list.insertAdjacentHTML("beforeend", scopeRow(scope)); wireRow(list.lastElementChild, scope); });
}
function wireRow(row, scope = {}) {
  populate(row, scope);
  row.querySelector(".scope-country").addEventListener("change", () => { row.querySelector(".scope-province").value = ""; row.querySelector(".scope-district").value = ""; populate(row); });
  row.querySelector(".scope-province").addEventListener("change", () => { row.querySelector(".scope-district").value = ""; populate(row); });
  row.querySelector(".rbac-scope-remove").addEventListener("click", () => row.remove());
}
function editor() { return `<fieldset class="rbac-scope-fieldset"><legend>Bölge yetkisi</legend><p class="dialog-muted">Ülke tüm alt bölgeleri, il tüm ilçeleri kapsar. İlçe yalnızca seçilen ilçeyi kapsar.</p><div class="rbac-scopes"></div><button type="button" class="button rbac-scope-add">+ Yetki alanı ekle</button></fieldset>`; }
function perms(selected = []) {
  const set = new Set(selected);
  return PERMISSIONS.map(([value, label]) => `<label class="rbac-permission"><input type="checkbox" name="permission" value="${esc(value)}" ${set.has(value) ? "checked" : ""}><span>${esc(label)}</span><code>${esc(value)}</code></label>`).join("");
}
function roleOpts(roles, selected) { return roles.map((role) => `<option value="${esc(role.id)}" ${String(role.id) === String(selected) ? "selected" : ""}>${esc(role.name)} — ${esc(role.description || "")}</option>`).join(""); }

async function openManager() {
  if (!access || !can(access, "users.manage")) return;
  const current = session();
  if (!current?.access_token) return;
  openDialog({ appDialog: dialog.app, dialogTitle: dialog.title, dialogBody: dialog.body }, "Yönetim · Kullanıcılar ve Roller", `<p class="dialog-muted">Kullanıcı, rol, izin ve bölge kapsamlarını tek ekrandan yönetin.</p><div id="rbacManagement"><p class="dialog-muted">Yükleniyor…</p></div>`);
  try { render(await listUsers(current.access_token)); } catch (error) { dialog.body.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; }
}

function render(data) {
  const { users = [], roles = [], permissionsByRole = {}, scopesByRole = {}, regionCatalog: catalog = [] } = data;
  regionCatalog = catalog;
  dialog.body.innerHTML = `<div class="rbac-tabs"><button class="button button-primary" data-tab="users">Kullanıcılar <b>${users.length}</b></button><button class="button" data-tab="roles">Roller <b>${roles.length}</b></button></div><section data-section="users"><form id="createUserForm" class="dialog-form"><h3>Yeni kullanıcı</h3><div class="rbac-form-grid"><label>Ad soyad<input name="full_name" required></label><label>E-posta<input name="email" type="email" required></label><label>Geçici şifre<input name="password" type="password" minlength="8" required></label><label>Rol<select name="role_id" required>${roleOpts(roles.filter((role) => role.name !== "super_admin"), roles.find((role) => role.name !== "super_admin")?.id)}</select></label></div><button class="button button-primary" type="submit">Kullanıcı oluştur</button><p class="form-error"></p></form><div class="rbac-user-list"><h3>Kullanıcılar</h3>${users.map((user) => `<article class="rbac-user-card" data-user-id="${esc(user.id)}"><div><strong>${esc(user.full_name || user.email)}</strong><small>${esc(user.email)}</small></div><select class="rbac-user-role">${roleOpts(roles, user.role_id)}</select><label class="rbac-active"><input class="rbac-user-active" type="checkbox" ${user.is_active ? "checked" : ""}> Aktif</label><button class="button rbac-user-save" type="button">Kaydet</button></article>`).join("")}</div></section><section data-section="roles" hidden><form id="createRoleForm" class="dialog-form"><h3>Yeni rol</h3><div class="rbac-form-grid"><label>Rol adı<input name="name" placeholder="supervisor" required></label><label>Açıklama<input name="description" required></label></div><fieldset><legend>İzinler</legend><div class="rbac-permission-grid">${perms()}</div></fieldset>${editor()}<button class="button button-primary" type="submit">Rol oluştur</button><p class="form-error"></p></form><div class="rbac-role-list"><h3>Roller ve yetki alanları</h3>${roles.filter((role) => role.name !== "super_admin").map((role) => `<details class="rbac-role-card"><summary><strong>${esc(role.name)}</strong><span>${esc(role.description || "")}</span><em>${(scopesByRole[role.id] || []).length ? `${scopesByRole[role.id].length} kapsam` : "Kapsam yok"}</em></summary><form class="dialog-form rbac-role-form" data-role-id="${esc(role.id)}"><div class="rbac-form-grid"><label>Rol adı<input name="name" value="${esc(role.name)}" required></label><label>Açıklama<input name="description" value="${esc(role.description || "")}" required></label></div><fieldset><legend>İzinler</legend><div class="rbac-permission-grid">${perms(permissionsByRole[role.id] || [])}</div></fieldset>${editor()}<button class="button button-primary" type="submit">Rolü ve yetkileri kaydet</button><p class="form-error"></p></form></details>`).join("")}</div></section>`;
  dialog.body.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => { dialog.body.querySelectorAll("[data-section]").forEach((section) => { section.hidden = section.dataset.section !== tab.dataset.tab; }); dialog.body.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("button-primary", item === tab)); }));
  dialog.body.querySelectorAll(".rbac-role-form").forEach((form) => { wire(form, scopesByRole[form.dataset.roleId] || []); form.addEventListener("submit", (event) => { event.preventDefault(); saveRole(form); }); });
  const createRoleForm = dialog.body.querySelector("#createRoleForm");
  wire(createRoleForm);
  createRoleForm.addEventListener("submit", (event) => { event.preventDefault(); saveCreateRole(createRoleForm); });
  const createUserForm = dialog.body.querySelector("#createUserForm");
  createUserForm.addEventListener("submit", (event) => { event.preventDefault(); saveCreateUser(createUserForm); });
  dialog.body.querySelectorAll(".rbac-user-save").forEach((saveButton) => saveButton.addEventListener("click", () => saveUser(saveButton)));
}

async function saveCreateRole(form) {
  const button = form.querySelector("button[type=submit]"); const error = form.querySelector(".form-error");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.permissions = [...form.querySelectorAll("input[name=permission]:checked")].map((input) => input.value); payload.scopes = read(form); button.disabled = true; error.textContent = "";
  try { await createRole(session().access_token, payload); toast({ toast: document.getElementById("toast") }, "Rol ve bölge kapsamı oluşturuldu."); render(await listUsers(session().access_token)); } catch (exception) { error.textContent = exception.message; } finally { button.disabled = false; }
}
async function saveRole(form) {
  const button = form.querySelector("button[type=submit]"); const error = form.querySelector(".form-error");
  const payload = Object.fromEntries(new FormData(form).entries()); payload.role_id = form.dataset.roleId; payload.permissions = [...form.querySelectorAll("input[name=permission]:checked")].map((input) => input.value); payload.scopes = read(form); button.disabled = true; error.textContent = "";
  try { await updateRole(session().access_token, payload); toast({ toast: document.getElementById("toast") }, "Rol ve bölge yetkileri güncellendi."); try { render(await listUsers(session().access_token)); } catch (refreshError) { if (can(access, "users.manage")) throw refreshError; dialog.app?.close(); } } catch (exception) { error.textContent = exception.message; } finally { button.disabled = false; }
}
async function saveCreateUser(form) {
  const button = form.querySelector("button[type=submit]"); const error = form.querySelector(".form-error"); const payload = Object.fromEntries(new FormData(form).entries()); button.disabled = true; error.textContent = "";
  try { await createUser(session().access_token, payload); toast({ toast: document.getElementById("toast") }, "Kullanıcı oluşturuldu."); render(await listUsers(session().access_token)); } catch (exception) { error.textContent = exception.message; } finally { button.disabled = false; }
}
async function saveUser(saveButton) {
  const card = saveButton.closest("[data-user-id]"); saveButton.disabled = true;
  try { await updateUser(session().access_token, { user_id: card.dataset.userId, role_id: card.querySelector(".rbac-user-role").value, is_active: card.querySelector(".rbac-user-active").checked }); toast({ toast: document.getElementById("toast") }, "Kullanıcı güncellendi."); } catch (exception) { toast({ toast: document.getElementById("toast") }, exception.message); } finally { saveButton.disabled = false; }
}
button?.addEventListener("click", (event) => { if (!access || !can(access, "users.manage")) return; event.preventDefault(); event.stopImmediatePropagation(); openManager(); }, true);
async function refreshAccess() {
  const current = session(); if (!current?.access_token || !current.user?.id) { access = null; return; }
  try { access = await getAccess(current.access_token, current.user.id); } catch (error) { console.error("RBAC management", error); access = null; }
}
store.subscribe(() => { refreshAccess(); });
refreshAccess();
