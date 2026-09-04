import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dist = join(root, "dist");
const styles = ["base.css", "shell.css", "sidebar.css", "map.css", "panels.css", "files-display-modes.css", "rbac.css"].map((name) => join(root, "src", "styles", name));
const entries = ["./src/core/runtime-config.js", "./src/core/app.js", "./src/features/auth/rbac-event-bridge.js", "./src/features/auth/rbac-button-dom-bridge.js", "./src/features/auth/rbac-bootstrap.js", "./src/features/auth/rbac-permission-compat.js", "./src/features/auth/startup-gate.js", "./src/features/map/map-access-fit.js", "./src/features/auth/menu-rbac-fix.js", "./src/features/auth/rbac-scope-ui.js", "./src/features/auth/rbac-management.js", "./src/features/auth/rbac-role-save-fix.js", "./src/features/auth/rbac-permission-click-fix.js", "./src/features/campaigns/campaign-ui.js", "./src/features/files/files.js", "./src/features/files/files-display-modes.js", "./src/features/settings/map-settings.js", "./src/features/regions/region-actions.js", "./src/features/regions/region-info-enhancer.js", "./src/features/regions/region-hierarchy-panel-fix.js", "./src/features/regions/data-integrity.js", "./src/features/search/header-search.js", "./src/features/map/layers-ui.js", "./src/features/regions/region-catalog.js", "./src/features/drawing/drawing-hierarchy-save.js", "./src/features/drawing/manual-hierarchy-input-fix.js", "./src/features/drawing/province-select-completeness-fix.js", "./src/features/drawing/hierarchy-select-api-fix.js", "./src/features/drawing/hierarchy-save-submit-fix.js", "./src/features/drawing/drawing-save-dialog.js", "./src/features/history/history-map-simulation.js", "./src/features/history/history-cloud.js"];
function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))); }); }
async function main() {
  if (!existsSync(join(root, "index.html"))) throw new Error("index.html bulunamadı");
  await rm(dist, { recursive: true, force: true }); await mkdir(join(dist, "assets"), { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "region-console-build-")); const entry = join(temp, "entry.mjs");
  try { await writeFile(entry, `${entries.map((path) => `import ${JSON.stringify(join(root, path.slice(2)))};`).join("\n")}\n`, "utf8"); await run("npx", ["--yes", "esbuild@0.25.9", entry, "--bundle", "--format=esm", "--minify", "--legal-comments=none", "--outfile=dist/assets/app.js"]); } finally { await rm(temp, { recursive: true, force: true }); }
  await writeFile(join(dist, "assets", "app.css"), (await Promise.all(styles.map((file) => readFile(file, "utf8")))).join("\n"), "utf8");
  let html = await readFile(join(root, "index.html"), "utf8");
  html = html.replace(/\s*<link rel="stylesheet" href="\.\/src\/styles\/[^>]+>/g, "").replace(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"[^>]*>/, '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin>').replace(/<script[^>]+src="\.\/src\/[^>]+><\/script>/g, "").replace(/<\/head>/, '<link rel="stylesheet" href="/assets/app.css"></head>').replace(/<\/body>/, '<script type="module" src="/assets/app.js"></script></body>');
  await writeFile(join(dist, "index.html"), html, "utf8");
  await writeFile(join(dist, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n\n/index.html\n  Cache-Control: no-store\n`, "utf8");
  console.log("Production build hazır: dist/");
}
main().catch((error) => { console.error("Build failed:", error); process.exit(1); });
