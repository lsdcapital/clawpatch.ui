import { contextBridge, ipcRenderer } from "electron";
import type {
  Api,
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandStreamEvent,
} from "../shared/types";
import {
  APP_SETTINGS_GET_CHANNEL,
  APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL,
  APP_SETTINGS_UPDATE_CHANNEL,
  COMMANDS_INTERRUPT_CHANNEL,
  COMMANDS_RUN_CHANNEL,
  COMMANDS_STREAM_CHANNEL,
  FEATURES_MAP_CHANNEL,
  FINDINGS_GET_CHANNEL,
  FINDINGS_LIST_CHANNEL,
  FINDINGS_WORK_STATUSES_CHANNEL,
  GIT_DIFF_CHANNEL,
  GIT_PUBLISH_FIX_CHANNEL,
  GIT_STATUS_CHANNEL,
  REPO_ADD_CHANNEL,
  REPO_DOCTOR_CHANNEL,
  REPO_GET_SETTINGS_CHANNEL,
  REPO_LIST_CHANNEL,
  REPO_PICK_FOLDER_CHANNEL,
  REPO_REFRESH_CHANNEL,
  REPO_UPDATE_SETTINGS_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TRIAGE_SET_CHANNEL,
} from "../shared/ipcChannels";

const repoFindingPayload = (
  repoId: string,
  findingId?: string,
): { repoId: string; findingId?: string } =>
  findingId === undefined ? { repoId } : { repoId, findingId };

const triagePayload = (
  repoId: string,
  findingId: string,
  status: ClawpatchStatus,
  note?: string,
): { repoId: string; findingId: string; status: ClawpatchStatus; note?: string } =>
  note === undefined ? { repoId, findingId, status } : { repoId, findingId, status, note };

const api: Api = {
  appSettings: {
    get: () => ipcRenderer.invoke(APP_SETTINGS_GET_CHANNEL),
    pickTerminalApp: () => ipcRenderer.invoke(APP_SETTINGS_PICK_TERMINAL_APP_CHANNEL),
    update: (settings) => ipcRenderer.invoke(APP_SETTINGS_UPDATE_CHANNEL, { settings }),
  },
  repo: {
    list: () => ipcRenderer.invoke(REPO_LIST_CHANNEL),
    add: (repoPath) => ipcRenderer.invoke(REPO_ADD_CHANNEL, { repoPath }),
    pickFolder: () => ipcRenderer.invoke(REPO_PICK_FOLDER_CHANNEL),
    refresh: (repoId) => ipcRenderer.invoke(REPO_REFRESH_CHANNEL, { repoId }),
    doctor: (repoId) => ipcRenderer.invoke(REPO_DOCTOR_CHANNEL, { repoId }),
    getSettings: (repoId) => ipcRenderer.invoke(REPO_GET_SETTINGS_CHANNEL, { repoId }),
    updateSettings: (repoId, settings) =>
      ipcRenderer.invoke(REPO_UPDATE_SETTINGS_CHANNEL, { repoId, settings }),
  },
  findings: {
    list: (repoId) => ipcRenderer.invoke(FINDINGS_LIST_CHANNEL, { repoId }),
    get: (repoId, findingId) => ipcRenderer.invoke(FINDINGS_GET_CHANNEL, { repoId, findingId }),
    workStatuses: (repoId) => ipcRenderer.invoke(FINDINGS_WORK_STATUSES_CHANNEL, { repoId }),
  },
  features: {
    map: (repoId) => ipcRenderer.invoke(FEATURES_MAP_CHANNEL, { repoId }),
  },
  triage: {
    set: (repoId: string, findingId: string, status: ClawpatchStatus, note?: string) =>
      ipcRenderer.invoke(TRIAGE_SET_CHANNEL, triagePayload(repoId, findingId, status, note)),
  },
  commands: {
    run: (repoId: string, request: ClawpatchCommandRequest) =>
      ipcRenderer.invoke(COMMANDS_RUN_CHANNEL, { repoId, request }),
    interrupt: (repoId: string, findingId?: string) =>
      ipcRenderer.invoke(COMMANDS_INTERRUPT_CHANNEL, repoFindingPayload(repoId, findingId)),
    onStream: (listener: (event: CommandStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: CommandStreamEvent): void =>
        listener(payload);
      ipcRenderer.on(COMMANDS_STREAM_CHANNEL, handler);
      return () => ipcRenderer.removeListener(COMMANDS_STREAM_CHANNEL, handler);
    },
  },
  git: {
    diff: (repoId, findingId) =>
      ipcRenderer.invoke(GIT_DIFF_CHANNEL, repoFindingPayload(repoId, findingId)),
    status: (repoId, findingId) =>
      ipcRenderer.invoke(GIT_STATUS_CHANNEL, repoFindingPayload(repoId, findingId)),
    publishFix: (repoId, findingId) =>
      ipcRenderer.invoke(GIT_PUBLISH_FIX_CHANNEL, { repoId, findingId }),
  },
  terminal: {
    open: (repoId, findingId) =>
      ipcRenderer.invoke(TERMINAL_OPEN_CHANNEL, repoFindingPayload(repoId, findingId)),
  },
};

contextBridge.exposeInMainWorld("clawpatch", api);
