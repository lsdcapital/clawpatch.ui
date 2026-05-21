import type { FindingWorkStatus, GitStatusSummary } from "../../shared/types";

export type FindingWorkState = "dirty" | "pr" | "worktree" | "unknown";

export function findingWorkState(status: FindingWorkStatus): FindingWorkState {
  if (status.gitStatus === null) {
    return "unknown";
  }
  if (isGitStatusDirty(status.gitStatus)) {
    return "dirty";
  }
  return status.prUrl === null ? "worktree" : "pr";
}

export function findingWorkLabel(status: FindingWorkStatus): string {
  const state = findingWorkState(status);
  if (state === "dirty") {
    return "Dirty";
  }
  if (state === "pr") {
    return "PR";
  }
  if (state === "unknown") {
    return "Unknown";
  }
  return "Worktree";
}

export function findingWorkTitle(status: FindingWorkStatus): string {
  const state = findingWorkState(status);
  if (state === "dirty" && status.gitStatus !== null) {
    const counts = formatGitStatusCounts(status.gitStatus);
    return status.prUrl === null
      ? `Uncommitted work: ${counts}`
      : `Local unpublished changes after PR: ${counts}`;
  }
  if (state === "pr") {
    return "PR link available";
  }
  if (state === "unknown") {
    return status.error ?? "Unable to read worktree status";
  }
  return "Managed worktree active";
}

export function isGitStatusDirty(status: GitStatusSummary): boolean {
  return status.staged + status.modified + status.untracked > 0;
}

export function formatGitStatusCounts(status: GitStatusSummary): string {
  const parts: string[] = [];
  if (status.staged > 0) {
    parts.push(`${status.staged} staged`);
  }
  if (status.modified > 0) {
    parts.push(`${status.modified} modified`);
  }
  if (status.untracked > 0) {
    parts.push(`${status.untracked} untracked`);
  }
  return parts.length === 0 ? "clean" : parts.join(" · ");
}
