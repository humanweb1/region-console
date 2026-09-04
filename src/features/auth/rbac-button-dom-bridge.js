const LEGACY_TO_BUTTON = {
  "regions.edit": "button.region.boundary.edit",
  "regions.delete": "button.region.delete",
  "regions.save": "button.region.save",
  "service_areas.open": "button.region.service.open",
  "service_areas.close": "button.region.service.close",
  "campaigns.assign": "button.region.campaign.manage",
  "campaigns.remove": "button.region.campaign.manage",
  "campaigns.end": "button.region.info.campaign_end"
};

function bridgeNode(node) {
  if (!node?.dataset) return;
  const legacy = node.dataset.rbacPermission;
  const buttonPermission = LEGACY_TO_BUTTON[legacy];
  if (buttonPermission) node.dataset.rbacPermission = buttonPermission;
}

function bridgeTree(root = document) {
  bridgeNode(root?.nodeType === 1 ? root : null);
  root?.querySelectorAll?.("[data-rbac-permission]").forEach(bridgeNode);
}

bridgeTree();

if (typeof MutationObserver !== "undefined" && document.body) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node.nodeType === 1) bridgeTree(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
