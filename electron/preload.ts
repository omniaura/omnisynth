import { contextBridge, ipcRenderer } from "electron";
import { IPC, type BridgeCall, type BridgeGenerateArgs, type DittoDeviceCode, type OmniSynthBridge } from "../shared/ipc";

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
    credits: () => ipcRenderer.invoke(IPC.dittoCredits),
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
  bridge: {
    info: () => ipcRenderer.invoke(IPC.bridgeInfo),
    onCall: (handler) => {
      const listener = (_e: unknown, call: BridgeCall) => {
        handler(call)
          .then((result) => ipcRenderer.send(IPC.bridgeReply, { id: call.id, ok: true, result }))
          .catch((err: unknown) => ipcRenderer.send(IPC.bridgeReply, { id: call.id, ok: false, error: (err as Error)?.message ?? String(err) }));
      };
      ipcRenderer.on(IPC.bridgeCall, listener);
      return () => ipcRenderer.removeListener(IPC.bridgeCall, listener);
    },
    onGenerateRequest: (handler) => {
      const listener = (_e: unknown, args: BridgeGenerateArgs) => handler(args);
      ipcRenderer.on(IPC.bridgeGenerateRequest, listener);
      return () => ipcRenderer.removeListener(IPC.bridgeGenerateRequest, listener);
    },
  },
};

contextBridge.exposeInMainWorld("omnisynth", bridge);
