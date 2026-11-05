const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("domus", {
  chooseShare: () => ipcRenderer.invoke("choose-share"),
  connect: (config) => ipcRenderer.invoke("connect", config),
  status: (callback) => ipcRenderer.on("status", (_, value) => callback(value)),
});
