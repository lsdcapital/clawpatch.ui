import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIcon,
  DiffIcon,
  LogsIcon,
  MoreHorizontalIcon,
  TerminalSquareIcon,
} from "lucide-react";
import type { ClawpatchCommandRequest, RepoSummary } from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";

export function WorkspaceHeader({
  repo,
  activeWorkspace,
  activeInspector,
  isRepoCommandBusy,
  isOpeningTerminal,
  onWorkspaceChange,
  onToggleInspector,
  onOpenTerminal,
  onRunCommand,
}: {
  repo: RepoSummary | null;
  activeWorkspace: ActiveWorkspace;
  activeInspector: ActiveInspector;
  isRepoCommandBusy: boolean;
  isOpeningTerminal: boolean;
  onWorkspaceChange: (workspace: ActiveWorkspace) => void;
  onToggleInspector: (inspector: Exclude<ActiveInspector, null>) => void;
  onOpenTerminal: () => void;
  onRunCommand: (request: ClawpatchCommandRequest) => void;
}) {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const runMenuCommand = (request: ClawpatchCommandRequest): void => {
    setIsCommandMenuOpen(false);
    onRunCommand(request);
  };

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
        <HeaderIconButton
          className="icon-button"
          disabled={repo === null || isOpeningTerminal}
          icon={<TerminalSquareIcon aria-hidden="true" />}
          label="Open terminal"
          onClick={onOpenTerminal}
        />
        <HeaderIconButton
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
        <HeaderIconButton
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
        <div className="command-menu">
          <HeaderIconButton
            className="icon-button"
            disabled={repo === null || isRepoCommandBusy}
            icon={<MoreHorizontalIcon aria-hidden="true" />}
            label="More commands"
            onClick={() => setIsCommandMenuOpen((current) => !current)}
            aria-expanded={isCommandMenuOpen}
            aria-haspopup="menu"
            tooltipHidden={isCommandMenuOpen}
          />
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
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

interface HeaderIconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "title"
> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly tooltipHidden?: boolean;
}

function HeaderIconButton({
  icon,
  label,
  tooltipHidden = false,
  type = "button",
  ...props
}: HeaderIconButtonProps) {
  return (
    <span
      className="header-tooltip-trigger"
      data-tooltip-hidden={tooltipHidden ? "true" : undefined}
    >
      <button {...props} aria-label={label} type={type}>
        {icon}
      </button>
      <span className="header-icon-tooltip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
