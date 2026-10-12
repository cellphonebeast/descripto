#!/usr/bin/env node
// Build a macOS launcher tied to this source checkout. This is not a bundled DMG.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") throw new Error("The .app launcher requires macOS. Use pnpm build && pnpm start for the local browser version.");
const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const APP = path.join(ROOT, "dist-app", "Descripto.app");
const CONTENTS = path.join(APP, "Contents");
const node = process.execPath;
const run = (command, args) => execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });

if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) run(node, [require.resolve("next/dist/bin/next"), "build"]);
fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(path.join(CONTENTS, "MacOS"), { recursive: true });
fs.mkdirSync(path.join(CONTENTS, "Resources"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "build", "icon.icns"), path.join(CONTENTS, "Resources", "icon.icns"));
const searchPath = [...new Set([path.dirname(node), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
// JSON string escaping also safely quotes these UTF-8 strings in C source.
const src = `#include <stdlib.h>
#include <unistd.h>
int main(void) {
  setenv("PATH", ${JSON.stringify(searchPath)}, 1);
  setenv("DESCRIPTO_NODE", ${JSON.stringify(node)}, 1);
  if (chdir(${JSON.stringify(ROOT)}) != 0) return 1;
  char *argv[] = {${JSON.stringify(node)}, ${JSON.stringify(require.resolve("electron/cli.js"))}, ".", NULL};
  execv(argv[0], argv);
  return 1;
}
`;
const source = path.join(ROOT, "build", "launcher.c");
try { fs.writeFileSync(source, src); run("clang", ["-O2", "-o", path.join(CONTENTS, "MacOS", "Descripto"), source]); }
finally { fs.rmSync(source, { force: true }); }
fs.writeFileSync(path.join(CONTENTS, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Descripto</string>
<key>CFBundleDisplayName</key><string>Descripto</string>
<key>CFBundleIdentifier</key><string>org.earlyaidopters.descripto</string>
<key>CFBundleVersion</key><string>1.0.0</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>Descripto</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticGraphicsSwitching</key><true/>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Video</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>public.movie</string><string>public.audiovisual-content</string><string>public.audio</string></array>
</dict></array></dict></plist>`);
run("codesign", ["--force", "--deep", "-s", "-", APP]);
let target = APP;
if (process.argv.includes("--install")) {
  target = "/Applications/Descripto.app";
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(APP, target, { recursive: true });
}
console.log(`Built ${target}\nKeep this source folder and its dependencies in place. Rebuild the launcher if you move them or change Node versions.`);
console.log("Drag dist-app/Descripto.app to Applications, or run pnpm app --install.");
if (process.argv.includes("--open")) run("open", [target]);
