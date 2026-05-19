import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent
} from "../../shared/types";
import { clawpatchStatuses } from "../../shared/types";

const commandNames = new Set(["status", "report", "review", "triage", "fix", "doctor"]);

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

export class ClawpatchRunner {
  private readonly activeRepos = new Set<string>();

  async run(
    repoPath: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void
  ): Promise<CommandResult> {
    if (this.activeRepos.has(repoPath)) {
      throw new Error("A Clawpatch command is already running for this repo");
    }

    const args = buildClawpatchArgs(request);
    const runId = randomUUID();
    const started = Date.now();
    this.activeRepos.add(repoPath);

    return new Promise((resolve, reject) => {
      const child = spawn("clawpatch", args, {
        cwd: repoPath,
        shell: false,
        env: { ...process.env, NO_COLOR: "1" }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        onStream?.({ runId, stream: "stdout", chunk });
      });

      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        onStream?.({ runId, stream: "stderr", chunk });
      });

      child.on("error", (error) => {
        this.activeRepos.delete(repoPath);
        reject(error);
      });

      child.on("close", (exitCode) => {
        this.activeRepos.delete(repoPath);
        resolve({
          runId,
          command: "clawpatch",
          args,
          cwd: repoPath,
          exitCode,
          durationMs: Date.now() - started,
          stdout,
          stderr,
          parsedJson: parseJsonOutput(stdout)
        });
      });
    });
  }
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
