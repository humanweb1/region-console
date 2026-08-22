import { spawnSync } from "node:child_process";
import process from "node:process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function changedFiles() {
  if (process.env.GITHUB_ACTIONS === "true") {
    const baseRef = process.env.GITHUB_BASE_REF;
    const diff = baseRef
      ? git(["diff", "--name-only", `origin/${baseRef}...HEAD`])
      : git(["diff", "--name-only", "HEAD^", "HEAD"]);
    return diff.split("\n").filter(Boolean);
  }

  const workingTree = git(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);

  if (workingTree.length || untracked.length) {
    return [...new Set([...workingTree, ...untracked])];
  }

  return git(["diff", "--name-only", "HEAD^", "HEAD"]).split("\n").filter(Boolean);
}

const files = changedFiles();
console.log("Affected test selection");
console.log(files.length ? files.map((file) => `  - ${file}`).join("\n") : "  - no changed files detected");

const tags = new Set();
const testFiles = new Set();

for (const file of files) {
  if (file === "tests/app.spec.js") testFiles.add("tests/app.spec.js");
  if (file === "tests/importer.spec.js") testFiles.add("tests/importer.spec.js");

  if (file === "tests/affected-tests.mjs" || file === "tests/check-affected.mjs") {
    tags.add("@smoke");
  }

  if (file === "playwright.config.js" || file === "tests/static-server.mjs") {
    tags.add("@smoke");
  }

  if (file.startsWith("tests/fixtures/")) tags.add("@import");

  if (file.startsWith("src/features/regions/")) tags.add("@regions");
  if (file === "src/features/search/header-search.js") tags.add("@search");
  if (file.startsWith("src/features/map/")) tags.add("@map");
  if (file.startsWith("src/features/ui/")) tags.add("@ui");
  if (file.startsWith("src/features/auth/")) tags.add("@auth");
  if (file.startsWith("src/features/drawing/")) tags.add("@drawing");
  if (file === "src/services/cloud.js") tags.add("@cloud");
  if (file === "src/services/auth.js") tags.add("@auth");

  if (file === "src/core/app.js") {
    tags.add("@smoke");
    tags.add("@ui");
    tags.add("@map");
    tags.add("@regions");
  }

  if (file.startsWith("src/core/") || file === "package.json" || file === "package-lock.json") {
    tags.add("@smoke");
  }

  if (file.endsWith(".css") || file === "index.html") tags.add("@ui");
  if (file.startsWith("supabase/") || file.startsWith("migrations/")) tags.add("@cloud");

  if (file.startsWith(".github/")) continue;

  const knownSource =
    file.startsWith("src/") ||
    file.startsWith("tests/") ||
    file === "package.json" ||
    file === "package-lock.json" ||
    file.endsWith(".css") ||
    file === "index.html";

  if (!knownSource && /\.(?:js|mjs|cjs|html|css|json)$/.test(file)) tags.add("@smoke");
}

const grepTags = [...tags];
const args = ["playwright", "test"];

if (testFiles.size) {
  args.push(...testFiles);
} else if (grepTags.length) {
  args.push("--grep", grepTags.join("|"));
} else {
  console.log("No application/test code is affected; Playwright run skipped.");
  process.exit(0);
}

console.log(`Test scope: ${args.slice(2).join(" ")}`);
const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
