const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    backgroundColor: "#e6e6e6",
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// Save text file (XSLT/XML)
ipcMain.handle("save-text-file", async (event, { suggestedName, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || "file.txt",
    filters: [
      { name: "XSLT", extensions: ["xslt", "xsl"] },
      { name: "XML", extensions: ["xml"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (canceled || !filePath) return { ok: false };

  fs.writeFileSync(filePath, content, "utf-8");
  return { ok: true, filePath };
});

// Pick base directory for include/import
ipcMain.handle("pick-base-directory", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"]
  });

  if (canceled || !filePaths?.[0]) return { ok: false };
  return { ok: true, dir: filePaths[0] };
});

// Read file by baseDir + relative href (handles .., /, \)
ipcMain.handle("read-text-file-rel", async (event, { baseDir, href }) => {
  try {
    if (!baseDir || !href) return { ok: false, error: "baseDir/href missing" };
    const fullPath = path.resolve(baseDir, href);
    const text = fs.readFileSync(fullPath, "utf-8");
    return { ok: true, text, fullPath };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});