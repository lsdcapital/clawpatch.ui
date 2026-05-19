import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { COMMANDS_STREAM_CHANNEL } from "../shared/ipcChannels";
import type { CommandStreamEvent } from "../shared/types";
import { EffectIpcLive } from "./ipc/effectIpc";
import { installIpcHandlers } from "./ipc/handlers";
import { ClawpatchRunnerLive } from "./services/clawpatchRunner";
import { ClawpatchStateServiceLive } from "./services/clawpatchState";
import { GitServiceLive } from "./services/gitService";
import { GuiMetadataServiceLive } from "./services/guiMetadata";
import { RepoServiceLive } from "./services/repoService";

let mainWindow: BrowserWindow | null = null;
let appRuntime: ManagedRuntime.ManagedRuntime<any, any> | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Clawpatch",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  appRuntime = makeAppRuntime(app.getPath("userData"));
  await appRuntime.runPromise(installIpcHandlers((event) => publishCommandStream(event)));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  void appRuntime?.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function publishCommandStream(event: CommandStreamEvent): void {
  mainWindow?.webContents.send(COMMANDS_STREAM_CHANNEL, event);
}

function makeAppRuntime(userDataPath: string): ManagedRuntime.ManagedRuntime<any, any> {
  const coreLayer = Layer.mergeAll(
    ClawpatchRunnerLive,
    ClawpatchStateServiceLive,
    GuiMetadataServiceLive,
    GitServiceLive,
  );
  const repoLayer = RepoServiceLive(userDataPath).pipe(Layer.provideMerge(coreLayer));
  let runtime: ManagedRuntime.ManagedRuntime<any, any>;
  runtime = ManagedRuntime.make(
    Layer.mergeAll(
      repoLayer,
      EffectIpcLive(ipcMain, (effect) => runtime.runPromise(effect)),
    ),
  );
  return runtime;
}
