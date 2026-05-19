import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClawpatchCommandRequest, CommandResult } from "../../src/shared/types";
import { RepoService, type CommandRunner, normalizeExistingDirectory } from "../../src/main/services/repoService";

const fixtureRepo = resolve("test/fixtures/clawpatch-repo");
const tempDirs: string[] = [];

describe("RepoService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("validates repo paths", async () => {
    await expect(normalizeExistingDirectory("")).rejects.toThrow("Repo path is required");
    await expect(normalizeExistingDirectory(join(fixtureRepo, "missing"))).rejects.toThrow();
    await expect(normalizeExistingDirectory(fixtureRepo)).resolves.toBe(fixtureRepo);
  });

  it("expands shell-style home paths before validation", async () => {
    const originalHome = process.env["HOME"];
    const homeDir = await makeTempDir();
    const repoDir = join(homeDir, "src", "serova", "auth");
    await mkdir(repoDir, { recursive: true });
    process.env["HOME"] = homeDir;

    try {
      await expect(normalizeExistingDirectory("~/src/serova/auth")).resolves.toBe(repoDir);
    } finally {
      if (originalHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = originalHome;
      }
    }
  });

  it("adds repos only after CLI status validation and reads findings", async () => {
    const appData = await makeTempDir();
    const runner = mockRunner();
    const service = new RepoService(appData, runner);

    const summary = await service.addRepo(fixtureRepo);
    const findings = await service.listFindings(summary.id);

    expect(summary.isValid).toBe(true);
    expect(summary.findingCount).toBe(1);
    expect(findings[0].findingId).toBe("fnd-1");
    expect(runner.run).toHaveBeenCalledWith(fixtureRepo, { command: "status" });
  });

  it("uses clawpatch triage for status changes", async () => {
    const appData = await makeTempDir();
    const runner = mockRunner();
    const service = new RepoService(appData, runner);
    const summary = await service.addRepo(fixtureRepo);

    await service.setTriage(summary.id, "fnd-1", "uncertain", "needs product call");

    expect(runner.run).toHaveBeenLastCalledWith(fixtureRepo, {
      command: "triage",
      findingId: "fnd-1",
      status: "uncertain",
      note: "needs product call"
    });
  });
});

function mockRunner(): CommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (_repoPath: string, request: ClawpatchCommandRequest): Promise<CommandResult> => ({
      runId: "run-test",
      command: "clawpatch",
      args: [request.command],
      cwd: fixtureRepo,
      exitCode: 0,
      durationMs: 1,
      stdout: "{}",
      stderr: "",
      parsedJson: {}
    }))
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-gui-"));
  tempDirs.push(dir);
  return dir;
}
