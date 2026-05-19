import { app, BrowserWindow, ipcMain, screen, type Rectangle } from "electron";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { COMMANDS_STREAM_CHANNEL } from "../shared/ipcChannels";
import type { CommandStreamEvent } from "../shared/types";
import { EffectIpcLive } from "./ipc/effectIpc";
import { installIpcHandlers } from "./ipc/handlers";
import { ClawpatchRunnerLive } from "./services/clawpatchRunner";
import { ClawpatchStateServiceLive } from "./services/clawpatchState";
import { GitServiceLive } from "./services/gitService";
import { UiMetadataServiceLive } from "./services/uiMetadata";
import { RepoServiceLive } from "./services/repoService";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  makeWindowStateFile,
  readWindowState,
  writeWindowState,
  type WindowBounds,
} from "./windowState";

type AppLayer = ReturnType<typeof makeAppLayer>;
type AppRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<AppLayer>, Layer.Error<AppLayer>>;

let mainWindow: BrowserWindow | null = null;
let appRuntime: AppRuntime | null = null;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 250;

async function createWindow(): Promise<void> {
  const runtime = appRuntime;
  if (runtime === null) {
    throw new Error("App runtime is not initialized");
  }
  const userDataPath = app.getPath("userData");
  const windowState = await runtime.runPromise(
    readWindowState(
      userDataPath,
      screen.getAllDisplays().map((display) => display.workArea),
    ),
  );

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Clawpatch",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  installWindowStatePersistence(mainWindow, userDataPath);

  if (windowState.isFullScreen) {
    mainWindow.setFullScreen(true);
  } else if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  appRuntime = makeAppRuntime(app.getPath("userData"));
  await appRuntime.runPromise(installIpcHandlers((event) => publishCommandStream(event)));
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  const runtime = appRuntime;
  if (runtime === null) {
    return;
  }
  appRuntime = null;
  event.preventDefault();
  void runtime.dispose().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function publishCommandStream(event: CommandStreamEvent): void {
  mainWindow?.webContents.send(COMMANDS_STREAM_CHANNEL, event);
}

function installWindowStatePersistence(window: BrowserWindow, userDataPath: string): void {
  let saveTimeout: NodeJS.Timeout | null = null;

  const saveNow = (): void => {
    if (saveTimeout !== null) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (window.isDestroyed()) {
      return;
    }
    const runtime = appRuntime;
    if (runtime === null) {
      return;
    }
    void runtime
      .runPromise(
        writeWindowState(
          userDataPath,
          makeWindowStateFile(
            toWindowBounds(window.getNormalBounds()),
            window.isMaximized(),
            window.isFullScreen(),
          ),
        ),
      )
      .catch((error: unknown) => {
        console.error("Unable to write window state", error);
      });
  };

  const saveSoon = (): void => {
    if (saveTimeout !== null) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(saveNow, WINDOW_STATE_SAVE_DEBOUNCE_MS);
  };

  window.on("move", saveSoon);
  window.on("resize", saveSoon);
  window.on("maximize", saveSoon);
  window.on("unmaximize", saveSoon);
  window.on("enter-full-screen", saveSoon);
  window.on("leave-full-screen", saveSoon);
  window.on("close", saveNow);
}

function toWindowBounds(bounds: Rectangle): WindowBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function makeAppLayer(
  userDataPath: string,
  runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
) {
  const coreLayer = Layer.mergeAll(
    ClawpatchRunnerLive,
    ClawpatchStateServiceLive,
    UiMetadataServiceLive(userDataPath),
    GitServiceLive,
  ).pipe(Layer.provide(NodeServices.layer));
  const repoLayer = RepoServiceLive(userDataPath).pipe(
    Layer.provideMerge(coreLayer),
    Layer.provide(NodeServices.layer),
  );
  return Layer.mergeAll(NodeServices.layer, repoLayer, EffectIpcLive(ipcMain, runPromise));
}

function makeAppRuntime(userDataPath: string): AppRuntime {
  let runtime: AppRuntime;
  runtime = ManagedRuntime.make(makeAppLayer(userDataPath, (effect) => runtime.runPromise(effect)));
  return runtime;
}
