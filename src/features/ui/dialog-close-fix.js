let bound = false;

function closeNativeDialog(dialog) {
  if (!dialog) return false;
  if (typeof dialog.close === "function") {
    if (dialog.open) dialog.close();
    return true;
  }
  return false;
}

function makeCloseControlUsable(control) {
  if (!control) return;
  control.hidden = false;
  control.removeAttribute("aria-disabled");
}

function handleCloseTarget(target, event) {
  if (!target?.closest) return false;

  const dialogClose = target.closest(
    "#dialogClose, [data-dialog-close], .dialog-close, dialog .icon-button[aria-label=\"Kapat\"]"
  );
  if (dialogClose) {
    const dialog = dialogClose.closest("dialog") || document.getElementById("appDialog");
    if (!dialog) return false;
    makeCloseControlUsable(dialogClose);
    event.preventDefault();
    event.stopImmediatePropagation();
    return closeNativeDialog(dialog);
  }

  const regionClose = target.closest("#regionPanelClose, .region-panel-close");
  if (regionClose) {
    const panel = regionClose.closest("#regionActionPanel");
    if (!panel) return false;
    makeCloseControlUsable(regionClose);
    event.preventDefault();
    event.stopImmediatePropagation();
    const cancel = panel.querySelector("#regionCancelButton");
    if (cancel && cancel !== regionClose) {
      cancel.hidden = false;
      cancel.click();
    } else {
      panel.remove();
    }
    return true;
  }

  return false;
}

function exposeCloseControls() {
  document.querySelectorAll(
    "#dialogClose, [data-dialog-close], .dialog-close, dialog .icon-button[aria-label=\"Kapat\"], #regionPanelClose, .region-panel-close"
  ).forEach(makeCloseControlUsable);
}

function bind() {
  if (bound || typeof document === "undefined") return;
  bound = true;

  const capture = (event) => {
    handleCloseTarget(event.target, event);
  };

  // Window capture runs before document capture and before target handlers.
  // This prevents unrelated delegated handlers from swallowing the close click.
  window.addEventListener("pointerdown", capture, true);
  window.addEventListener("click", capture, true);
  document.addEventListener("pointerdown", capture, true);
  document.addEventListener("click", capture, true);

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const dialog = document.querySelector("dialog[open]") || document.getElementById("appDialog");
    if (dialog?.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeNativeDialog(dialog);
    }
  }, true);

  exposeCloseControls();
  const observer = new MutationObserver(exposeCloseControls);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

bind();
