const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { createLanService } = require("./lan.cjs");

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
let mainWindow = null;
const lanService = createLanService({
  serverModulePath: path.join(__dirname, "..", "server", "dist", "index.js"),
  onRoomsChanged(rooms) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("lan:rooms-changed", rooms);
  },
});

function requireMainWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("IPC_SENDER_REJECTED");
}

ipcMain.handle("lan:start-host", (event) => {
  requireMainWindow(event);
  return lanService.startHost();
});
ipcMain.handle("lan:get-networks", (event) => {
  requireMainWindow(event);
  return lanService.getNetworks();
});
ipcMain.handle("lan:stop-host", (event) => {
  requireMainWindow(event);
  return lanService.stopHost();
});
ipcMain.handle("lan:set-advertised-room", (event, room) => {
  requireMainWindow(event);
  return lanService.setAdvertisedRoom(room);
});
ipcMain.handle("lan:start-discovery", (event) => {
  requireMainWindow(event);
  return lanService.startDiscovery();
});
ipcMain.handle("lan:stop-discovery", (event) => {
  requireMainWindow(event);
  return lanService.stopDiscovery();
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1260,
    height: 880,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: "Ancient Beast Chess",
    backgroundColor: "#b6ac89",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    void lanService.dispose().catch(() => {});
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDevelopment) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  app.setName("Ancient Beast Chess");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  void lanService.dispose();
});
