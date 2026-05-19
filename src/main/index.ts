import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { ClawpatchCommandRequest, ClawpatchStatus, CommandStreamEvent } from "../shared/types";
import { RepoService } from "./services/repoService";

let mainWindow: BrowserWindow | null = null;
let repoService: RepoService;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Clawpatch",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  repoService = new RepoService(app.getPath("userData"));
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpc(): void {
  ipcMain.handle("repo:list", () => repoService.listRepos());
  ipcMain.handle("repo:add", (_event, repoPath: string) => repoService.addRepo(repoPath));
  ipcMain.handle("repo:refresh", (_event, repoId: string) => repoService.refreshRepo(repoId));
  ipcMain.handle("findings:list", (_event, repoId: string) => repoService.listFindings(repoId));
  ipcMain.handle("findings:get", (_event, repoId: string, findingId: string) =>
    repoService.getFinding(repoId, findingId)
  );
  ipcMain.handle(
    "triage:set",
    (_event, repoId: string, findingId: string, status: ClawpatchStatus, note?: string) =>
      repoService.setTriage(repoId, findingId, status, note)
  );
  ipcMain.handle("commands:run", (_event, repoId: string, request: ClawpatchCommandRequest) =>
    repoService.runCommand(repoId, request, (streamEvent) => publishCommandStream(streamEvent))
  );
  ipcMain.handle("git:diff", (_event, repoId: string) => repoService.readDiff(repoId));
}

function publishCommandStream(event: CommandStreamEvent): void {
  mainWindow?.webContents.send("commands:stream", event);
}
