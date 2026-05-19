import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent,
  FindingListItem,
  RepoSummary
} from "../../../shared/types";
import { CommandPanel } from "../components/CommandPanel";
import { DiffViewer } from "../components/DiffViewer";
import { FindingDetailPanel } from "../components/FindingDetailPanel";
import { FindingsTable } from "../components/FindingsTable";
import { RepoSidebar } from "../components/RepoSidebar";

type LogEntry =
  | { kind: "stream"; event: CommandStreamEvent }
  | { kind: "result"; result: CommandResult }
  | { kind: "error"; message: string };

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState<LogEntry[]>([]);

  const reposQuery = useQuery({
    queryKey: ["repos"],
    queryFn: () => window.clawpatch.repo.list()
  });

  const selectedRepo = useMemo(
    () => reposQuery.data?.find((repo) => repo.id === selectedRepoId) ?? reposQuery.data?.[0] ?? null,
    [reposQuery.data, selectedRepoId]
  );

  useEffect(() => {
    if (selectedRepoId === null && selectedRepo !== null) {
      setSelectedRepoId(selectedRepo.id);
    }
  }, [selectedRepo, selectedRepoId]);

  const findingsQuery = useQuery({
    queryKey: ["findings", selectedRepo?.id],
    queryFn: () => window.clawpatch.findings.list(selectedRepo!.id),
    enabled: selectedRepo !== null
  });

  const selectedFinding = useMemo(
    () => findingsQuery.data?.find((finding) => finding.findingId === selectedFindingId) ?? findingsQuery.data?.[0] ?? null,
    [findingsQuery.data, selectedFindingId]
  );

  useEffect(() => {
    if (selectedFindingId === null && selectedFinding !== null) {
      setSelectedFindingId(selectedFinding.findingId);
    }
  }, [selectedFinding, selectedFindingId]);

  const detailQuery = useQuery({
    queryKey: ["finding", selectedRepo?.id, selectedFinding?.findingId],
    queryFn: () => window.clawpatch.findings.get(selectedRepo!.id, selectedFinding!.findingId),
    enabled: selectedRepo !== null && selectedFinding !== null
  });

  const diffQuery = useQuery({
    queryKey: ["diff", selectedRepo?.id],
    queryFn: () => window.clawpatch.git.diff(selectedRepo!.id),
    enabled: selectedRepo !== null
  });

  useEffect(() => {
    return window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => [...current, { kind: "stream", event }]);
    });
  }, []);

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      setSelectedRepoId(repo.id);
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    }
  });

  const commandMutation = useMutation({
    mutationFn: ({ repo, request }: { repo: RepoSummary; request: ClawpatchCommandRequest }) =>
      window.clawpatch.commands.run(repo.id, request),
    onSuccess: (result) => {
      setCommandLog((current) => [...current, { kind: "result", result }]);
      void invalidateRepo(queryClient, selectedRepo?.id ?? null);
    },
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) }
      ]);
    }
  });

  const triageMutation = useMutation({
    mutationFn: ({
      repo,
      finding,
      status,
      note
    }: {
      repo: RepoSummary;
      finding: FindingListItem;
      status: ClawpatchStatus;
      note: string;
    }) => window.clawpatch.triage.set(repo.id, finding.findingId, status, note),
    onSuccess: (result) => {
      setCommandLog((current) => [...current, { kind: "result", result }]);
      void invalidateRepo(queryClient, selectedRepo?.id ?? null);
    },
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) }
      ]);
    }
  });

  const runCommand = (request: ClawpatchCommandRequest): void => {
    if (selectedRepo === null) {
      return;
    }
    commandMutation.mutate({ repo: selectedRepo, request });
  };

  return (
    <main className="app-shell">
      <RepoSidebar
        repos={reposQuery.data ?? []}
        selectedRepoId={selectedRepo?.id ?? null}
        isAdding={addRepoMutation.isPending}
        addError={addRepoMutation.error}
        onAddRepo={(repoPath) => addRepoMutation.mutate(repoPath)}
        onSelectRepo={(repoId) => {
          setSelectedRepoId(repoId);
          setSelectedFindingId(null);
        }}
      />
      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <h1>{selectedRepo?.name ?? "Clawpatch"}</h1>
            <p>{selectedRepo?.path ?? "Add a repository with .clawpatch state to begin."}</p>
          </div>
          <div className="header-actions">
            <button disabled={selectedRepo === null || commandMutation.isPending} onClick={() => runCommand({ command: "status" })}>
              Status
            </button>
            <button disabled={selectedRepo === null || commandMutation.isPending} onClick={() => runCommand({ command: "report" })}>
              Report
            </button>
            <button disabled={selectedRepo === null || commandMutation.isPending} onClick={() => runCommand({ command: "review" })}>
              Review
            </button>
            <button disabled={selectedRepo === null || commandMutation.isPending} onClick={() => runCommand({ command: "doctor" })}>
              Doctor
            </button>
          </div>
        </header>

        {selectedRepo?.lastError ? <div className="repo-error">{selectedRepo.lastError}</div> : null}

        <div className="content-grid">
          <FindingsTable
            findings={findingsQuery.data ?? []}
            selectedFindingId={selectedFinding?.findingId ?? null}
            isLoading={findingsQuery.isLoading}
            onSelectFinding={setSelectedFindingId}
          />
          <FindingDetailPanel
            finding={detailQuery.data ?? null}
            isLoading={detailQuery.isLoading}
            isBusy={triageMutation.isPending || commandMutation.isPending}
            onTriage={(status, note) => {
              if (selectedRepo !== null && selectedFinding !== null) {
                triageMutation.mutate({ repo: selectedRepo, finding: selectedFinding, status, note });
              }
            }}
            onFix={() => {
              if (selectedFinding !== null) {
                runCommand({ command: "fix", findingId: selectedFinding.findingId });
              }
            }}
          />
        </div>

        <div className="bottom-grid">
          <CommandPanel entries={commandLog} isRunning={commandMutation.isPending || triageMutation.isPending} />
          <DiffViewer diff={diffQuery.data ?? ""} isLoading={diffQuery.isLoading} />
        </div>
      </section>
    </main>
  );
}

async function invalidateRepo(queryClient: ReturnType<typeof useQueryClient>, repoId: string | null): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["repos"] }),
    queryClient.invalidateQueries({ queryKey: ["findings", repoId] }),
    queryClient.invalidateQueries({ queryKey: ["finding"] }),
    queryClient.invalidateQueries({ queryKey: ["diff", repoId] })
  ]);
}
