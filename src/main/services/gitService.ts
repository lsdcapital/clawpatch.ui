import { spawn } from "node:child_process";

export async function readGitDiff(repoPath: string): Promise<string> {
  return runGit(repoPath, ["diff", "--no-color"]);
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
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
