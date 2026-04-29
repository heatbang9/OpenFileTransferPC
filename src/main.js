import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from "electron";
import { discoverServers } from "./discovery.js";
import { listFiles, sendFile, subscribeEvents } from "./client.js";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let tray;
let runningServer;
let localServerUnsubscribe;
let localKnownDevicesUnsubscribe;
let localTransferProgressUnsubscribe;
let localTransferRequestUnsubscribe;
let remoteEventSubscription;
let isQuitting = false;

function appDeviceProfile() {
  const profilePath = path.join(app.getPath("userData"), "device-profile.json");
  if (fs.existsSync(profilePath)) {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  }
  const profile = {
    deviceId: randomUUID(),
    name: "OpenFileTransfer PC"
  };
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  return profile;
}

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

function showSystemNotification(title, body) {
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({
    title,
    body,
    icon: path.join(__dirname, "..", "assets", "brand", "openfiletransfer-icon-512.png")
  }).show();
}

async function confirmTransferRequest(request) {
  showMainWindow();
  showSystemNotification("OpenFileTransfer 승인 요청", `${request.peerName}의 파일 전송 요청이 있습니다.`);
  const directionText = request.direction === "sending" ? "서버 파일 다운로드" : "파일 업로드";
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["허용", "취소"],
    defaultId: 0,
    cancelId: 1,
    title: "전송 승인",
    message: "화이트리스트에 없는 디바이스입니다.",
    detail: [
      `디바이스: ${request.peerName}`,
      `UUID: ${request.peerDeviceId || "없음"}`,
      `동작: ${directionText}`,
      `파일: ${request.fileName || "이름 없는 파일"}`,
      `크기: ${request.totalBytes || 0} bytes`,
      "",
      "이번 전송을 허용할까요?"
    ].join("\n")
  });
  return result.response === 0;
}

