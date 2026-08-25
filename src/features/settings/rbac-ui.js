import { store } from "../../state/store.js";
import { openDialog, toast } from "../../components/shell.js";
import { PERMISSIONS, adminRbac, createManagedUser, hasPermission } from "../../services/rbac.js";

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function sessionToken() { return store.get().auth.session?.access_token; }
function can(permission) { return hasPermission(store.get().auth, permission); }
function roleOptions(roles, selected = "") { return roles.map((role) => `<option value="${escapeHtml(role.id)}" ${String(role.id) === String(selected) ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join(""); }
function permissionChecks(selected = []) { const set = new Set(selected); return PERMISSIONS.map(([key, label]) => `<label class="rbac-permission"><input type="checkbox" name="permission" value="${key}" ${set.has(key) ? "checked" : ""}><span>${escapeHtml(label)}</span><code>${key}</code></label>`).join(""); }
async function loadData() { return adminRbac(sessionToken(), { action: "list" }); }

function renderUsers(data) {
  const me = store.get().auth.user?.id;
  const rows = data.users.map((user) => `<tr><td><strong>${escapeHtml(user.full_name || "İsimsiz")}</strong><small>${escapeHtml(user.email)}</small></td><td><select data-user-role="${user.id}" ${user.id === me ? "disabled" : ""}>${roleOptions(data.roles, user.role_id)}</select></td><td><label class="rbac-switch"><input type="checkbox" data-user-active="${user.id}" ${user.is_active ? "checked" : ""} ${user.id === me ? "disabled" : ""}><span>${user.is_active ? "Aktif" : "Pasif"}</span></label></td><td><button class="button button-small" data-save-user="${user.id}" ${user.id === me ? "disabled" : ""}>Kaydet</button></td></tr>`).join("");
  return `<div class="rbac-toolbar"><button id="rbacNewUser" class="button button-primary">+ Yeni kullanıcı</button><button id="rbacRoles" class="button">Roller ve izinler</button></div><div class="rbac-table-wrap"><table class="rbac-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="dialog-muted">Kullanıcı bulunamadı.</td></tr>`}</tbody></table></div>`;
}
function renderNewUser(data) { return `<form id="rbacNewUserForm" class="dialog-form rbac-form"><p class="dialog-muted">Kullanıcı doğrudan aktif oluşturulur. Şifre yalnızca oluşturma anında kullanılır ve tarayıcıda saklanmaz.</p><label>Ad soyad<input name="full_name" required autocomplete="name"></label><label>E-posta<input name="email" type="email" required autocomplete="email"></label><label>Geçici şifre<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Rol<select name="role_id" required>${roleOptions(data.roles)}</select></label><div class="dialog-actions"><button type="button" id="rbacBackUsers" class="button">Geri</button><button class="button button-primary" type="submit">Kullanıcı oluştur</button></div><p id="rbacFormError" class="form-error"></p></form>`; }
function renderRoles(data) { const roleCards = data.roles.map((role) => `<article class="rbac-role-card"><div><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || "")}</small></div><button class="button button-small" data-edit-role="${role.id}" ${role.name === "super_admin" ? "disabled" : ""}>Düzenle</button></article>`).join(""); return `<div class="rbac-toolbar"><button id="rbacNewRole" class="button button-primary">+ Yeni rol</button><button id="rbacBackUsers" class="button">Kullanıcılar</button></div><div class="rbac-role-list">${roleCards}</div>`; }
function renderRoleForm(data, role = null) { const currentPermissions = data.permissionsByRole?.[role?.id] || []; return `<form id="rbacRoleForm" class="dialog-form rbac-form"><input type="hidden" name="role_id" value="${escapeHtml(role?.id || "")}"><label>Rol adı<input name="name" required value="${escapeHtml(role?.name || "")}" placeholder="supervizor"></label><label>Açıklama<input name="description" required value="${escapeHtml(role?.description || "")}" placeholder="Sadece kampanya ekranına erişebilir"></label><fieldset class="rbac-permissions"><legend>Erişim izinleri</legend>${permissionChecks(currentPermissions)}</fieldset><div class="dialog-actions"><button type="button" id="rbacBackRoles" class="button">Geri</button><button class="button button-primary" type="submit">${role ? "Rolü kaydet" : "Rol oluştur"}</button></div><p id="rbacFormError" class="form-error"></p></form>`; }

function elements() { return window.__regionConsoleElements; }
async function openUsers() { const data = await loadData(); openDialog(elements(), "Kullanıcılar ve Roller", renderUsers(data)); bindDialog(data); }
async function openRoles() { const data = await loadData(); openDialog(elements(), "Roller ve izinler", renderRoles(data)); bindDialog(data); }
async function openNewUser() { const data = await loadData(); openDialog(elements(), "Yeni kullanıcı", renderNewUser(data)); bindDialog(data); }
async function openRoleForm(role = null) { const data = await loadData(); openDialog(elements(), role ? `Rolü düzenle · ${role.name}` : "Yeni rol", renderRoleForm(data, role)); bindDialog(data); }

function bindDialog(data) {
  const el = elements();
  el.dialogBody.querySelector("#rbacNewUser")?.addEventListener("click", () => openNewUser().catch((e) => toast(el, e.message)));
  el.dialogBody.querySelector("#rbacRoles")?.addEventListener("click", () => openRoles().catch((e) => toast(el, e.message)));
  el.dialogBody.querySelector("#rbacBackUsers")?.addEventListener("click", () => openUsers().catch((e) => toast(el, e.message)));
  el.dialogBody.querySelector("#rbacNewRole")?.addEventListener("click", () => openRoleForm().catch((e) => toast(el, e.message)));
  el.dialogBody.querySelectorAll("[data-edit-role]").forEach((button) => button.addEventListener("click", () => { const role = data.roles.find((item) => item.id === button.dataset.editRole); if (role) openRoleForm(role).catch((e) => toast(el, e.message)); }));
  el.dialogBody.querySelectorAll("[data-save-user]").forEach((button) => button.addEventListener("click", async () => {
    const userId = button.dataset.saveUser;
    const roleId = el.dialogBody.querySelector(`[data-user-role="${userId}"]`)?.value;
    const active = el.dialogBody.querySelector(`[data-user-active="${userId}"]`)?.checked;
    button.disabled = true;
    try { await adminRbac(sessionToken(), { action: "update-user", user_id: userId, role_id: roleId, is_active: active }); toast(el, "Kullanıcı yetkileri güncellendi."); await openUsers(); } catch (error) { toast(el, error.message); button.disabled = false; }
  }));
  el.dialogBody.querySelector("#rbacNewUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const error = form.querySelector("#rbacFormError"); const button = form.querySelector("button[type=submit]"); error.textContent = ""; button.disabled = true;
    try { const fd = new FormData(form); await createManagedUser(sessionToken(), { full_name: String(fd.get("full_name") || "").trim(), email: String(fd.get("email") || "").trim().toLowerCase(), password: String(fd.get("password") || ""), role_id: String(fd.get("role_id") || "") }); toast(el, "Yeni kullanıcı oluşturuldu."); await openUsers(); } catch (err) { error.textContent = err.message; button.disabled = false; }
  });
  el.dialogBody.querySelector("#rbacRoleForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const error = form.querySelector("#rbacFormError"); const button = form.querySelector("button[type=submit]"); error.textContent = ""; button.disabled = true;
    try { const fd = new FormData(form); const permissions = [...form.querySelectorAll('input[name="permission"]:checked')].map((input) => input.value); const roleId = String(fd.get("role_id") || ""); await adminRbac(sessionToken(), { action: roleId ? "update-role" : "create-role", role_id: roleId, name: String(fd.get("name") || ""), description: String(fd.get("description") || ""), permissions }); toast(el, "Rol ve izinleri kaydedildi."); await openRoles(); } catch (err) { error.textContent = err.message; button.disabled = false; }
  });
  el.dialogBody.querySelector("#rbacBackRoles")?.addEventListener("click", () => openRoles().catch((e) => toast(el, e.message)));
}

