import { useMemo, useState } from "react";
import {
  FolderPlusIcon,
  ListFilterIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
} from "lucide-react";
import type { RepoSummary } from "../../../shared/types";
import { appName, appVersion } from "../appInfo";

type RepoSort = "created" | "updated";

interface Props {
  id?: string;
  repos: readonly RepoSummary[];
  selectedRepoId: string | null;
  isAdding: boolean;
  addError: unknown;
  onAddRepo: (repoPath: string) => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onSelectRepo: (repoId: string) => void;
  onOpenRepoSettings: (repo: RepoSummary) => void;
}

export function RepoSidebar({
  id,
  repos,
  selectedRepoId,
  isAdding,
  addError,
  onAddRepo,
  onCollapse,
  onOpenSettings,
  onSelectRepo,
  onOpenRepoSettings,
}: Props) {
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState<unknown>(null);
  const [repoSort, setRepoSort] = useState<RepoSort>("created");
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const visibleRepos = useMemo(() => sortRepos(repos, repoSort), [repoSort, repos]);

  const pickRepo = async (): Promise<void> => {
    if (isAdding || isPicking) {
      return;
    }
    setPickError(null);
    setIsPicking(true);
    try {
      const repoPath = await window.clawpatch.repo.pickFolder();
      if (repoPath !== null) {
        onAddRepo(repoPath);
      }
    } catch (error) {
      setPickError(error);
    } finally {
      setIsPicking(false);
    }
  };

  const selectRepoSort = (sort: RepoSort): void => {
    setRepoSort(sort);
    setIsSortMenuOpen(false);
  };

  return (
    <aside className="repo-sidebar" id={id} aria-label="Repositories">
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-name">{appName}</span>
          <span className="brand-version">v{appVersion}</span>
        </div>
        <button
          className="icon-button sidebar-collapse-button"
          onClick={onCollapse}
          aria-controls={id}
          aria-expanded="true"
          aria-label="Hide repositories panel"
          title="Hide repositories panel"
        >
          <PanelLeftCloseIcon aria-hidden="true" />
        </button>
      </div>
      <div className="repo-section-header">
        <span>Repositories ({repos.length})</span>
        <div className="repo-section-actions">
          <div className="repo-sort-menu">
            <button
              className="icon-button"
              onClick={() => setIsSortMenuOpen((isOpen) => !isOpen)}
              aria-expanded={isSortMenuOpen}
              aria-haspopup="menu"
              aria-label="Sort repositories"
              title="Sort repositories"
            >
              <ListFilterIcon aria-hidden="true" />
            </button>
            {isSortMenuOpen ? (
              <div className="repo-sort-menu-popover" role="menu" aria-label="Repository sort">
                <button
                  className={repoSort === "created" ? "active" : ""}
                  role="menuitem"
                  onClick={() => selectRepoSort("created")}
                >
                  Created
                </button>
                <button
                  className={repoSort === "updated" ? "active" : ""}
                  role="menuitem"
                  onClick={() => selectRepoSort("updated")}
                >
                  Updated
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="icon-button"
            disabled={isAdding || isPicking}
            onClick={() => void pickRepo()}
            aria-label="Add repository"
            title="Add repository"
          >
            <FolderPlusIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      {pickError || addError ? (
        <div className="repo-form">
          {pickError ? (
            <div className="form-error">
              {pickError instanceof Error ? pickError.message : String(pickError)}
            </div>
          ) : null}
          {addError ? (
            <div className="form-error">
              {addError instanceof Error ? addError.message : String(addError)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="repo-list">
        {visibleRepos.map((repo) => (
          <div
            key={repo.id}
            className={repo.id === selectedRepoId ? "repo-row selected" : "repo-row"}
          >
            <button className="repo-item" onClick={() => onSelectRepo(repo.id)} title={repo.path}>
              <span className="repo-name">{repo.name}</span>
              <small className="repo-count">{repo.openFindingCount} open</small>
              <span className="repo-path">{repo.path}</span>
              {!repo.isValid ? <em className="repo-invalid">invalid</em> : null}
            </button>
            <button
              className="icon-button repo-settings-button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenRepoSettings(repo);
              }}
              aria-label="Repository settings"
              title={`Repository settings for ${repo.name}`}
            >
              <SettingsIcon aria-hidden="true" />
            </button>
          </div>
        ))}
        {visibleRepos.length === 0 ? (
          <div className="repo-list-empty">No repositories added.</div>
        ) : null}
      </div>
      <div className="repo-sidebar-footer">
        <button
          className="sidebar-settings-button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

export function RepoSidebarRail({
  id,
  onExpand,
  onOpenSettings,
}: {
  id: string;
  onExpand: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="repo-sidebar-rail" id={id} aria-label="Repositories sidebar">
      <button
        className="icon-button sidebar-collapse-button"
        onClick={onExpand}
        aria-controls={id}
        aria-expanded="false"
        aria-label="Show repositories panel"
        title="Show repositories panel"
      >
        <PanelLeftOpenIcon aria-hidden="true" />
      </button>
      <button
        className="icon-button sidebar-rail-settings-button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <SettingsIcon aria-hidden="true" />
      </button>
    </aside>
  );
}

function sortRepos(repos: readonly RepoSummary[], sort: RepoSort): readonly RepoSummary[] {
  if (sort === "created") {
    return repos;
  }
  return repos
    .map((repo, index) => ({ index, repo }))
    .toSorted((left, right) => {
      const timestampDelta = timestamp(right.repo.updatedAt) - timestamp(left.repo.updatedAt);
      return timestampDelta === 0 ? left.index - right.index : timestampDelta;
    })
    .map(({ repo }) => repo);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
