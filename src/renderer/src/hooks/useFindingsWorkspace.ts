import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clawpatchStatuses } from "../../../shared/constants";
import type { RepoSummary } from "../../../shared/types";
import { clawpatchQueryKeys } from "../clawpatchQueries";
import {
  defaultFindingFilters,
  defaultFindingSort,
  filterFindings,
  getFindingFilterOptions,
  resolveSelectedFindingId,
  sortFindings,
} from "../findingsFilters";

const GIT_STATUS_REFETCH_INTERVAL_MS = 5_000;

export function useFindingsWorkspace({ selectedRepo }: { selectedRepo: RepoSummary | null }) {
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [findingFilters, setFindingFilters] = useState(defaultFindingFilters);
  const [findingSort, setFindingSort] = useState(defaultFindingSort);

  const findingsQuery = useQuery({
    queryKey: clawpatchQueryKeys.findings(selectedRepo?.id),
    queryFn: () => window.clawpatch.findings.list(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  const workStatusesQuery = useQuery({
    queryKey: clawpatchQueryKeys.findingWorkStatuses(selectedRepo?.id),
    queryFn: () => window.clawpatch.findings.workStatuses(selectedRepo!.id),
    enabled: selectedRepo !== null,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const allFindings = useMemo(() => findingsQuery.data ?? [], [findingsQuery.data]);
  const filteredFindings = useMemo(
    () => filterFindings(allFindings, findingFilters),
    [allFindings, findingFilters],
  );
  const sortedFindings = useMemo(
    () => sortFindings(filteredFindings, findingSort),
    [filteredFindings, findingSort],
  );
  const findingFilterOptions = useMemo(
    () => getFindingFilterOptions(allFindings, clawpatchStatuses),
    [allFindings],
  );
  const workStatusByFindingId = useMemo(
    () =>
      new Map((workStatusesQuery.data ?? []).map((status) => [status.findingId, status] as const)),
    [workStatusesQuery.data],
  );

  const selectedFinding = useMemo(
    () =>
      sortedFindings.find((finding) => finding.findingId === selectedFindingId) ??
      sortedFindings[0] ??
      null,
    [selectedFindingId, sortedFindings],
  );

  useEffect(() => {
    if (findingsQuery.data === undefined) {
      return;
    }
    const nextSelectedFindingId = resolveSelectedFindingId(selectedFindingId, sortedFindings);
    if (nextSelectedFindingId !== selectedFindingId) {
      setSelectedFindingId(nextSelectedFindingId);
    }
  }, [findingsQuery.data, selectedFindingId, sortedFindings]);

  const detailQuery = useQuery({
    queryKey: clawpatchQueryKeys.finding(selectedRepo?.id, selectedFinding?.findingId),
    queryFn: () => window.clawpatch.findings.get(selectedRepo!.id, selectedFinding!.findingId),
    enabled: selectedRepo !== null && selectedFinding !== null,
  });

  const gitStatusQuery = useQuery({
    queryKey: clawpatchQueryKeys.gitStatus(selectedRepo?.id, selectedFinding?.findingId),
    queryFn: () => window.clawpatch.git.status(selectedRepo!.id, selectedFinding?.findingId),
    enabled: selectedRepo !== null,
    placeholderData: (previousData, previousQuery) =>
      selectedRepo !== null && previousQuery?.queryKey[1] === selectedRepo.id
        ? previousData
        : undefined,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const registeredCheckoutStatusQuery = useQuery({
    queryKey: clawpatchQueryKeys.registeredCheckoutStatus(selectedRepo?.id),
    queryFn: () => window.clawpatch.git.status(selectedRepo!.id),
    enabled: selectedRepo !== null,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const fixDisabledReason = useMemo(() => {
    if (selectedRepo === null) {
      return null;
    }
    if (registeredCheckoutStatusQuery.isError) {
      return "Unable to verify registered checkout status.";
    }
    const status = registeredCheckoutStatusQuery.data;
    if (status === undefined) {
      return "Checking registered checkout...";
    }
    const dirtyCount = status.staged + status.modified + status.untracked;
    return dirtyCount > 0
      ? "Commit, stash, or discard registered checkout changes before running fix."
      : null;
  }, [registeredCheckoutStatusQuery.data, registeredCheckoutStatusQuery.isError, selectedRepo]);

  return {
    allFindings,
    detailQuery,
    findingFilterOptions,
    findingFilters,
    findingSort,
    findingsQuery,
    fixDisabledReason,
    gitStatusQuery,
    selectedFinding,
    setFindingFilters,
    setFindingSort,
    setSelectedFindingId,
    sortedFindings,
    workStatusByFindingId,
    workStatusesQuery,
  };
}
