let bound = false;

function closeDialog(dialog) {
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
}

function handleCloseTarget(target, event) {
  const dialogClose = target?.closest?.("#dialogClose");
  if (dialogClose) {
    const dialog = dialogClose.closest("dialog") || document.getElementById("appDialog");
    if (!dialog) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDialog(dialog);
    return true;
  }

  const regionClose = target?.closest?.("#regionPanelClose, .region-panel-close");
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

  document.addEventListener("pointerdown", (event) => {
    handleCloseTarget(event.target, event);
  }, true);

  document.addEventListener("click", (event) => {
    handleCloseTarget(event.target, event);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const dialog = document.getElementById("appDialog");
    if (dialog?.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDialog(dialog);
    }
  }, true);
}

bind();
