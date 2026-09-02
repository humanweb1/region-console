import { store } from "../../state/store.js";
import { updateRole, listUsers } from "../../services/rbac.js";
import { toast } from "../../components/shell.js";

function readScopes(form) {
  return [...form.querySelectorAll(".rbac-scope-row")].map((row) => {
    const country = row.querySelector(".scope-country")?.value || null;
    const province = row.querySelector(".scope-province")?.value || null;
    const district = row.querySelector(".scope-district")?.value || null;
    if (!country && !province && !district) return null;
    const name = (selector) => row.querySelector(selector)?.selectedOptions?.[0]?.textContent?.trim() || null;
    return {
      country_id: country,
      country_name: name(".scope-country"),
      province_id: province,
      province_name: name(".scope-province"),
      district_id: district,
      district_name: name(".scope-district")
    };
  }).filter(Boolean);
}

function normalizeRoleDropdowns(root = document) {
  root.querySelectorAll(".rbac-permission-group, .rbac-role-card").forEach((details) => {
    details.removeAttribute("open");
  });
}

function collapseCreateRoleForm(root) {
  const form = root.querySelector("#createRoleForm");
  if (!form || form.dataset.collapsedUi === "true") return;

  const details = document.createElement("details");
  details.className = "rbac-role-card rbac-create-role-card";
  details.dataset.createRoleDetails = "true";

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="rbac-role-name">
      <strong>Yeni rol oluştur</strong>
      <small>Yeni bir rol, izin ve bölge kapsamı tanımlayın.</small>
    </span>
    <span class="rbac-role-badges"><i>›</i></span>
  `;

  form.dataset.collapsedUi = "true";
  form.parentNode.insertBefore(details, form);
  details.appendChild(summary);
  details.appendChild(form);
}

function installPermissionClickFix(dialogBody) {
  if (dialogBody.dataset.permissionClickFixInstalled === "true") return;
  dialogBody.dataset.permissionClickFixInstalled = "true";

  dialogBody.addEventListener("click", (event) => {
    const switchLabel = event.target.closest(".rbac-permission-switch, .rbac-group-switch");
    if (!switchLabel || !dialogBody.contains(switchLabel)) return;

    const input = switchLabel.querySelector("input[type=checkbox]");
    if (!input) return;

    // Permission switches live inside <summary> for group-level permissions.
    // Prevent the summary's default toggle/scroll behavior and toggle the checkbox ourselves.
    event.preventDefault();
    event.stopPropagation();

    input.checked = !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const bodyScrollTop = dialogBody.scrollTop;
    const pageScrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
    requestAnimationFrame(() => {
      dialogBody.scrollTop = bodyScrollTop;
      if (document.scrollingElement) document.scrollingElement.scrollTop = pageScrollTop;
      window.scrollTo(window.scrollX, pageScrollTop);
    });
  }, true);
}

function installRoleUiFixes() {
  const dialogBody = document.getElementById("dialogBody");
  if (!dialogBody || dialogBody.dataset.roleUiFixInstalled === "true") return;
  dialogBody.dataset.roleUiFixInstalled = "true";
  normalizeRoleDropdowns(dialogBody);
  collapseCreateRoleForm(dialogBody);
  installPermissionClickFix(dialogBody);

  const observer = new MutationObserver(() => {
    collapseCreateRoleForm(dialogBody);
    normalizeRoleDropdowns(dialogBody);
  });
  observer.observe(dialogBody, { childList: true, subtree: true });

  const style = document.createElement("style");
  style.dataset.regionConsoleRoleUi = "true";
  style.textContent = `
    .app-dialog { overflow: hidden; display: flex; flex-direction: column; }
    .app-dialog > .dialog-header { flex: 0 0 auto; }
    .app-dialog > .dialog-body { flex: 1 1 auto; min-height: 0; max-height: none; overflow-x: hidden; overflow-y: auto; }
    .rbac-create-role-card > .rbac-role-create { display: grid; }
  `;
  document.head.appendChild(style);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installRoleUiFixes, { once: true });
} else {
  installRoleUiFixes();
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches(".rbac-role-form")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const current = store.get().auth?.session;
  const roleId = form.dataset.roleId;
  const button = form.querySelector("button[type=submit]");
  const error = form.querySelector(".form-error");
  if (!current?.access_token || !roleId) {
    if (error) error.textContent = "Rol bilgisi bulunamadı.";
    return;
  }
  const payload = {
    role_id: roleId,
    name: form.elements.name?.value?.trim() || "",
    description: form.elements.description?.value?.trim() || "",
    permissions: [...form.querySelectorAll("input[name=permission]:checked")].map((input) => input.value),
    scopes: readScopes(form)
  };
  if (!payload.name || !payload.description) {
    if (error) error.textContent = "Rol adı ve açıklama zorunludur.";
    return;
  }
  if (button) button.disabled = true;
  if (error) error.textContent = "";
  try {
    await updateRole(current.access_token, payload);
    toast("Rol ve bölge yetkileri güncellendi.");
    window.dispatchEvent(new CustomEvent("region-console:rbac-refresh"));
    const dialogBody = document.getElementById("dialogBody");
    if (dialogBody) {
      const data = await listUsers(current.access_token);
      window.dispatchEvent(new CustomEvent("region-console:rbac-list-updated", { detail: data }));
    }
  } catch (exception) {
    if (error) error.textContent = exception?.message || "Rol güncellenemedi.";
  } finally {
    if (button) button.disabled = false;
  }
}, true);
