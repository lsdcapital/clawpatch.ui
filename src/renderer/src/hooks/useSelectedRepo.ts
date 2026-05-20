import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepoSummary } from "../../../shared/types";

const SELECTED_REPO_STORAGE_KEY = "clawpatch.selectedRepoId.v1";

export function useSelectedRepo(repos: readonly RepoSummary[] | undefined): {
  selectedRepo: RepoSummary | null;
  selectRepo: (repoId: string) => void;
} {
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(readStoredSelectedRepoId);

  const selectedRepo = useMemo(
    () => repos?.find((repo) => repo.id === selectedRepoId) ?? repos?.[0] ?? null,
    [repos, selectedRepoId],
  );

  useEffect(() => {
    if (repos === undefined) {
      return;
    }
    const nextRepoId = repos.find((repo) => repo.id === selectedRepoId)?.id ?? repos[0]?.id ?? null;
    if (nextRepoId !== selectedRepoId) {
      setSelectedRepoId(nextRepoId);
    }
    if (nextRepoId !== null) {
      persistSelectedRepoId(nextRepoId);
    }
  }, [repos, selectedRepoId]);

  const selectRepo = useCallback((repoId: string): void => {
    setSelectedRepoId(repoId);
    persistSelectedRepoId(repoId);
  }, []);

  return { selectedRepo, selectRepo };
}

function readStoredSelectedRepoId(): string | null {
  let storedRepoId: string | null;
  try {
    storedRepoId = window.localStorage.getItem(SELECTED_REPO_STORAGE_KEY);
  } catch {
    return null;
  }

  return storedRepoId === null || storedRepoId.trim() === "" ? null : storedRepoId;
}

function persistSelectedRepoId(repoId: string): void {
  try {
    window.localStorage.setItem(SELECTED_REPO_STORAGE_KEY, repoId);
  } catch {
    // Repo selection should keep working even if local storage is unavailable.
  }
}
