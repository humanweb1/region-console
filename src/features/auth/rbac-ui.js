import { store } from "../../state/store.js";
import { openDialog, toast } from "../../components/shell.js";
import { PERMISSIONS, can, canAny, getAccess, listUsers, createUser, updateUser, createRole, updateRole } from "../../services/rbac.js";

const elements = {
  appDialog: document.getElementById("appDialog"),
  dialogTitle: document.getElementById("dialogTitle"),
  dialogBody: document.getElementById("dialogBody"),
  usersButton: document.getElementById("usersButton"),
  campaignButton: document.getElementById("campaignButton"),
  filesButton: document.getElementById("filesButton"),
  toast: document.getElementById("toast")
};

let access = null;
let applied = false;

function session() { return store.get().auth?.session || null; }
function allowed(permission) { return can(access, permission); }
function any(...permissions) { return canAny(access, permissions); }
function hide(element, value) { if (element) element.hidden = value; }
function notify(message) { toast(elements, message); }
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function applyPermissions() {
  if (!access) return;
  hide(elements.usersButton, !allowed("users.manage"));
  hide(elements.campaignButton, !any("campaigns.view", "campaigns.manage"));
  hide(elements.filesButton, !any("files.view", "files.manage"));
  hide(document.querySelector("#regionsToggle"), !any("regions.view", "service_areas.view"));
  hide(document.querySelector("#addRegionButton"), !any("service_areas.manage", "regions.manage"));

  const toolPermissions = {
    draw: ["service_areas.manage"],
    edit: ["service_areas.manage", "regions.manage"],
    delete: ["service_areas.manage", "regions.manage"],
    import: ["service_areas.manage", "regions.manage"],
    export: ["data.export"],
    history: ["history.view"]
  };
  document.querySelectorAll(".tool[data-tool]").forEach((button) => {
    const permissions = toolPermissions[button.dataset.tool];
    if (permissions) hide(button, !any(...permissions));
  });
  applied = true;
}

function permissionCards(selected = []) {
  const set = new Set(selected);
  return PERMISSIONS.map(([value, label]) => `<label class="rbac-permission"><input type="checkbox" name="permission" value="${value}" ${set.has(value) ? "checked" : ""}><span>${label}</span><code>${value}</code></label>`).join("");
}

function roleOptions(roles, selected) {
  return (roles || []).map((role) => `<option value="${escapeHtml(role.id)}" ${String(role.id) === String(selected) ? "selected" : ""}>${escapeHtml(role.name)} — ${escapeHtml(role.description || "")}</option>`).join("");
}

