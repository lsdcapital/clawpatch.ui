import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type { TerminalOpenResult } from "../../shared/types";
import { TerminalCwdError, TerminalLaunchError, TerminalUnsupportedPlatformError } from "../errors";

export type TerminalLauncherError =
  | TerminalCwdError
  | TerminalLaunchError
  | TerminalUnsupportedPlatformError;

export interface TerminalLauncherShape {
  readonly open: (cwd: string) => Effect.Effect<TerminalOpenResult, TerminalLauncherError>;
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
        open: (cwd) =>
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

            const child = yield* spawner
              .spawn(ChildProcess.make("open", ["-a", "Terminal", cwd], { shell: false }))
              .pipe(Effect.mapError((cause) => new TerminalLaunchError({ cwd, cause })));
            const exitCode = Number(
              yield* child.exitCode.pipe(
                Effect.mapError((cause) => new TerminalLaunchError({ cwd, cause })),
              ),
            );
            if (exitCode !== 0) {
              return yield* new TerminalLaunchError({
                cwd,
                cause: new Error(`open -a Terminal exited with code ${exitCode}`),
              });
            }
            return { cwd };
          }).pipe(Effect.scoped),
      });
    }),
  );

export const TerminalLauncherLive = makeTerminalLauncherLayer();
