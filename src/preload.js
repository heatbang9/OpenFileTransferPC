import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openFileTransfer", {
  startServer: (options) => ipcRenderer.invoke("server:start", options),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  serverClients: () => ipcRenderer.invoke("server:clients"),
  discover: (options) => ipcRenderer.invoke("client:discover", options),
  listFiles: (address) => ipcRenderer.invoke("client:list", address),
  sendFile: (payload) => ipcRenderer.invoke("client:send", payload),
  subscribeEvents: (address) => ipcRenderer.invoke("client:subscribeEvents", address),
  unsubscribeEvents: () => ipcRenderer.invoke("client:unsubscribeEvents"),
  pickFile: () => ipcRenderer.invoke("dialog:pickFile"),
  onServerEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("server:event", wrapped);
    return () => ipcRenderer.off("server:event", wrapped);
  },
  onServerClients: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("server:clients", wrapped);
    return () => ipcRenderer.off("server:clients", wrapped);
  },
  onClientEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("client:event", wrapped);
    return () => ipcRenderer.off("client:event", wrapped);
  }
});
