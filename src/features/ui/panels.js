export function bindPanels(elements, mapState, drawing, handlers) {
  document.querySelectorAll(".tool:not(.tool-action)").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      document.querySelectorAll(".tool:not(.tool-action)").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      handlers.onTool?.(tool);
    });
  });

  document.getElementById("zoomInButton").addEventListener("click", () => mapState.map.zoomIn());
  document.getElementById("zoomOutButton").addEventListener("click", () => mapState.map.zoomOut());
  document.getElementById("resetMapButton").addEventListener("click", handlers.onResetMap);

  document.getElementById("mapLayerButton").addEventListener("click", () => {
    handlers.onLayer?.("standard");
    document.getElementById("mapLayerButton").classList.add("active");
    document.getElementById("satelliteLayerButton").classList.remove("active");
  });

  document.getElementById("satelliteLayerButton").addEventListener("click", () => {
    handlers.onLayer?.("satellite");
    document.getElementById("satelliteLayerButton").classList.add("active");
    document.getElementById("mapLayerButton").classList.remove("active");
  });

  document.getElementById("themeButton").addEventListener("click", handlers.onTheme);
  document.getElementById("logoutButton").addEventListener("click", handlers.onLogout);
  document.getElementById("dialogClose")?.addEventListener("click", () => elements.appDialog.close());
  document.getElementById("campaignButton")?.addEventListener("click", handlers.onCampaigns);
  document.getElementById("usersButton")?.addEventListener("click", handlers.onUsers);

  document.getElementById("regionSearch").addEventListener("input", (e) => handlers.onSearch?.(e.target.value));
  document.getElementById("sidebarSearch").addEventListener("input", (e) => handlers.onSearch?.(e.target.value));

  document.getElementById("undoButton")?.addEventListener("click", handlers.onUndo);
  document.getElementById("redoButton")?.addEventListener("click", handlers.onRedo);
  document.getElementById("saveButton")?.addEventListener("click", handlers.onSave);
}
