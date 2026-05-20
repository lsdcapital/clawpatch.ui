import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type { CommandResult, CommandStreamEvent } from "../../shared/types";
import { CommandSpawnError } from "../errors";

interface ScriptMetadata {
  readonly repoId: string;
  readonly findingId?: string;
  readonly command: string;
  readonly runId?: string;
}

export interface SetupScriptRunnerShape {
  readonly run: (
    cwd: string,
    script: string,
    metadata: ScriptMetadata,
    onStream?: (event: CommandStreamEvent) => void,
  ) => Effect.Effect<CommandResult, CommandSpawnError>;
}

export class SetupScriptRunner extends Context.Service<SetupScriptRunner, SetupScriptRunnerShape>()(
  "clawpatch/SetupScriptRunner",
) {}

export const SetupScriptRunnerLive = Layer.effect(
  SetupScriptRunner,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return SetupScriptRunner.of({
      run: Effect.fn("setupScriptRunner.run")(function* (cwd, script, metadata, onStream) {
        return yield* Effect.gen(function* () {
          const runId = metadata.runId ?? randomUUID();
          const args = ["-lc", script];
          const argv = ["/bin/zsh", ...args];
          const started = Date.now();
          onStream?.({
            kind: "lifecycle",
            runId,
            repoId: metadata.repoId,
            findingId: metadata.findingId,
            command: metadata.command,
            phase: "setup:start",
            message: "$ /bin/zsh -lc <worktree setup script>",
            cwd,
            argv,
          });

          const child = yield* spawner
            .spawn(
              ChildProcess.make("/bin/zsh", args, {
                cwd,
                shell: false,
                extendEnv: true,
                killSignal: "SIGINT",
                forceKillAfter: "2 seconds",
              }),
            )
            .pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath: cwd, cause })));
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectOutput(child.stdout, runId, "stdout", metadata, onStream),
              collectOutput(child.stderr, runId, "stderr", metadata, onStream),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          ).pipe(
            Effect.onInterrupt(() =>
              child.kill({ killSignal: "SIGINT", forceKillAfter: "2 seconds" }).pipe(Effect.asVoid),
            ),
            Effect.mapError((cause) => new CommandSpawnError({ repoPath: cwd, cause })),
          );
          const numericExitCode = Number(exitCode);
          const result: CommandResult = {
            runId,
            command: "/bin/zsh",
            args,
            cwd,
            exitCode: numericExitCode,
            durationMs: Date.now() - started,
            stdout,
            stderr,
            parsedJson: null,
          };
          onStream?.({
            kind: "lifecycle",
            runId,
            repoId: metadata.repoId,
            findingId: metadata.findingId,
            command: metadata.command,
            phase: numericExitCode === 0 ? "setup:complete" : "setup:failed",
            message:
              numericExitCode === 0
                ? "Worktree setup script completed."
                : `Worktree setup script failed with exit code ${numericExitCode}.`,
            cwd,
          });
          if (numericExitCode !== 0) {
            return yield* new CommandSpawnError({
              repoPath: cwd,
              cause: new Error(`Worktree setup script failed with exit code ${numericExitCode}`),
            });
          }
          return result;
        }).pipe(Effect.scoped);
      }),
    });
  }),
);

function collectOutput(
  stream: Stream.Stream<Uint8Array, unknown>,
  runId: string,
  streamName: "stdout" | "stderr",
  metadata: ScriptMetadata,
  onStream?: (event: CommandStreamEvent) => void,
): Effect.Effect<string, unknown> {
  return stream.pipe(
    Stream.decodeText(),
    Stream.tap((chunk) =>
      Effect.sync(() => {
        onStream?.({
          kind: "output",
          runId,
          repoId: metadata.repoId,
          findingId: metadata.findingId,
          command: metadata.command,
          stream: streamName,
          chunk,
        });
      }),
    ),
    Stream.runFold(
      () => "",
      (output, chunk) => output + chunk,
    ),
  );
}
