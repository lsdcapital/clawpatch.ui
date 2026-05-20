import { useState } from "react";
import {
  ActivityIcon,
  DiffIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  StethoscopeIcon,
  TerminalSquareIcon,
} from "lucide-react";
import type { ClawpatchCommandRequest, RepoSummary } from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";

export function WorkspaceHeader({
  repo,
  repoSidebarId,
  isRepoSidebarCollapsed,
  activeWorkspace,
  activeInspector,
  isRepoCommandBusy,
  onToggleRepoSidebar,
  onWorkspaceChange,
  onToggleInspector,
  onRunCommand,
}: {
  repo: RepoSummary | null;
  repoSidebarId: string;
  isRepoSidebarCollapsed: boolean;
  activeWorkspace: ActiveWorkspace;
  activeInspector: ActiveInspector;
  isRepoCommandBusy: boolean;
  onToggleRepoSidebar: () => void;
  onWorkspaceChange: (workspace: ActiveWorkspace) => void;
  onToggleInspector: (inspector: Exclude<ActiveInspector, null>) => void;
  onRunCommand: (request: ClawpatchCommandRequest) => void;
}) {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const runMenuCommand = (request: ClawpatchCommandRequest): void => {
    setIsCommandMenuOpen(false);
    onRunCommand(request);
  };

  return (
    <header className="workspace-header">
      <button
        className="icon-button sidebar-toggle"
        onClick={onToggleRepoSidebar}
        aria-controls={repoSidebarId}
        aria-expanded={!isRepoSidebarCollapsed}
        aria-label={isRepoSidebarCollapsed ? "Show repositories panel" : "Hide repositories panel"}
        title={isRepoSidebarCollapsed ? "Show repositories panel" : "Hide repositories panel"}
      >
        {isRepoSidebarCollapsed ? (
          <PanelLeftOpenIcon aria-hidden="true" />
        ) : (
          <PanelLeftCloseIcon aria-hidden="true" />
        )}
      </button>
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
        <div className="command-menu">
          <button
            className="icon-button"
            disabled={repo === null || isRepoCommandBusy}
            onClick={() => setIsCommandMenuOpen((current) => !current)}
            aria-expanded={isCommandMenuOpen}
            aria-haspopup="menu"
            aria-label="More commands"
            title="More commands"
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </button>
          {isCommandMenuOpen ? (
            <div className="command-menu-popover" role="menu" aria-label="Repository commands">
              <button
                role="menuitem"
                disabled={repo === null || isRepoCommandBusy}
                onClick={() => runMenuCommand({ command: "status" })}
              >
                <ActivityIcon aria-hidden="true" />
                Status
              </button>
              <button
                role="menuitem"
                disabled={repo === null || isRepoCommandBusy}
                onClick={() => runMenuCommand({ command: "report" })}
              >
                <FileTextIcon aria-hidden="true" />
                Report
              </button>
              <button
                role="menuitem"
                disabled={repo === null || isRepoCommandBusy}
                onClick={() => runMenuCommand({ command: "doctor" })}
              >
                <StethoscopeIcon aria-hidden="true" />
                Doctor
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
