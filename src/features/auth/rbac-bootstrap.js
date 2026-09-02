import { store } from "../../state/store.js";
import { getAccess } from "../../services/rbac.js";

let lastSessionKey = "";
let loading = false;

async function refresh() {
  const session = store.get().auth?.session;
  const userId = session?.user?.id;
  const token = session?.access_token;
  const key = token && userId ? `${userId}:${token}` : "";
  if (!key || key === lastSessionKey || loading) return;
  loading = true;
  try {
    await getAccess(token, userId);
    lastSessionKey = key;
  } catch (error) {
    console.error("[Region Console] RBAC yüklenemedi:", error);
    window.RegionConsoleRBAC = window.RegionConsoleRBAC || {};
    window.RegionConsoleRBAC.access = null;
    window.RegionConsoleRBAC.error = error;
    window.dispatchEvent(new CustomEvent("region-console:rbac-error", { detail: { error } }));
  } finally {
    loading = false;
  }
}

store.subscribe(refresh);
refresh();
