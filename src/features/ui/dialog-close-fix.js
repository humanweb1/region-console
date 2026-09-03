let bound = false;

function closeNativeDialog(dialog) {
  if (!dialog || typeof dialog.close !== "function") return false;
  if (dialog.open) dialog.close();
  return true;
}

function handleCloseTarget(target, event) {
  if (!target?.closest) return false;

  const dialogClose = target.closest(
    "#dialogClose, [data-dialog-close], .dialog-close, dialog .icon-button[aria-label=\"Kapat\"]"
  );
  if (dialogClose) {
    const dialog = dialogClose.closest("dialog") || document.getElementById("appDialog");
    if (!dialog) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeNativeDialog(dialog);
    return true;
  }

  const regionClose = target.closest("#regionPanelClose, .region-panel-close");
  if (regionClose) {
    const panel = regionClose.closest("#regionActionPanel");
    if (!panel) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const cancel = panel.querySelector("#regionCancelButton");
    if (cancel && cancel !== regionClose) cancel.click();
    else panel.remove();
    return true;
  }

  return false;
}

function bind() {
  if (bound || typeof document === "undefined") return;
  bound = true;

  // Use window capture so this runs before document/target click handlers.
  // Do not close on pointerdown: the browser must be allowed to complete the
  // normal click sequence for dynamically rendered controls.
  window.addEventListener("click", (event) => {
    handleCloseTarget(event.target, event);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const dialog = document.querySelector("dialog[open]") || document.getElementById("appDialog");
    if (dialog?.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeNativeDialog(dialog);
    }
  }, true);
}

bind();
