export function bindPanels(elements, mapState, drawing, handlers) {
  document.querySelectorAll(".tool:not(.tool-action)").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      document.querySelectorAll(".tool:not(.tool-action)").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      handlers.onTool?.(tool);
    });
  });

  elements.menuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !elements.headerMenu.hidden;
    elements.headerMenu.hidden = open;
    elements.menuButton.setAttribute("aria-expanded", String(!open));
  });

  const closeHeaderMenu = () => {
    elements.headerMenu.hidden = true;
    elements.menuButton?.setAttribute("aria-expanded", "false");
  };

  elements.campaignButton?.addEventListener("click", () => {
    closeHeaderMenu();
    handlers.onCampaigns?.();
  });

  elements.usersButton?.addEventListener("click", () => {
    closeHeaderMenu();
    handlers.onUsers?.();
  });

  elements.filesButton?.addEventListener("click", () => {
    closeHeaderMenu();
    handlers.onFiles?.();
  });

  elements.regionsToggle?.addEventListener("click", () => {
    const open = !elements.sidebar.hidden;
    elements.sidebar.hidden = open;
    elements.regionsToggle.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (event) => {
    if (!elements.headerMenu.hidden && !elements.headerMenu.contains(event.target) && !elements.menuButton.contains(event.target)) {
      closeHeaderMenu();
    }

    if (elements.sidebar.hidden) return;
    if (elements.sidebar.contains(event.target) || elements.regionsToggle.contains(event.target)) return;
    elements.sidebar.hidden = true;
    elements.regionsToggle.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (!elements.headerMenu.hidden) {
      closeHeaderMenu();
      elements.menuButton.focus();
      return;
    }

    if (elements.sidebar.hidden) return;
    elements.sidebar.hidden = true;
    elements.regionsToggle.setAttribute("aria-expanded", "false");
    elements.regionsToggle.focus();
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

  document.getElementById("undoButton")?.addEventListener("click", handlers.onUndo);
  document.getElementById("redoButton")?.addEventListener("click", handlers.onRedo);
  document.getElementById("saveButton")?.addEventListener("click", handlers.onSave);
}
