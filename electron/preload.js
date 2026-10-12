// Descripto preload — gives the renderer access to the absolute path of
// locally picked/dropped files (Electron 32+ removed File.path; this is the
// supported way). Falls back silently in a plain browser.
const { contextBridge, webUtils, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("descripto", {
  isDesktop: true,
  onServerStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("server-status", listener);
    return () => ipcRenderer.removeListener("server-status", listener);
  },
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