function notifyTrayState(message) {
  mainWindow?.webContents.send("app:tray-state", {
    hidden: mainWindow ? !mainWindow.isVisible() : true,
    serverRunning: Boolean(runningServer),
    message
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  notifyTrayState("창을 다시 열었습니다.");
}

function hideMainWindow() {
  mainWindow?.hide();
  notifyTrayState("PC 앱이 시스템 트레이에 숨겨졌습니다.");
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }
  const serverRunning = Boolean(runningServer);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "OpenFileTransfer 열기",
      click: showMainWindow
    },
    {
      label: "트레이로 숨기기",
      enabled: Boolean(mainWindow?.isVisible()),
      click: hideMainWindow
    },
    { type: "separator" },
    {
      label: serverRunning ? "서버 실행 중" : "서버 중지됨",
      enabled: false
    },
    {
      label: "서버 시작",
      enabled: !serverRunning,
      click: async () => {
        await startAppServer({});
        showMainWindow();
      }
    },
    {
      label: "서버 중지",
      enabled: serverRunning,
      click: async () => {
        await stopAppServer();
        notifyTrayState("서버가 중지되었습니다.");
      }
    },
    { type: "separator" },
    {
      label: "종료",
      click: quitApp
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(serverRunning ? "OpenFileTransfer PC - 서버 실행 중" : "OpenFileTransfer PC");
}

function createTray() {
  if (tray) {
    return;
  }
  const iconPath = path.join(__dirname, "..", "assets", "brand", "openfiletransfer-icon-512.png");
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.on("click", showMainWindow);
  refreshTrayMenu();
}

async function startAppServer(options) {
  if (runningServer) {
    return serverSummary(runningServer);
  }
  const profile = appDeviceProfile();
  runningServer = await startServer({
    ...options,
    deviceId: options?.deviceId ?? profile.deviceId,
    name: options?.name ?? profile.name,
    requireApprovalForUntrustedDevices: true,
    onTransferApprovalRequest: confirmTransferRequest
  });
  localServerUnsubscribe = runningServer.onEvent((event) => {
    mainWindow?.webContents.send("server:event", event);
    mainWindow?.webContents.send("server:clients", runningServer.getConnectedClients());
    if (event.type === "file_received") {
      showSystemNotification("OpenFileTransfer 수신 완료", event.message || "파일 수신이 완료되었습니다.");
    }
  });
  localKnownDevicesUnsubscribe = runningServer.onKnownDevices((devices) => {
    mainWindow?.webContents.send("server:knownDevices", devices);
  });
  localTransferProgressUnsubscribe = runningServer.onTransferProgress((progress) => {
    mainWindow?.webContents.send("transfer:progress", {
      ...progress,
      source: "server"
    });
  });
  localTransferRequestUnsubscribe = runningServer.onTransferRequest((request) => {
    mainWindow?.webContents.send("transfer:request", request);
  });
  refreshTrayMenu();
  notifyTrayState("서버가 시작되었습니다.");
  return serverSummary(runningServer);
}

async function stopAppServer() {
  if (!runningServer) {
    return false;
  }
  localServerUnsubscribe?.();
  localServerUnsubscribe = undefined;
  localKnownDevicesUnsubscribe?.();
  localKnownDevicesUnsubscribe = undefined;
  localTransferProgressUnsubscribe?.();
  localTransferProgressUnsubscribe = undefined;
  localTransferRequestUnsubscribe?.();
  localTransferRequestUnsubscribe = undefined;
  await runningServer.close();
  runningServer = undefined;
  refreshTrayMenu();
  return true;
}

async function cleanup() {
  remoteEventSubscription?.close();
  remoteEventSubscription = undefined;
  await stopAppServer();
  tray?.destroy();
  tray = undefined;
}

async function quitApp() {
  isQuitting = true;
  await cleanup();
  app.quit();
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

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.on("show", () => {
    refreshTrayMenu();
    notifyTrayState("창이 표시되었습니다.");
  });

  mainWindow.on("hide", refreshTrayMenu);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("server:start", async (_event, options) => {
  return startAppServer(options);
});

ipcMain.handle("server:stop", async () => {
  return stopAppServer();
});

ipcMain.handle("server:clients", async () => runningServer?.getConnectedClients() ?? []);
ipcMain.handle("server:knownDevices", async () => runningServer?.getKnownDevices() ?? []);
ipcMain.handle("server:setDeviceTrust", async (_event, payload) => {
  return runningServer?.setKnownDeviceTrust(payload.clientDeviceId, payload.trusted);
});
ipcMain.handle("client:discover", async (_event, options) => discoverServers(options));
ipcMain.handle("client:list", async (_event, address) => listFiles(address, appDeviceProfile()));
ipcMain.handle("client:send", async (_event, payload) => {
  const receipt = await sendFile(payload.address, payload.filePath, {
    ...appDeviceProfile(),
    onProgress: (progress) => {
      mainWindow?.webContents.send("transfer:progress", {
        ...progress,
        source: "client"
      });
    }
  });
  showSystemNotification("OpenFileTransfer 전송 완료", `${receipt.fileName} 전송이 완료되었습니다.`);
  return receipt;
});
ipcMain.handle("client:sendMany", async (_event, payload) => {
  const profile = appDeviceProfile();
  const targets = payload.addresses ?? [];
  const results = await Promise.allSettled(targets.map((address) => sendFile(address, payload.filePath, {
    ...profile,
    onProgress: (progress) => {
      mainWindow?.webContents.send("transfer:progress", {
        ...progress,
        source: `client:${address}`,
        peerName: address
      });
    }
  })));
  const successCount = results.filter((result) => result.status === "fulfilled").length;
  if (successCount > 0) {
    showSystemNotification("OpenFileTransfer 전송 완료", `${successCount}/${targets.length}개 대상 전송이 완료되었습니다.`);
  }
  return results.map((result, index) => ({
    address: targets[index],
    ok: result.status === "fulfilled",
    receipt: result.status === "fulfilled" ? result.value : undefined,
    error: result.status === "rejected" ? String(result.reason?.message ?? result.reason) : undefined
  }));
});
ipcMain.handle("client:subscribeEvents", async (_event, address) => {
  remoteEventSubscription?.close();
  remoteEventSubscription = await subscribeEvents(address, (event) => {
    mainWindow?.webContents.send("client:event", event);
  }, appDeviceProfile());
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

ipcMain.handle("app:hideToTray", async () => {
  hideMainWindow();
  return true;
});

ipcMain.handle("app:showWindow", async () => {
  showMainWindow();
  return true;
});

ipcMain.handle("app:quit", async () => {
  await quitApp();
  return true;
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("dev.openfiletransfer.pc");
  }
  createTray();
  createWindow();
});

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }
  showMainWindow();
});

app.on("before-quit", async (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  await quitApp();
});
