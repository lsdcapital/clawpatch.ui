import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import {
  TerminalLauncher,
  type TerminalLauncherShape,
  makeTerminalLauncherLayer,
} from "../../src/main/services/terminalLauncher";

describe("TerminalLauncher", () => {
  it("opens macOS Terminal at the requested cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));
    const commands: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly shell: boolean | undefined;
    }> = [];
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: readonly string[];
          readonly options: { readonly shell?: boolean };
        };
        commands.push({
          command: childProcess.command,
          args: childProcess.args,
          shell: childProcess.options.shell,
        });
        return Effect.succeed(mockHandle());
      }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* TerminalLauncher;
        return yield* terminal.open(cwd);
      }).pipe(
        Effect.provide(
          makeTerminalLauncherLayer("darwin").pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
          ),
        ),
      ),
    );

    expect(result).toEqual({ cwd });
    expect(commands).toEqual([{ command: "open", args: ["-a", "Terminal", cwd], shell: false }]);
  });

  it("opens a configured terminal app without a startup script", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));
    const commands: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly shell: boolean | undefined;
    }> = [];
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: readonly string[];
          readonly options: { readonly shell?: boolean };
        };
        commands.push({
          command: childProcess.command,
          args: childProcess.args,
          shell: childProcess.options.shell,
        });
        return Effect.succeed(mockHandle());
      }),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* TerminalLauncher;
        return yield* terminal.open(cwd, { appName: "iTerm", startupScript: "" });
      }).pipe(
        Effect.provide(
          makeTerminalLauncherLayer("darwin").pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
          ),
        ),
      ),
    );

    expect(commands).toEqual([{ command: "open", args: ["-a", "iTerm", cwd], shell: false }]);
  });

  it("runs Terminal.app startup scripts with osascript", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));
    const commands: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly shell: boolean | undefined;
    }> = [];
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: readonly string[];
          readonly options: { readonly shell?: boolean };
        };
        commands.push({
          command: childProcess.command,
          args: childProcess.args,
          shell: childProcess.options.shell,
        });
        return Effect.succeed(mockHandle());
      }),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* TerminalLauncher;
        return yield* terminal.open(cwd, {
          appName: "Terminal",
          startupScript: "pnpm dev",
        });
      }).pipe(
        Effect.provide(
          makeTerminalLauncherLayer("darwin").pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
          ),
        ),
      ),
    );

    expect(commands[0]?.command).toBe("osascript");
    expect(commands[0]?.args.join("\n")).toContain("pnpm dev");
    expect(commands[0]?.shell).toBe(false);
  });

  it("rejects startup scripts for non-Terminal apps", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));

    await expect(
      openTerminal(cwd, "darwin", { appName: "iTerm", startupScript: "pnpm dev" }),
    ).rejects.toThrow("Terminal startup scripts are only supported with Terminal.app for now");
  });

  it("rejects missing or non-directory cwd values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));
    const filePath = join(dir, "file.txt");
    await writeFile(filePath, "not a directory\n", "utf8");

    await expect(openTerminal(join(dir, "missing"), "darwin")).rejects.toThrow(
      "Terminal path does not exist",
    );
    await expect(openTerminal(filePath, "darwin")).rejects.toThrow(
      "Terminal path must be a directory",
    );
  });

  it("rejects unsupported platforms", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clawpatch-terminal-"));

    await expect(openTerminal(cwd, "linux")).rejects.toThrow(
      "Opening Terminal is only supported on macOS for now",
    );
  });
});

function openTerminal(
  cwd: string,
  platform: NodeJS.Platform,
  options?: Parameters<TerminalLauncherShape["open"]>[1],
): Promise<unknown> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* TerminalLauncher;
      return yield* terminal.open(cwd, options);
    }).pipe(
      Effect.provide(
        makeTerminalLauncherLayer(platform).pipe(
          Layer.provide(
            Layer.mergeAll(
              NodeServices.layer,
              Layer.succeed(
                ChildProcessSpawner.ChildProcessSpawner,
                ChildProcessSpawner.make(() => Effect.succeed(mockHandle())),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function mockHandle(
  options: { readonly code?: number } = {},
): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}
