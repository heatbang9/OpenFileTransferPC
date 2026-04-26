import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { discoverServers } from "./discovery.js";
import { listFiles, sendFile, subscribeEvents } from "./client.js";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let runningServer;
let localServerUnsubscribe;
let remoteEventSubscription;

function serverSummary(server) {
  return {
    deviceId: server.deviceId,
    deviceName: server.deviceName,
    grpcPort: server.grpcPort,
    descriptorPort: server.descriptorPort,
    receiveDir: server.receiveDir,
    descriptorUrl: server.descriptorUrl
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "OpenFileTransfer PC",
    icon: path.join(__dirname, "..", "assets", "brand", "openfiletransfer-icon-512.png"),
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
    return serverSummary(runningServer);
  }
  runningServer = await startServer(options);
  localServerUnsubscribe = runningServer.onEvent((event) => {
    mainWindow?.webContents.send("server:event", event);
    mainWindow?.webContents.send("server:clients", runningServer.getConnectedClients());
  });
  return serverSummary(runningServer);
});

ipcMain.handle("server:stop", async () => {
  if (!runningServer) {
    return false;
  }
  localServerUnsubscribe?.();
  localServerUnsubscribe = undefined;
  await runningServer.close();
  runningServer = undefined;
  return true;
});

ipcMain.handle("server:clients", async () => runningServer?.getConnectedClients() ?? []);
ipcMain.handle("client:discover", async (_event, options) => discoverServers(options));
ipcMain.handle("client:list", async (_event, address) => listFiles(address));
ipcMain.handle("client:send", async (_event, payload) => sendFile(payload.address, payload.filePath));
ipcMain.handle("client:subscribeEvents", async (_event, address) => {
  remoteEventSubscription?.close();
  remoteEventSubscription = await subscribeEvents(address, (event) => {
    mainWindow?.webContents.send("client:event", event);
  }, { name: "OpenFileTransfer PC UI" });
  return true;
});
ipcMain.handle("client:unsubscribeEvents", async () => {
  remoteEventSubscription?.close();
  remoteEventSubscription = undefined;
  return true;
});

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
  localServerUnsubscribe?.();
  remoteEventSubscription?.close();
  await runningServer.close();
  runningServer = undefined;
  app.quit();
});
