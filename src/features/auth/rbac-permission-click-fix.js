const SWITCH_SELECTOR = ".rbac-permission-switch, .rbac-group-switch";

function isPermissionSwitch(target) {
  return target instanceof Element ? target.closest(SWITCH_SELECTOR) : null;
}

function togglePermissionSwitch(event) {
  const switchLabel = isPermissionSwitch(event.target);
  if (!switchLabel) return;

  const dialogBody = document.getElementById("dialogBody");
  if (!dialogBody || !dialogBody.contains(switchLabel)) return;

  const input = switchLabel.querySelector('input[type="checkbox"]');
  if (!input) return;

  // This must run before document-level menu/summary handlers. Otherwise the
  // click can close the header menu or the surrounding <details> element.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

window.addEventListener("click", togglePermissionSwitch, true);
window.addEventListener("pointerup", (event) => {
  if (isPermissionSwitch(event.target)) event.stopPropagation();
}, true);