function applyAccess() {
  const rules = [["#campaignButton","campaigns.view"],["#usersButton","users.manage"],["#filesButton","service_areas.view"],[".regions-toggle","regions.view"],["#addRegionButton","service_areas.manage"],['.tool[data-tool="draw"]',"service_areas.manage"],['.tool[data-tool="edit"]',"service_areas.manage"],['.tool[data-tool="delete"]',"service_areas.manage"],['.tool[data-tool="import"]',"service_areas.manage"],['.tool[data-tool="export"]',"service_areas.view"],['.tool[data-tool="history"]',"history.view"]];
  rules.forEach(([selector,permission]) => document.querySelectorAll(selector).forEach((element) => { const allowed=can(permission); element.hidden=!allowed; element.setAttribute("aria-hidden",String(!allowed)); }));
}
function interceptUnauthorizedClicks(event) {
  const target=event.target?.closest?.("#campaignButton,#usersButton,#filesButton,.regions-toggle,#addRegionButton,.tool");
  if(!target) return;
  const map={campaignButton:"campaigns.view",usersButton:"users.manage",filesButton:"service_areas.view",regionsToggle:"regions.view",addRegionButton:"service_areas.manage"};
  const permission=target.id?map[target.id]:({draw:"service_areas.manage",edit:"service_areas.manage",delete:"service_areas.manage",import:"service_areas.manage",export:"service_areas.view",history:"history.view"}[target.dataset.tool]);
  if(permission&&!can(permission)){event.preventDefault();event.stopImmediatePropagation();}
}
function install() {
  const appDialog=document.getElementById("appDialog"); if(!appDialog) return;
  window.__regionConsoleElements={appDialog,dialogTitle:document.getElementById("dialogTitle"),dialogBody:document.getElementById("dialogBody"),dialogClose:document.getElementById("dialogClose"),toast:document.getElementById("toast")};
  store.subscribe(applyAccess); applyAccess();
  document.addEventListener("click",(event)=>{if(event.target?.closest?.("#usersButton")&&can("users.manage")){event.preventDefault();event.stopImmediatePropagation();openUsers().catch((error)=>toast(elements(),error.message));}},true);
  document.addEventListener("click",interceptUnauthorizedClicks,true);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true}); else install();
