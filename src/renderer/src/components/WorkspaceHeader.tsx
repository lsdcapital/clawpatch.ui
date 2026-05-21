import { DiffIcon, LogsIcon, TerminalSquareIcon } from "lucide-react";
import type { RepoSummary } from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";
import { IconButton } from "./IconButton";

export function WorkspaceHeader({
  repo,
  activeWorkspace,
  activeInspector,
  isOpeningTerminal,
  reviewQueueUnreviewedCount,
  onWorkspaceChange,
  onToggleInspector,
  onOpenTerminal,
}: {
  repo: RepoSummary | null;
  activeWorkspace: ActiveWorkspace;
  activeInspector: ActiveInspector;
  isOpeningTerminal: boolean;
  reviewQueueUnreviewedCount: number;
  onWorkspaceChange: (workspace: ActiveWorkspace) => void;
  onToggleInspector: (inspector: Exclude<ActiveInspector, null>) => void;
  onOpenTerminal: () => void;
}) {
  const reviewQueueLabel =
    reviewQueueUnreviewedCount > 0
      ? `Review Queue, ${reviewQueueUnreviewedCount} unreviewed`
      : "Review Queue";

  return (
    <header className="workspace-header">
      <div className="workspace-title">
        <h1>{repo?.name ?? "Clawpatch"}</h1>
        <p>{repo?.path ?? "Add a repository with .clawpatch state to begin."}</p>
      </div>
      <div className="workspace-switcher" role="tablist" aria-label="Workspace">
        <button
          className={activeWorkspace === "findings" ? "active" : ""}
          onClick={() => onWorkspaceChange("findings")}
          role="tab"
          aria-selected={activeWorkspace === "findings"}
        >
          Findings
        </button>
        <button
          className={activeWorkspace === "reviewQueue" ? "active" : ""}
          onClick={() => onWorkspaceChange("reviewQueue")}
          role="tab"
          aria-selected={activeWorkspace === "reviewQueue"}
          aria-label={reviewQueueLabel}
        >
          <span>Review Queue</span>
          {reviewQueueUnreviewedCount > 0 ? (
            <span className="workspace-tab-pill" aria-hidden="true">
              {reviewQueueUnreviewedCount}
            </span>
          ) : null}
        </button>
      </div>
      <div className="header-actions">
        <IconButton
          className="icon-button"
          disabled={repo === null || isOpeningTerminal}
          icon={<TerminalSquareIcon aria-hidden="true" />}
          label="Open terminal"
          onClick={onOpenTerminal}
        />
        <IconButton
          className={
            activeInspector === "diff"
              ? "icon-button drawer-toggle active"
              : "icon-button drawer-toggle"
          }
          disabled={repo === null}
          icon={<DiffIcon aria-hidden="true" />}
          label="Toggle diff panel"
          onClick={() => onToggleInspector("diff")}
          aria-pressed={activeInspector === "diff"}
        />
        <IconButton
          className={
            activeInspector === "output"
              ? "icon-button drawer-toggle active"
              : "icon-button drawer-toggle"
          }
          icon={<LogsIcon aria-hidden="true" />}
          label="Toggle command output"
          onClick={() => onToggleInspector("output")}
          aria-pressed={activeInspector === "output"}
        />
      </div>
    </header>
  );
}
