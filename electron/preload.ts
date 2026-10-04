import { contextBridge, ipcRenderer } from "electron";
import { IPC, type DittoDeviceCode, type OmniSynthBridge } from "../shared/ipc";

const bridge: OmniSynthBridge = {
  platform: process.platform,
  version: process.env.npm_package_version ?? "",
  providers: {
    detect: () => ipcRenderer.invoke(IPC.providersDetect),
    setKey: (provider, key) => ipcRenderer.invoke(IPC.providersSetKey, provider, key),
    clearKey: (provider) => ipcRenderer.invoke(IPC.providersClearKey, provider),
    setCustom: (baseUrl, model) => ipcRenderer.invoke(IPC.providersSetCustom, baseUrl, model),
  },
  inference: {
    chat: (req) => ipcRenderer.invoke(IPC.inferenceChat, req),
    cancel: (requestId) => ipcRenderer.invoke(IPC.inferenceCancel, requestId),
    models: (provider) => ipcRenderer.invoke(IPC.inferenceModels, provider),
  },
  ditto: {
    status: () => ipcRenderer.invoke(IPC.dittoStatus),
    login: (onCode) => {
      const listener = (_e: unknown, code: DittoDeviceCode) => onCode(code);
      ipcRenderer.on(IPC.dittoLoginCode, listener);
      return ipcRenderer.invoke(IPC.dittoLogin).finally(() => {
        ipcRenderer.removeListener(IPC.dittoLoginCode, listener);
      });
    },
    logout: () => ipcRenderer.invoke(IPC.dittoLogout),
    listEndpoints: () => ipcRenderer.invoke(IPC.dittoListEndpoints),
    createEndpoint: (model) => ipcRenderer.invoke(IPC.dittoCreateEndpoint, model),
    useEndpoint: (id) => ipcRenderer.invoke(IPC.dittoUseEndpoint, id),
  },
  files: {
    pick: (kinds) => ipcRenderer.invoke(IPC.filesPick, kinds),
    readPaths: (paths) => ipcRenderer.invoke(IPC.filesReadPaths, paths),
    saveJson: (name, json) => ipcRenderer.invoke(IPC.filesSaveJson, name, json),
    openJson: () => ipcRenderer.invoke(IPC.filesOpenJson),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
  },
};

contextBridge.exposeInMainWorld("omnisynth", bridge);
