import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent
} from "../../shared/types";
import { clawpatchStatuses } from "../../shared/types";
import {
  CommandAlreadyRunningError,
  CommandSpawnError,
  CommandValidationError
} from "../errors";

const commandNames = new Set(["status", "report", "review", "triage", "fix", "doctor"]);

export type ClawpatchRunnerError =
  | CommandValidationError
  | CommandAlreadyRunningError
  | CommandSpawnError;

export interface ClawpatchRunnerShape {
  readonly run: (
    repoPath: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void
  ) => Effect.Effect<CommandResult, ClawpatchRunnerError>;
}

export class ClawpatchRunner extends Context.Service<ClawpatchRunner, ClawpatchRunnerShape>()(
  "clawpatch/ClawpatchRunner"
) {}

type RunClawpatchProcess = (input: {
  readonly repoPath: string;
  readonly args: readonly string[];
  readonly runId: string;
  readonly started: number;
  readonly onStream?: (event: CommandStreamEvent) => void;
}) => Promise<CommandResult>;

export const makeClawpatchRunnerLayer = (
  runProcess: RunClawpatchProcess = runClawpatchProcess
) => Layer.effect(
  ClawpatchRunner,
  Effect.gen(function* () {
    const activeRepos = new Set<string>();

    return ClawpatchRunner.of({
      run: Effect.fn("clawpatch.runner.run")(function* (repoPath, request, onStream) {
        if (activeRepos.has(repoPath)) {
          return yield* new CommandAlreadyRunningError({ repoPath });
        }

        const args = yield* Effect.try({
          try: () => buildClawpatchArgs(request),
          catch: (error) =>
            new CommandValidationError({
              message: error instanceof Error ? error.message : String(error)
            })
        });
        const runId = randomUUID();
        const started = Date.now();
        activeRepos.add(repoPath);

        return yield* Effect.tryPromise({
          try: () =>
            runProcess({
              repoPath,
              args,
              runId,
              started,
              onStream
            }),
          catch: (cause) => new CommandSpawnError({ repoPath, cause })
        }).pipe(Effect.ensuring(Effect.sync(() => activeRepos.delete(repoPath))));
      })
    });
  })
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
    case "report":
    case "review":
    case "doctor":
      return args;
    case "triage": {
      assertFindingId(request.findingId);
      if (!isClawpatchStatus(request.status)) {
        throw new Error(`Unsupported triage status: ${request.status}`);
      }
      const triageArgs = [
        ...args,
        "--finding",
        request.findingId,
        "--status",
        request.status
      ];
      if (request.note !== undefined && request.note.trim() !== "") {
        triageArgs.push("--note", request.note);
      }
      return triageArgs;
    }
    case "fix":
      assertFindingId(request.findingId);
      return [...args, "--finding", request.findingId];
  }
}

function runClawpatchProcess(input: {
  readonly repoPath: string;
  readonly args: readonly string[];
  readonly runId: string;
  readonly started: number;
  readonly onStream?: (event: CommandStreamEvent) => void;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("clawpatch", input.args, {
      cwd: input.repoPath,
      shell: false,
      env: { ...process.env, NO_COLOR: "1" }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      input.onStream?.({ runId: input.runId, stream: "stdout", chunk });
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      input.onStream?.({ runId: input.runId, stream: "stderr", chunk });
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      resolve({
        runId: input.runId,
        command: "clawpatch",
        args: [...input.args],
        cwd: input.repoPath,
        exitCode,
        durationMs: Date.now() - input.started,
        stdout,
        stderr,
        parsedJson: parseJsonOutput(stdout)
      });
    });
  });
}

function assertFindingId(findingId: string): void {
  if (typeof findingId !== "string" || findingId.trim() === "") {
    throw new Error("Missing findingId");
  }
  if (/[\0\r\n]/u.test(findingId)) {
    throw new Error("Invalid findingId");
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
