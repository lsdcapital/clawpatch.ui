import { useMemo, useState } from "react";
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type { RepoSummary } from "../../../shared/types";
import { appName, appVersion } from "../appInfo";

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
  const [repoFilter, setRepoFilter] = useState("");
  const visibleRepos = useMemo(() => filterRepos(repos, repoFilter), [repoFilter, repos]);

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
          <button
            className="icon-button"
            disabled={isAdding || isPicking}
            onClick={() => void pickRepo()}
            aria-label="Add repository"
            title="Add repository"
          >
            <PlusIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      <label className="repo-filter">
        <SearchIcon aria-hidden="true" />
        <span className="sr-only">Filter repositories</span>
        <input
          value={repoFilter}
          onChange={(event) => setRepoFilter(event.target.value)}
          placeholder="Filter repos"
        />
      </label>
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
          <div className="repo-list-empty">No repositories match this filter.</div>
        ) : null}
      </div>
      <div className="repo-sidebar-footer">
        <button
          className="sidebar-settings-button"
          onClick={onOpenSettings}
          aria-label="General settings"
          title="General settings"
        >
          <SettingsIcon aria-hidden="true" />
          <span>General settings</span>
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
      <div className="sidebar-logo-mark" aria-hidden="true">
        <span />
      </div>
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
        className="icon-button"
        onClick={onOpenSettings}
        aria-label="General settings"
        title="General settings"
      >
        <SettingsIcon aria-hidden="true" />
      </button>
    </aside>
  );
}

function filterRepos(repos: readonly RepoSummary[], query: string): readonly RepoSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return repos;
  }
  return repos.filter((repo) =>
    `${repo.name} ${repo.path}`.toLocaleLowerCase().includes(normalizedQuery),
  );
}
