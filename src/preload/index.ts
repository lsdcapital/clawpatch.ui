import { contextBridge, ipcRenderer } from "electron";
import type {
  Api,
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandStreamEvent,
} from "../shared/types";
import {
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  COMMANDS_STREAM_CHANNEL,
  FEATURES_MAP_CHANNEL,
  FINDINGS_GET_CHANNEL,
  FINDINGS_LIST_CHANNEL,
  GIT_DIFF_CHANNEL,
  GIT_STATUS_CHANNEL,
  REPO_ADD_CHANNEL,
  REPO_LIST_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  REPO_REFRESH_CHANNEL,
  TRIAGE_SET_CHANNEL,
} from "../shared/ipcChannels";

const api: Api = {
  repo: {
    list: () => ipcRenderer.invoke(REPO_LIST_CHANNEL),
    add: (repoPath) => ipcRenderer.invoke(REPO_ADD_CHANNEL, { repoPath }),
    pickFolder: () => ipcRenderer.invoke(REPO_PICK_FOLDER_CHANNEL),
    refresh: (repoId) => ipcRenderer.invoke(REPO_REFRESH_CHANNEL, { repoId }),
  },
  findings: {
    list: (repoId) => ipcRenderer.invoke(FINDINGS_LIST_CHANNEL, { repoId }),
    get: (repoId, findingId) => ipcRenderer.invoke(FINDINGS_GET_CHANNEL, { repoId, findingId }),
  },
  features: {
    map: (repoId) => ipcRenderer.invoke(FEATURES_MAP_CHANNEL, { repoId }),
  },
  triage: {
    set: (repoId: string, findingId: string, status: ClawpatchStatus, note?: string) =>
      ipcRenderer.invoke(TRIAGE_SET_CHANNEL, { repoId, findingId, status, note }),
  },
  commands: {
    run: (repoId: string, request: ClawpatchCommandRequest) =>
      ipcRenderer.invoke(COMMANDS_RUN_CHANNEL, { repoId, request }),
    interrupt: (repoId: string, findingId?: string) =>
      ipcRenderer.invoke(COMMANDS_INTERRUPT_CHANNEL, { repoId, findingId }),
    onStream: (listener: (event: CommandStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: CommandStreamEvent): void =>
        listener(payload);
      ipcRenderer.on(COMMANDS_STREAM_CHANNEL, handler);
      return () => ipcRenderer.removeListener(COMMANDS_STREAM_CHANNEL, handler);
    },
  },
  git: {
    diff: (repoId, findingId) => ipcRenderer.invoke(GIT_DIFF_CHANNEL, { repoId, findingId }),
    status: (repoId, findingId) => ipcRenderer.invoke(GIT_STATUS_CHANNEL, { repoId, findingId }),
  },
};

contextBridge.exposeInMainWorld("clawpatch", api);