async function renderUserManager() {
  const currentSession = session();
  if (!currentSession?.access_token || !allowed("users.manage")) return;
  openDialog(elements, "Kullanıcılar ve roller", `<p class="dialog-muted">Kullanıcı oluşturma, rol atama ve rol izinlerini buradan yönetin.</p><div id="rbacPanel"><p class="dialog-muted">Yükleniyor…</p></div>`);
  try {
    const data = await listUsers(currentSession.access_token);
    renderManager(data);
  } catch (error) {
    elements.dialogBody.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderManager(data) {
  const users = data.users || [];
  const roles = data.roles || [];
  const permissionsByRole = data.permissionsByRole || {};
  elements.dialogBody.innerHTML = `
    <div class="rbac-tabs"><button type="button" class="button button-primary" data-rbac-tab="users">Kullanıcılar</button><button type="button" class="button" data-rbac-tab="roles">Roller</button></div>
    <section data-rbac-section="users">
      <form id="createUserForm" class="dialog-form rbac-create-user">
        <h3>Yeni kullanıcı</h3>
        <label>Ad soyad<input name="full_name" required autocomplete="name"></label>
        <label>E-posta<input name="email" type="email" required autocomplete="email"></label>
        <label>Geçici şifre<input name="password" type="password" minlength="8" required autocomplete="new-password"><small>En az 8 karakter.</small></label>
        <label>Rol<select name="role_id" required>${roleOptions(roles, roles.find((r) => r.name !== "super_admin")?.id)}</select></label>
        <button class="button button-primary" type="submit">Kullanıcı oluştur</button><p id="createUserError" class="form-error"></p>
      </form>
      <div class="rbac-user-list"><h3>Mevcut kullanıcılar</h3>${users.map((user) => `
        <article class="rbac-user-card" data-user-id="${escapeHtml(user.id)}">
          <div><strong>${escapeHtml(user.full_name || user.email)}</strong><small>${escapeHtml(user.email)}</small></div>
          <select class="rbac-user-role">${roleOptions(roles, user.role_id)}</select>
          <label class="rbac-active"><input class="rbac-user-active" type="checkbox" ${user.is_active ? "checked" : ""}> Aktif</label>
          <button class="button rbac-user-save" type="button">Kaydet</button>
        </article>`).join("")}</div>
    </section>
    <section data-rbac-section="roles" hidden>
      <form id="createRoleForm" class="dialog-form">
        <h3>Yeni rol</h3><label>Rol adı<input name="name" placeholder="supervizor" required></label><label>Açıklama<input name="description" required></label>
        <fieldset><legend>Ekran ve buton izinleri</legend><div class="rbac-permission-grid">${permissionCards()}</div></fieldset>
        <button class="button button-primary" type="submit">Rol oluştur</button><p id="createRoleError" class="form-error"></p>
      </form>
      <div class="rbac-role-list"><h3>Mevcut roller</h3>${roles.filter((role) => role.name !== "super_admin").map((role) => `
        <details class="rbac-role-card"><summary><strong>${escapeHtml(role.name)}</strong><span>${escapeHtml(role.description || "")}</span></summary>
          <form class="dialog-form rbac-role-form" data-role-id="${escapeHtml(role.id)}">
            <label>Rol adı<input name="name" value="${escapeHtml(role.name)}" required></label><label>Açıklama<input name="description" value="${escapeHtml(role.description || "")}" required></label>
            <fieldset><legend>İzinler</legend><div class="rbac-permission-grid">${permissionCards(permissionsByRole[role.id] || [])}</div></fieldset>
            <button class="button button-primary" type="submit">Rolü güncelle</button><p class="form-error"></p>
          </form>
        </details>`).join("")}</div>
    </section>`;

  elements.dialogBody.querySelectorAll("[data-rbac-tab]").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.rbacTab;
    elements.dialogBody.querySelectorAll("[data-rbac-section]").forEach((section) => { section.hidden = section.dataset.rbacSection !== tab; });
    elements.dialogBody.querySelectorAll("[data-rbac-tab]").forEach((item) => item.classList.toggle("button-primary", item === button));
  }));

  elements.dialogBody.querySelector("#createUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector("#createUserError");
    error.textContent = "";
    const values = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await createUser(session().access_token, values);
      form.reset();
      notify("Kullanıcı oluşturuldu.");
      renderManager(await listUsers(session().access_token));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  elements.dialogBody.querySelectorAll(".rbac-user-save").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest("[data-user-id]");
    button.disabled = true;
    try {
      await updateUser(session().access_token, {
        user_id: card.dataset.userId,
        role_id: card.querySelector(".rbac-user-role").value,
        is_active: card.querySelector(".rbac-user-active").checked
      });
      notify("Kullanıcı güncellendi.");
    } catch (err) {
      window.alert(err.message);
    } finally {
      button.disabled = false;
    }
  }));

  elements.dialogBody.querySelector("#createRoleForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector("#createRoleError");
    error.textContent = "";
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.permissions = [...form.querySelectorAll("input[name=permission]:checked")].map((input) => input.value);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await createRole(session().access_token, payload);
      notify("Rol oluşturuldu.");
      renderManager(await listUsers(session().access_token));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  elements.dialogBody.querySelectorAll(".rbac-role-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".form-error");
    error.textContent = "";
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.role_id = form.dataset.roleId;
    payload.permissions = [...form.querySelectorAll("input[name=permission]:checked")].map((input) => input.value);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await updateRole(session().access_token, payload);
      notify("Rol güncellendi.");
      renderManager(await listUsers(session().access_token));
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }));
}

function bindOverrides() {
  elements.usersButton?.addEventListener("click", (event) => {
    if (!allowed("users.manage")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    renderUserManager();
  }, true);

  const observer = new MutationObserver(() => {
    if (!access) return;
    const newCampaign = elements.dialogBody?.querySelector("#newCampaign");
    if (newCampaign && !allowed("campaigns.manage")) newCampaign.remove();
  });
  if (elements.dialogBody) observer.observe(elements.dialogBody, { childList: true, subtree: true });
}

async function refresh() {
  const currentSession = session();
  if (!currentSession?.access_token || !currentSession?.user?.id) return;
  try {
    access = await getAccess(currentSession.access_token, currentSession.user.id);
    if (!access?.profile?.is_active) throw new Error("Kullanıcı hesabınız pasif.");
    applyPermissions();
  } catch (error) {
    console.error("[Region Console] RBAC yüklenemedi:", error);
    access = null;
    applied = false;
  }
}

store.subscribe(() => {
  const currentSession = session();
  if (currentSession && !applied) refresh();
  if (!currentSession) {
    access = null;
    applied = false;
  }
});

bindOverrides();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
else refresh();

window.RegionConsoleRBAC = { get access() { return access; }, can: allowed, canAny: any, refresh };
