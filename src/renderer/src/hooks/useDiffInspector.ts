import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FindingListItem, RepoSummary } from "../../../shared/types";
import { clawpatchQueryKeys } from "../clawpatchQueries";
import { extractDiffFilePaths } from "../components/DiffViewer";

export function useDiffInspector({
  selectedRepo,
  selectedFinding,
  onOpenDiff,
}: {
  selectedRepo: RepoSummary | null;
  selectedFinding: FindingListItem | null;
  onOpenDiff: () => void;
}) {
  const queryClient = useQueryClient();
  const [diffJump, setDiffJump] = useState<{ path: string; epoch: number } | null>(null);

  const diffQuery = useQuery({
    queryKey: clawpatchQueryKeys.diff(selectedRepo?.id, selectedFinding?.findingId),
    queryFn: () => window.clawpatch.git.diff(selectedRepo!.id, selectedFinding?.findingId),
    enabled: selectedRepo !== null,
  });

  const filesInDiff = useMemo(() => extractDiffFilePaths(diffQuery.data ?? ""), [diffQuery.data]);

  const jumpToDiffFile = useCallback((filePath: string): void => {
    setDiffJump((prev) => ({ path: filePath, epoch: (prev?.epoch ?? 0) + 1 }));
  }, []);

  const openDiffFile = useCallback(
    (filePath: string): void => {
      onOpenDiff();
      jumpToDiffFile(filePath);
      if (selectedRepo !== null) {
        void queryClient.invalidateQueries({
          queryKey: clawpatchQueryKeys.repoDiffs(selectedRepo.id),
        });
      }
    },
    [jumpToDiffFile, onOpenDiff, queryClient, selectedRepo],
  );

  const revealFirstChangedFile = useCallback(
    async (findingId: string): Promise<void> => {
      if (selectedRepo === null) {
        return;
      }
      try {
        const detail = await queryClient.fetchQuery({
          queryKey: clawpatchQueryKeys.finding(selectedRepo.id, findingId),
          queryFn: () => window.clawpatch.findings.get(selectedRepo.id, findingId),
        });
        const patches = detail.patchAttempts ?? [];
        const newest = patches[0];
        const firstFile = newest?.filesChanged?.[0];
        if (typeof firstFile === "string" && firstFile !== "") {
          onOpenDiff();
          jumpToDiffFile(firstFile);
        }
      } catch {
        // Diff auto-reveal is best-effort.
      }
    },
    [jumpToDiffFile, onOpenDiff, queryClient, selectedRepo],
  );

  return {
    diff: diffQuery.data ?? "",
    diffJump,
    filesInDiff,
    isDiffLoading: diffQuery.isLoading,
    openDiffFile,
    revealFirstChangedFile,
  };
}
