const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const manifest = require(path.join(root, "manifest.json"));

const pluginId = manifest.id || pkg.name;
const version = readReleaseVersion();
const distDir = path.join(root, "dist");
const packageDir = path.join(distDir, pluginId);
const zipName = `${pluginId}-${version}.zip`;
const zipPath = path.join(distDir, zipName);
const requiredFiles = ["main.js", "manifest.json", "styles.css"];
const releaseFiles = ["README.md", "install.ps1", "install.sh"];

run("npm", ["run", "build"]);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const file of requiredFiles) {
  const source = path.join(root, "build", file);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing build artifact: ${source}`);
  }
  const releaseTarget = path.join(distDir, file);
  fs.copyFileSync(source, releaseTarget);
  if (file === "manifest.json") {
    writeManifestVersion(releaseTarget, version);
  }

  const target = path.join(packageDir, file);
  fs.copyFileSync(releaseTarget, target);
}

for (const file of releaseFiles) {
  const source = path.join(root, "release", file);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing release asset: ${source}`);
  }
  const target = path.join(packageDir, file);
  fs.copyFileSync(source, target);
  if (file === "install.sh") {
    fs.chmodSync(target, 0o755);
  }
}

fs.rmSync(zipPath, { force: true });
run("zip", ["-r", zipPath, pluginId], { cwd: distDir });

console.log(`Release package created: ${path.relative(root, zipPath)}`);
console.log("GitHub release assets created:");
for (const file of requiredFiles) {
  console.log(`- ${path.relative(root, path.join(distDir, file))}`);
}
console.log(`Release version: ${version}`);

function readReleaseVersion() {
  if (pkg.version !== manifest.version) {
    throw new Error(`package.json version (${pkg.version}) must match manifest.json version (${manifest.version}).`);
  }

  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Release version must use x.y.z format. Got: ${manifest.version}`);
  }

  return manifest.version;
}

function writeManifestVersion(manifestPath, version) {
  const packagedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  packagedManifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
