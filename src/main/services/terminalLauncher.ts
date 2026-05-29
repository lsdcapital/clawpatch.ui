import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type { TerminalOpenResult } from "../../shared/types";
import {
  TerminalCwdError,
  TerminalLaunchError,
  TerminalStartupScriptUnsupportedError,
  TerminalUnsupportedPlatformError,
} from "../errors";

export type TerminalLauncherError =
  | TerminalCwdError
  | TerminalLaunchError
  | TerminalStartupScriptUnsupportedError
  | TerminalUnsupportedPlatformError;

export interface TerminalLaunchOptions {
  readonly appName: string;
  readonly startupScript?: string;
}

export interface TerminalLauncherShape {
  readonly open: (
    cwd: string,
    options?: TerminalLaunchOptions,
  ) => Effect.Effect<TerminalOpenResult, TerminalLauncherError>;
}

export class TerminalLauncher extends Context.Service<TerminalLauncher, TerminalLauncherShape>()(
  "clawpatch/TerminalLauncher",
) {}

export const makeTerminalLauncherLayer = (platform: NodeJS.Platform = process.platform) =>
  Layer.effect(
    TerminalLauncher,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return TerminalLauncher.of({
        open: (cwd, options) =>
          Effect.gen(function* () {
            const stats = yield* fs.stat(cwd).pipe(
              Effect.mapError(
                (cause) =>
                  new TerminalCwdError({
                    cwd,
                    message: "Terminal path does not exist",
                    cause,
                  }),
              ),
            );
            if (stats.type !== "Directory") {
              return yield* new TerminalCwdError({
                cwd,
                message: "Terminal path must be a directory",
              });
            }

            if (platform !== "darwin") {
              return yield* new TerminalUnsupportedPlatformError({ platform });
            }

            const appName = normalizeTerminalAppName(options?.appName);
            const startupScript = options?.startupScript?.trim() ?? "";
            const appKind = terminalAppKind(appName);
            const command =
              startupScript === ""
                ? ChildProcess.make("open", ["-a", appName, cwd], { shell: false })
                : yield* Effect.gen(function* () {
                    if (appKind === "unsupported") {
                      return yield* new TerminalStartupScriptUnsupportedError({ appName });
                    }
                    return makeStartupScriptCommand(appName, appKind, cwd, startupScript);
                  });
            const launchDescription = launchCommandDescription(appName, appKind, startupScript);
            const child = yield* spawner
              .spawn(command)
              .pipe(Effect.mapError((cause) => new TerminalLaunchError({ cwd, cause })));
            const exitCode = Number(
              yield* child.exitCode.pipe(
                Effect.mapError((cause) => new TerminalLaunchError({ cwd, cause })),
              ),
            );
            if (exitCode !== 0) {
              return yield* new TerminalLaunchError({
                cwd,
                cause: new Error(`${launchDescription} exited with code ${exitCode}`),
              });
            }
            return { cwd };
          }).pipe(Effect.scoped),
      });
    }),
  );

export const TerminalLauncherLive = makeTerminalLauncherLayer();

function normalizeTerminalAppName(appName: string | undefined): string {
  const trimmed = appName?.trim();
  return trimmed === undefined || trimmed === "" ? "Terminal" : trimmed;
}

function launchCommandDescription(
  appName: string,
  appKind: "terminal" | "ghostty" | "unsupported",
  startupScript: string,
): string {
  if (startupScript === "") {
    return `open -a ${appName}`;
  }
  return appKind === "terminal" ? "osascript" : `open -a ${appName}`;
}

function makeStartupScriptCommand(
  appName: string,
  appKind: "terminal" | "ghostty",
  cwd: string,
  startupScript: string,
): ReturnType<typeof ChildProcess.make> {
  return appKind === "terminal"
    ? makeTerminalStartupCommand(cwd, startupScript)
    : makeGhosttyStartupCommand(appName, cwd, startupScript);
}

function makeTerminalStartupCommand(
  cwd: string,
  startupScript: string,
): ReturnType<typeof ChildProcess.make> {
  const command = `cd ${shellQuote(cwd)}\n${startupScript}`;
  return ChildProcess.make(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      'tell application "Terminal"',
      "-e",
      "activate",
      "-e",
      "do script item 1 of argv",
      "-e",
      "end tell",
      "-e",
      "end run",
      "--",
      command,
    ],
    { shell: false },
  );
}

function makeGhosttyStartupCommand(
  appName: string,
  cwd: string,
  startupScript: string,
): ReturnType<typeof ChildProcess.make> {
  return ChildProcess.make(
    "open",
    [
      "-n",
      "-a",
      appName,
      "--args",
      `--working-directory=${cwd}`,
      "--wait-after-command=true",
      "-e",
      "/bin/zsh",
      "-lc",
      startupScript,
    ],
    { shell: false },
  );
}

function terminalAppKind(appName: string): "terminal" | "ghostty" | "unsupported" {
  const appBasename = appName.trim().split(/[\\/]/).at(-1) ?? "";
  const normalized = appBasename.toLowerCase().replace(/\.app$/, "");
  if (normalized === "terminal") {
    return "terminal";
  }
  if (normalized === "ghostty") {
    return "ghostty";
  }
  return "unsupported";
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
