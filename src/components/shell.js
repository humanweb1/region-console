export function getElements() {
  const ids = [
    "loginView", "consoleView", "cloudStatus", "versionLabel",
    "logoutButton", "themeButton", "menuButton", "headerMenu", "regionTree", "sidebar", "regionsToggle", "editBar",
    "selectedArea", "statCountries", "statProvinces", "statDistricts",
    "statArea", "statService", "statOutside", "toast", "appDialog",
    "dialogTitle", "dialogBody", "dialogClose", "campaignButton", "usersButton", "filesButton"
  ];
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

export function showLogin(elements) {
  elements.loginView.hidden = false;
  elements.consoleView.hidden = true;
}

export function showConsole(elements) {
  elements.loginView.hidden = true;
  elements.consoleView.hidden = false;
}

export function setCloudStatus(elements, text, state = "idle") {
  elements.cloudStatus.textContent = text;
  elements.cloudStatus.dataset.state = state;
}

export function toast(elements, message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

export function openDialog(elements, title, body) {
  elements.dialogTitle.textContent = title;
  elements.dialogBody.innerHTML = body;
  elements.appDialog.showModal();
}

export function closeDialog(elements) {
  if (elements.appDialog.open) elements.appDialog.close();
}
