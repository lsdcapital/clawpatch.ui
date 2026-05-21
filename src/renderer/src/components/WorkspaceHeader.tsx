import type { ButtonHTMLAttributes, ReactNode } from "react";
import { DiffIcon, LogsIcon, TerminalSquareIcon } from "lucide-react";
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
