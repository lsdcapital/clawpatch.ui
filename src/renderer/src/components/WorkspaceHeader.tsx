import { DiffIcon, TerminalSquareIcon } from "lucide-react";
import type { RepoSummary } from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";

export function WorkspaceHeader({
  repo,
  activeWorkspace,
  activeInspector,
  isOpeningTerminal,
  onWorkspaceChange,
  onToggleInspector,
  onOpenTerminal,
}: {
  repo: RepoSummary | null;
  activeWorkspace: ActiveWorkspace;
  activeInspector: ActiveInspector;
  isOpeningTerminal: boolean;
  onWorkspaceChange: (workspace: ActiveWorkspace) => void;
  onToggleInspector: (inspector: Exclude<ActiveInspector, null>) => void;
  onOpenTerminal: () => void;
}) {
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
        >
          Review Queue
        </button>
      </div>
      <div className="header-actions">
        <button
          className="icon-button"
          disabled={repo === null || isOpeningTerminal}
          onClick={onOpenTerminal}
          aria-label="Open terminal"
          title="Open terminal"
        >
          <TerminalSquareIcon aria-hidden="true" />
        </button>
        <button
          className={
            activeInspector === "diff"
              ? "icon-button drawer-toggle active"
              : "icon-button drawer-toggle"
          }
          disabled={repo === null}
          onClick={() => onToggleInspector("diff")}
          aria-pressed={activeInspector === "diff"}
          aria-label="Toggle diff panel"
          title="Toggle diff panel"
        >
          <DiffIcon aria-hidden="true" />
        </button>
        <button
          className={
            activeInspector === "output"
              ? "icon-button drawer-toggle active"
              : "icon-button drawer-toggle"
          }
          onClick={() => onToggleInspector("output")}
          aria-pressed={activeInspector === "output"}
          aria-label="Toggle command output"
          title="Toggle command output"
        >
          <TerminalSquareIcon aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
