const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const manifest = require(path.join(root, "manifest.json"));

const pluginId = manifest.id || pkg.name;
const version = pkg.version;
const distDir = path.join(root, "dist");
const packageDir = path.join(distDir, pluginId);
const zipName = `${pluginId}-${version}.zip`;
const zipPath = path.join(distDir, zipName);
const requiredFiles = ["main.js", "manifest.json", "styles.css"];
const releaseFiles = ["README.md", "install.ps1", "install.sh"];

run("npm", ["run", "build"]);

fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const file of requiredFiles) {
  const source = path.join(root, "build", file);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing build artifact: ${source}`);
  }
  fs.copyFileSync(source, path.join(packageDir, file));
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
