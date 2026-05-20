import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, type Rectangle } from "electron";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { APP_DISPLAY_NAME, APP_ID } from "../shared/appMetadata";
import { COMMANDS_STREAM_CHANNEL } from "../shared/ipcChannels";
import type { CommandStreamEvent } from "../shared/types";
import { EffectIpcLive } from "./ipc/effectIpc";
import { installIpcHandlers } from "./ipc/handlers";
import { childLogger, logger } from "./logger";
import { ClawpatchRunnerLive } from "./services/clawpatchRunner";
import { ClawpatchStateServiceLive } from "./services/clawpatchState";
import { GitServiceLive } from "./services/gitService";
import { RepoSettingsServiceLive } from "./services/repoSettings";
import { TerminalLauncherLive } from "./services/terminalLauncher";
import { UiMetadataServiceLive } from "./services/uiMetadata";
import { RepoServiceLive } from "./services/repoService";
import { SetupScriptRunnerLive } from "./services/setupScriptRunner";
import { makeBeforeQuitHandler } from "./shutdown";
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
const LIGHT_WINDOW_BACKGROUND = "#f6f7f8";
const DARK_WINDOW_BACKGROUND = "#111318";
const startupLogger = childLogger("startup");
const windowLogger = childLogger("window");
const commandStreamLogger = childLogger("command-stream");
const handleBeforeQuit = makeBeforeQuitHandler({
  getRuntime: () => appRuntime,
  clearRuntime: () => {
    appRuntime = null;
  },
  quit: () => app.quit(),
  logError: (message, error) => {
    startupLogger.error({ err: error }, message);
  },
});

app.setName(APP_DISPLAY_NAME);
app.setAppUserModelId(APP_ID);
app.setAboutPanelOptions({
  applicationName: APP_DISPLAY_NAME,
});

async function createWindow(): Promise<void> {
  const runtime = appRuntime;
  if (runtime === null) {
    throw new Error("App runtime is not initialized");
  }
  const userDataPath = app.getPath("userData");
  windowLogger.debug({ userDataPath }, "Reading window state");
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
    show: false,
    backgroundColor: getInitialWindowBackgroundColor(),
    title: APP_DISPLAY_NAME,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windowLogger.info({ bounds: windowState.bounds }, "Created main window");

  const window = mainWindow;
  const syncAppearance = (): void => syncWindowAppearance(window);
  window.on("closed", () => {
    nativeTheme.off("updated", syncAppearance);
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  nativeTheme.on("updated", syncAppearance);
  installWindowStatePersistence(mainWindow, userDataPath);

  if (windowState.isFullScreen) {
    windowLogger.debug("Restoring full-screen window state");
    mainWindow.setFullScreen(true);
  } else if (windowState.isMaximized) {
    windowLogger.debug("Restoring maximized window state");
    mainWindow.maximize();
  }

  const revealWindow = makeOneShotWindowReveal(mainWindow);
  mainWindow.once("ready-to-show", revealWindow);
  mainWindow.webContents.on("did-finish-load", () => {
    windowLogger.debug("Renderer finished loading");
    revealWindow();
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      windowLogger.error({ errorCode, errorDescription, validatedURL }, "Renderer failed to load");
    },
  );

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    windowLogger.info({ url: process.env["ELECTRON_RENDERER_URL"] }, "Loading renderer URL");
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    const rendererPath = join(import.meta.dirname, "../renderer/index.html");
    windowLogger.info({ path: rendererPath }, "Loading bundled renderer");
    void mainWindow.loadFile(rendererPath);
  }
}

app
  .whenReady()
  .then(async () => {
    startupLogger.info(
      { appName: APP_DISPLAY_NAME, isPackaged: app.isPackaged, logLevel: logger.level },
      "Electron app ready",
    );
    installApplicationMenu();
    startupLogger.debug("Application menu installed");
    startupLogger.debug({ userDataPath: app.getPath("userData") }, "Creating app runtime");
    appRuntime = makeAppRuntime(app.getPath("userData"));
    startupLogger.debug("Installing IPC handlers");
    await appRuntime.runPromise(installIpcHandlers((event) => publishCommandStream(event)));
    startupLogger.debug("IPC handlers installed");
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        startupLogger.debug("Recreating main window after app activation");
        void createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    startupLogger.error({ err: error }, "Application startup failed");
    app.exit(1);
  });

app.on("before-quit", (event) => {
  startupLogger.debug("Handling before-quit");
  handleBeforeQuit(event);
});

app.on("window-all-closed", () => {
  startupLogger.debug("All windows closed; quitting app");
  app.quit();
});

function publishCommandStream(event: CommandStreamEvent): void {
  commandStreamLogger.debug(
    {
      runId: event.runId,
      kind: event.kind,
      stream: event.kind === "output" ? event.stream : undefined,
      phase: event.kind === "lifecycle" ? event.phase : undefined,
      repoId: event.repoId,
      command: event.command,
    },
    "Publishing command stream event",
  );
  mainWindow?.webContents.send(COMMANDS_STREAM_CHANNEL, event);
}

function getAppIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icon.png");
  }
  return join(app.getAppPath(), "resources/build-assets/icons/icon-512.png");
}

function getInitialWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

function syncWindowAppearance(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  window.setBackgroundColor(getInitialWindowBackgroundColor());
}

function makeOneShotWindowReveal(window: BrowserWindow): () => void {
  let revealed = false;
  return () => {
    if (revealed || window.isDestroyed()) {
      return;
    }
    revealed = true;
    window.show();
  };
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_DISPLAY_NAME,
        submenu: [
          { role: "about", label: `About ${APP_DISPLAY_NAME}` },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: `Hide ${APP_DISPLAY_NAME}` },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit", label: `Quit ${APP_DISPLAY_NAME}` },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
      },
    ]),
  );
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
        windowLogger.error({ err: error }, "Unable to write window state");
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
    RepoSettingsServiceLive(userDataPath),
    GitServiceLive,
    SetupScriptRunnerLive,
    TerminalLauncherLive,
  ).pipe(Layer.provide(NodeServices.layer));
  const repoLayer = RepoServiceLive(userDataPath).pipe(
    Layer.provideMerge(coreLayer),
    Layer.provide(NodeServices.layer),
  );
  return Layer.mergeAll(
    NodeServices.layer,
    coreLayer,
    repoLayer,
    EffectIpcLive(ipcMain, runPromise),
  );
}

function makeAppRuntime(userDataPath: string): AppRuntime {
  let runtime: AppRuntime;
  runtime = ManagedRuntime.make(makeAppLayer(userDataPath, (effect) => runtime.runPromise(effect)));
  return runtime;
}
