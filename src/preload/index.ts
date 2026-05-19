import { contextBridge, ipcRenderer } from "electron";
import type {
  Api,
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandStreamEvent
} from "../shared/types";

const api: Api = {
  repo: {
    list: () => ipcRenderer.invoke("repo:list"),
    add: (repoPath) => ipcRenderer.invoke("repo:add", repoPath),
    refresh: (repoId) => ipcRenderer.invoke("repo:refresh", repoId)
  },
  findings: {
    list: (repoId) => ipcRenderer.invoke("findings:list", repoId),
    get: (repoId, findingId) => ipcRenderer.invoke("findings:get", repoId, findingId)
  },
  triage: {
    set: (repoId: string, findingId: string, status: ClawpatchStatus, note?: string) =>
      ipcRenderer.invoke("triage:set", repoId, findingId, status, note)
  },
  commands: {
    run: (repoId: string, request: ClawpatchCommandRequest) =>
      ipcRenderer.invoke("commands:run", repoId, request),
    onStream: (listener: (event: CommandStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: CommandStreamEvent): void => listener(payload);
      ipcRenderer.on("commands:stream", handler);
      return () => ipcRenderer.removeListener("commands:stream", handler);
    }
  },
  git: {
    diff: (repoId) => ipcRenderer.invoke("git:diff", repoId)
  }
};

contextBridge.exposeInMainWorld("clawpatch", api);
