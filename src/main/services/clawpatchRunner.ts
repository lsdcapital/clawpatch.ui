import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandInterruptResult,
  CommandResult,
  CommandStreamEvent,
} from "../../shared/types";
import { clawpatchStatuses } from "../../shared/types";
import { CommandAlreadyRunningError, CommandSpawnError, CommandValidationError } from "../errors";

const commandNames = new Set([
  "status",
  "map",
  "report",
  "review",
  "triage",
  "fix",
  "revalidate",
  "doctor",
]);

export type ClawpatchRunnerError =
  | CommandValidationError
  | CommandAlreadyRunningError
  | CommandSpawnError;

export interface ClawpatchRunnerShape {
  readonly run: (
    repoPath: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void,
  ) => Effect.Effect<CommandResult, ClawpatchRunnerError>;
  readonly interrupt: (repoPath: string) => Effect.Effect<CommandInterruptResult>;
  readonly isRunning: (repoPath: string) => Effect.Effect<boolean>;
}

export class ClawpatchRunner extends Context.Service<ClawpatchRunner, ClawpatchRunnerShape>()(
  "clawpatch/ClawpatchRunner",
) {}

export const makeClawpatchRunnerLayer = () =>
  Layer.effect(
    ClawpatchRunner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const activeCommands = new Map<string, { interrupt: Effect.Effect<boolean> }>();

      return ClawpatchRunner.of({
        run: Effect.fn("clawpatch.runner.run")(function* (repoPath, request, onStream) {
          if (activeCommands.has(repoPath)) {
            return yield* new CommandAlreadyRunningError({ repoPath });
          }

          const args = yield* Effect.try({
            try: () => buildClawpatchArgs(request),
            catch: (error) =>
              new CommandValidationError({
                message: error instanceof Error ? error.message : String(error),
              }),
          });
          const runId = randomUUID();
          const started = Date.now();
          const activeCommand = { interrupt: Effect.succeed(false) };
          activeCommands.set(repoPath, activeCommand);

          return yield* runClawpatchProcess({
            spawner,
            repoPath,
            args,
            runId,
            started,
            onStream,
            registerInterrupt: (interrupt) => {
              activeCommand.interrupt = interrupt;
            },
          }).pipe(
            Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
            Effect.ensuring(Effect.sync(() => activeCommands.delete(repoPath))),
          );
        }),
        interrupt: Effect.fn("clawpatch.runner.interrupt")(function* (repoPath) {
          const activeCommand = activeCommands.get(repoPath);
          if (activeCommand === undefined) {
            return { interrupted: false };
          }
          return { interrupted: yield* activeCommand.interrupt };
        }),
        isRunning: (repoPath) => Effect.sync(() => activeCommands.has(repoPath)),
      });
    }),
  );

export const ClawpatchRunnerLive = makeClawpatchRunnerLayer();

export function isClawpatchStatus(value: string): value is ClawpatchStatus {
  return (clawpatchStatuses as readonly string[]).includes(value);
}

export function buildClawpatchArgs(request: ClawpatchCommandRequest): string[] {
  if (!commandNames.has(request.command)) {
    throw new Error("Unsupported Clawpatch command");
  }

  const args = ["--json", "--no-color", "--no-input", request.command];

  switch (request.command) {
    case "status":
    case "map":
    case "report":
    case "doctor":
      return args;
    case "review": {
      const reviewArgs = [...args];
      if (request.featureId !== undefined) {
        assertClawpatchId(request.featureId, "featureId");
        reviewArgs.push("--feature", request.featureId);
      }
      if (request.limit !== undefined) {
        assertLimit(request.limit);
        reviewArgs.push("--limit", String(Math.floor(request.limit)));
      }
      return reviewArgs;
    }
    case "triage": {
      assertFindingId(request.findingId);
      if (!isClawpatchStatus(request.status)) {
        throw new Error(`Unsupported triage status: ${request.status}`);
      }
      const triageArgs = [...args, "--finding", request.findingId, "--status", request.status];
      if (request.note !== undefined && request.note.trim() !== "") {
        triageArgs.push("--note", request.note);
      }
      return triageArgs;
    }
    case "fix":
    case "revalidate":
      assertFindingId(request.findingId);
      return [...args, "--finding", request.findingId];
  }
}

function runClawpatchProcess(input: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly repoPath: string;
  readonly args: readonly string[];
  readonly runId: string;
  readonly started: number;
  readonly onStream?: (event: CommandStreamEvent) => void;
  readonly registerInterrupt: (interrupt: Effect.Effect<boolean>) => void;
}) {
  return Effect.gen(function* () {
    const child = yield* input.spawner.spawn(
      ChildProcess.make("clawpatch", input.args, {
        cwd: input.repoPath,
        shell: false,
        env: { NO_COLOR: "1" },
        extendEnv: true,
        killSignal: "SIGINT",
        forceKillAfter: "2 seconds",
      }),
    );
    const interrupt = interruptChild(child);
    input.registerInterrupt(interrupt);

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectOutput(child.stdout, input.runId, "stdout", input.onStream),
        collectOutput(child.stderr, input.runId, "stderr", input.onStream),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.onInterrupt(() => interrupt.pipe(Effect.asVoid)));

    return {
      runId: input.runId,
      command: "clawpatch",
      args: [...input.args],
      cwd: input.repoPath,
      exitCode,
      durationMs: Date.now() - input.started,
      stdout,
      stderr,
      parsedJson: parseJsonOutput(stdout),
    };
  }).pipe(Effect.scoped);
}

function interruptChild(child: ChildProcessSpawner.ChildProcessHandle): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const isRunning = yield* child.isRunning;
    if (!isRunning) {
      return false;
    }
    yield* child.kill({ killSignal: "SIGINT", forceKillAfter: "2 seconds" });
    return true;
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

function collectOutput(
  stream: Stream.Stream<Uint8Array, unknown>,
  runId: string,
  streamName: "stdout" | "stderr",
  onStream?: (event: CommandStreamEvent) => void,
): Effect.Effect<string, unknown> {
  return stream.pipe(
    Stream.decodeText(),
    Stream.tap((chunk) =>
      Effect.sync(() => {
        onStream?.({ runId, stream: streamName, chunk });
      }),
    ),
    Stream.runFold(
      () => "",
      (output, chunk) => output + chunk,
    ),
  );
}

function assertFindingId(findingId: string): void {
  assertClawpatchId(findingId, "findingId");
}

function assertClawpatchId(id: string, field: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Missing ${field}`);
  }
  if (id.includes("\0") || id.includes("\r") || id.includes("\n")) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertLimit(limit: number): void {
  if (!Number.isFinite(limit) || limit < 1 || Math.floor(limit) !== limit) {
    throw new Error("Invalid review limit");
  }
}

function parseJsonOutput(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
