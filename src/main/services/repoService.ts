import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent,
  FindingDetail,
  FindingListItem,
  RepoSnapshot,
  RepoSummary
} from "../../shared/types";
import { ClawpatchRunner } from "./clawpatchRunner";
import { detectClawpatch, readFindingDetail, readFindingList } from "./clawpatchState";
import { readGitDiff } from "./gitService";
import { readGuiMetadata } from "./guiMetadata";

interface RegistryFile {
  repos: Array<Pick<RepoSummary, "id" | "name" | "path" | "updatedAt">>;
}

export interface CommandRunner {
  run(
    repoPath: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void
  ): Promise<CommandResult>;
}

export class RepoService {
  private readonly registryPath: string;

  constructor(
    appDataDir: string,
    private readonly runner: CommandRunner = new ClawpatchRunner()
  ) {
    this.registryPath = resolve(appDataDir, "repos.json");
  }

  async listRepos(): Promise<RepoSummary[]> {
    const registry = await this.readRegistry();
    return Promise.all(registry.repos.map((repo) => this.summarizeRepo(repo.path, repo.id)));
  }

  async addRepo(repoPath: string): Promise<RepoSummary> {
    const normalized = await normalizeExistingDirectory(repoPath);
    const registry = await this.readRegistry();
    const existing = registry.repos.find((repo) => repo.path === normalized);
    if (existing !== undefined) {
      return this.summarizeRepo(existing.path, existing.id);
    }

    const repo = {
      id: repoId(normalized),
      name: basename(normalized),
      path: normalized,
      updatedAt: new Date().toISOString()
    };
    registry.repos.push(repo);
    await this.writeRegistry(registry);
    return this.summarizeRepo(normalized, repo.id);
  }

  async refreshRepo(repoIdValue: string): Promise<RepoSnapshot> {
    const repo = await this.requireRepo(repoIdValue);
    const [summary, metadata, diff] = await Promise.all([
      this.summarizeRepo(repo.path, repo.id),
      readGuiMetadata(repo.path),
      readGitDiff(repo.path)
    ]);
    const findings = await readFindingList(repo.path, metadata);
    return {
      repo: { ...summary, findingCount: findings.length, openFindingCount: findings.filter((item) => item.status === "open").length },
      status: summary.lastError === null ? (await this.runner.run(repo.path, { command: "status" })).parsedJson : null,
      findings,
      diff,
      metadata
    };
  }

  async listFindings(repoIdValue: string): Promise<FindingListItem[]> {
    const repo = await this.requireRepo(repoIdValue);
    return readFindingList(repo.path, await readGuiMetadata(repo.path));
  }

  async getFinding(repoIdValue: string, findingId: string): Promise<FindingDetail> {
    const repo = await this.requireRepo(repoIdValue);
    return readFindingDetail(repo.path, findingId, await readGuiMetadata(repo.path));
  }

  async runCommand(
    repoIdValue: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void
  ): Promise<CommandResult> {
    const repo = await this.requireRepo(repoIdValue);
    return this.runner.run(repo.path, request, onStream);
  }

  async setTriage(
    repoIdValue: string,
    findingId: string,
    status: ClawpatchStatus,
    note = ""
  ): Promise<CommandResult> {
    const repo = await this.requireRepo(repoIdValue);
    return this.runner.run(repo.path, { command: "triage", findingId, status, note });
  }

  async readDiff(repoIdValue: string): Promise<string> {
    const repo = await this.requireRepo(repoIdValue);
    return readGitDiff(repo.path);
  }

  private async summarizeRepo(repoPath: string, id: string): Promise<RepoSummary> {
    const hasClawpatch = await detectClawpatch(repoPath);
    let isValid = false;
    let lastError: string | null = null;
    let findings: FindingListItem[] = [];

    if (!hasClawpatch) {
      lastError = "No .clawpatch state found";
    } else {
      const status = await this.runner.run(repoPath, { command: "status" }).catch((error: unknown) => ({
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: ""
      }));
      isValid = status.exitCode === 0;
      lastError = isValid ? null : status.stderr || status.stdout || "clawpatch status failed";
      findings = await readFindingList(repoPath, await readGuiMetadata(repoPath)).catch(() => []);
    }

    return {
      id,
      name: basename(repoPath),
      path: repoPath,
      hasClawpatch,
      isValid,
      lastError,
      findingCount: findings.length,
      openFindingCount: findings.filter((item) => item.status === "open").length,
      updatedAt: new Date().toISOString()
    };
  }

  private async requireRepo(repoIdValue: string): Promise<RegistryFile["repos"][number]> {
    const registry = await this.readRegistry();
    const repo = registry.repos.find((item) => item.id === repoIdValue);
    if (repo === undefined) {
      throw new Error(`Repo not found: ${repoIdValue}`);
    }
    await normalizeExistingDirectory(repo.path);
    return repo;
  }

  private async readRegistry(): Promise<RegistryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.registryPath, "utf8")) as Partial<RegistryFile>;
      return { repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
    } catch {
      return { repos: [] };
    }
  }

  private async writeRegistry(registry: RegistryFile): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    await writeFile(this.registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }
}

export async function normalizeExistingDirectory(inputPath: string): Promise<string> {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("Repo path is required");
  }
  if (/[\0\r\n]/u.test(inputPath)) {
    throw new Error("Repo path contains invalid characters");
  }

  const normalized = resolve(expandHomePath(inputPath.trim()));
  const stats = await stat(normalized);
  if (!stats.isDirectory()) {
    throw new Error("Repo path must be a directory");
  }
  return normalized;
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") {
    return homedir();
  }
  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function repoId(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}
