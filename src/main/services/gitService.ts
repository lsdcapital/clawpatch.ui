import { spawn } from "node:child_process";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CommandSpawnError } from "../errors";

export interface GitServiceShape {
  readonly readDiff: (repoPath: string) => Effect.Effect<string, CommandSpawnError>;
}

export class GitService extends Context.Service<GitService, GitServiceShape>()(
  "clawpatch/GitService",
) {}

export const GitServiceLive = Layer.succeed(
  GitService,
  GitService.of({
    readDiff: Effect.fn("git.readDiff")(function* (repoPath) {
      return yield* Effect.tryPromise({
        try: () => runGit(repoPath, ["diff", "--no-color"]),
        catch: (cause) => new CommandSpawnError({ repoPath, cause }),
      });
    }),
  }),
);

function runGit(repoPath: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoPath, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve(error.message);
    });
    child.on("close", () => {
      resolve(stdout || stderr);
    });
  });
}
