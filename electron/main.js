// ── Descripto desktop shell (Electron) ─────────────────────────────────────
// Wraps the Next.js editor in a native macOS window, exactly like Descript's
// own Electron app. In production it builds/serves Next locally and loads it;
// in dev (DEV_SERVER_URL set) it attaches to the running dev server.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { execSync, execFileSync } = require("child_process");
const path = require("path");
const { ServerManager } = require("./server-manager.cjs");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.env.DESCRIPTO_PORT || "3210", 10);
const DEV_URL = process.env.DEV_SERVER_URL || null;
const BASE = DEV_URL || `http://127.0.0.1:${PORT}`;

let serverProc = null;
let win = null;

async function startServer() {
  if (DEV_URL) return; // dev server already running
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    console.log("[descripto] building Next.js app (first run)…");
    execSync("npx next build", { cwd: ROOT, stdio: "inherit" });
  }
  console.log(`[descripto] starting next start on :${PORT}`);
  // Use real Node: an Electron-as-Node child shares the macOS app identity
  // and can intercept app activation/quit instead of the visible window.
  const node = process.env.DESCRIPTO_NODE || execFileSync(process.platform === "win32" ? "where" : "which", ["node"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  const serverEnv = { ...process.env };
  delete serverEnv.ELECTRON_RUN_AS_NODE;
  serverProc = new ServerManager({
    command: node,
    args: [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(PORT)],
    cwd: ROOT,
    env: serverEnv,
    url: `${BASE}/api/projects`,
    logPath: path.join(app.getPath("userData"), "logs", "server.log"),
  });
  serverProc.on("status", status => { if (win && !win.isDestroyed()) win.webContents.send("server-status", status); });
  await serverProc.start();
}

// Create a project from a local file — no byte transfer: the server clones
// the file on the same volume (APFS clonefile), then we navigate to it.
async function openVideoFile(filePath) {
  try {
    const res = await fetch(
      `${BASE}/api/projects/local?path=${encodeURIComponent(filePath)}&name=${encodeURIComponent(path.basename(filePath))}`,
      { method: "POST" },
    );
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "import failed");
    if (win) win.webContents.loadURL(`${BASE}/editor/${j.id}`);
  } catch (e) {
    dialog.showErrorBox("Descripto", `Could not open ${filePath}: ${e.message}`);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: "#141414",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(BASE);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

async function historyCommand(command) {
  if (!win || win.isDestroyed()) return;
  const textEditing = await win.webContents.executeJavaScript(`Boolean(document.activeElement?.matches('input, textarea, [contenteditable="true"]'))`).catch(() => true);
  if (textEditing) win.webContents[command]();
  else win.webContents.send("edit-command", command);
}
function openSettings() {
  if (!win) return;
  const current = new URL(win.webContents.getURL()).pathname;
  const back = /^\/editor\/p[a-z0-9]+$/.test(current) ? `?returnTo=${encodeURIComponent(current)}` : "";
  win.webContents.loadURL(`${BASE}/settings${back}`);
}
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Video…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const r = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Media", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "mp3", "wav", "m4a", "aac"] }],
            });
            if (!r.canceled && r.filePaths[0]) await openVideoFile(r.filePaths[0]);
          },
        },
        {
          label: "Home",
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => win && win.webContents.loadURL(BASE + "/"),
        },
        { type: "separator" },
        { role: isMac ? "close" : "quit" },
      ],
    },
    { label: "Edit", submenu: [{ label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => historyCommand("undo") }, { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: () => historyCommand("redo") }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// "Open with Descripto" / drop on dock icon
app.on("open-file", (_e, filePath) => {
  app.whenReady().then(() => openVideoFile(filePath));
});

app.whenReady().then(async () => {
  buildMenu();
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(path.join(ROOT, "build", "icon.png")); } catch {}
  }
  try { await startServer(); }
  catch (e) { dialog.showErrorBox("Descripto", e.message); app.quit(); return; }
  createWindow();
  // file passed on the command line: `electron . /path/to/video.mp4`
  const argFile = process.argv.find((a) => /\.(mp4|mov|m4v|mkv|webm|mp3|wav|m4a|aac)$/i.test(a));
  if (argFile && fs.existsSync(argFile)) await openVideoFile(argFile);
});

function shutdown() {
  serverProc?.stop();
  app.quit();
}
app.on("will-quit", () => serverProc?.stop());
app.on("window-all-closed", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
