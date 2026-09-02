// Some feature modules still listen on document while the canonical RBAC
// service dispatches on window. Keep both event targets synchronized so a
// permission/scope refresh immediately reaches every feature.
window.addEventListener("region-console:rbac-updated", (event) => {
  document.dispatchEvent(new CustomEvent("region-console:rbac-updated", { detail: event.detail }));
});
