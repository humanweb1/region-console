const SWITCH_SELECTOR = ".rbac-permission-switch, .rbac-group-switch";

function getSwitch(target) {
  return target instanceof Element ? target.closest(SWITCH_SELECTOR) : null;
}

function syncGroup(group) {
  const boxes = [...group.querySelectorAll("input[name=permission]")];
  const master = group.querySelector(".rbac-group-master");
  const count = group.querySelector("[data-group-count]");
  const checked = boxes.filter((box) => box.checked).length;

  if (master) {
    master.checked = boxes.length > 0 && checked === boxes.length;
    master.indeterminate = checked > 0 && checked < boxes.length;
  }
  if (count) count.textContent = `${checked}/${boxes.length}`;
}

function syncAll(root) {
  root.querySelectorAll(".rbac-permission-group").forEach(syncGroup);
  const boxes = [...root.querySelectorAll(".rbac-permission-groups input[name=permission]")];
  const checked = boxes.filter((box) => box.checked).length;
  const total = root.querySelector("[data-permission-total]");
  const allToggle = root.querySelector(".rbac-all-toggle");
  if (total) total.textContent = checked;
  if (allToggle) allToggle.textContent = checked === boxes.length ? "Tümünü kapat" : "Tümünü aç";
}

function handleSwitchPointer(event) {
  const switchLabel = getSwitch(event.target);
  if (!switchLabel) return;

  const dialogBody = document.getElementById("dialogBody");
  if (!dialogBody || !dialogBody.contains(switchLabel)) return;

  // Permission switches must behave as isolated controls. In particular, a
  // switch must never activate the <summary> that owns the permission group
  // and must never bubble into a handler that rebuilds/closes the role card.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function handleSwitchClick(event) {
  const switchLabel = getSwitch(event.target);
  if (!switchLabel) return;

  const dialogBody = document.getElementById("dialogBody");
  if (!dialogBody || !dialogBody.contains(switchLabel)) return;

  const input = switchLabel.querySelector('input[type="checkbox"]');
  if (!input) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  // Do not dispatch a bubbling `change` event here. The role manager listens
  // to changes higher in the DOM and may rebuild the role form. The checkbox
  // state is the source of truth for submit; update the counters locally.
  input.checked = !input.checked;
  const group = input.closest(".rbac-permission-group");
  if (group) syncGroup(group);
  const root = document.getElementById("dialogBody");
  if (root) syncAll(root);
}

function handleSwitchKeydown(event) {
  if (event.key !== " " && event.key !== "Enter") return;
  const switchLabel = getSwitch(event.target);
  if (!switchLabel) return;

  const dialogBody = document.getElementById("dialogBody");
  if (!dialogBody || !dialogBody.contains(switchLabel)) return;

  const input = switchLabel.querySelector('input[type="checkbox"]');
  if (!input) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  input.checked = !input.checked;
  const group = input.closest(".rbac-permission-group");
  if (group) syncGroup(group);
  const root = document.getElementById("dialogBody");
  if (root) syncAll(root);
}

window.addEventListener("pointerdown", handleSwitchPointer, true);
window.addEventListener("mousedown", handleSwitchPointer, true);
window.addEventListener("touchstart", handleSwitchPointer, true);
window.addEventListener("click", handleSwitchClick, true);
window.addEventListener("keydown", handleSwitchKeydown, true);
