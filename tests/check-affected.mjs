import { execFileSync } from "node:child_process";
import process from "node:process";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function git(args) {
  try {
    return run("git", args);
  } catch {
    return "";
  }
}

const NL = String.fromCharCode(10);

function changedFiles() {
  if (process.env.GITHUB_ACTIONS === "true") {
    const baseRef = process.env.GITHUB_BASE_REF;
    if (baseRef) {
      return git(["diff", "--name-only", `origin/${baseRef}...HEAD`]).split(NL).filter(Boolean);
    }
    return git(["diff", "--name-only", "HEAD^", "HEAD"]).split(NL).filter(Boolean);
  }

  const workingTree = git(["diff", "--name-only", "HEAD"]).split(NL).filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split(NL).filter(Boolean);

  if (workingTree.length || untracked.length) {
    return [...new Set([...workingTree, ...untracked])];
  }

  return git(["diff", "--name-only", "HEAD^", "HEAD"]).split(NL).filter(Boolean);
}

function existsAtHead(file) {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${file}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const files = changedFiles();
const jsFiles = files.filter((file) => /\.(?:js|mjs|cjs)$/.test(file) && !file.includes("node_modules/") && existsAtHead(file));

if (!jsFiles.length) {
  console.log("No existing changed JavaScript files; syntax check skipped.");
  process.exit(0);
}

console.log(`Checking ${jsFiles.length} changed JavaScript file(s):`);
for (const file of jsFiles) console.log(`  - ${file}`);

for (const file of jsFiles) {
  run(process.execPath, ["--check", file]);
}

console.log("Affected syntax checks passed.");
