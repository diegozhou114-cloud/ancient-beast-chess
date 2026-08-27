const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);

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
    },
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
