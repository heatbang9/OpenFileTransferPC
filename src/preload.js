import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openFileTransfer", {
  startServer: (options) => ipcRenderer.invoke("server:start", options),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  discover: (options) => ipcRenderer.invoke("client:discover", options),
  listFiles: (address) => ipcRenderer.invoke("client:list", address),
  sendFile: (payload) => ipcRenderer.invoke("client:send", payload),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile")
});

