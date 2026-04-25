import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { discoverServers } from "./discovery.js";
import { listFiles, sendFile } from "./client.js";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let runningServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "OpenFileTransfer PC",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("server:start", async (_event, options) => {
  if (runningServer) {
    return runningServer;
  }
  runningServer = await startServer(options);
  return {
    deviceId: runningServer.deviceId,
    deviceName: runningServer.deviceName,
    grpcPort: runningServer.grpcPort,
    descriptorPort: runningServer.descriptorPort,
    receiveDir: runningServer.receiveDir,
    descriptorUrl: runningServer.descriptorUrl
  };
});

ipcMain.handle("server:stop", async () => {
  if (!runningServer) {
    return false;
  }
  await runningServer.close();
  runningServer = undefined;
  return true;
});

ipcMain.handle("client:discover", async (_event, options) => discoverServers(options));
ipcMain.handle("client:list", async (_event, address) => listFiles(address));
ipcMain.handle("client:send", async (_event, payload) => sendFile(payload.address, payload.filePath));

ipcMain.handle("dialog:pickFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"]
  });
  return result.canceled ? undefined : result.filePaths[0];
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", async (event) => {
  if (!runningServer) {
    return;
  }
  event.preventDefault();
  await runningServer.close();
  runningServer = undefined;
  app.quit();
});

