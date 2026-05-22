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
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import { IconButton } from "./IconButton";

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
  const sortMenuRef = useDismissiblePopover<HTMLDivElement>({
    isOpen: isSortMenuOpen,
    onDismiss: () => setIsSortMenuOpen(false),
  });
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
        <IconButton
          className="icon-button"
          containerClassName="sidebar-collapse-button"
          onClick={onCollapse}
          aria-controls={id}
          aria-expanded="true"
          icon={<PanelLeftCloseIcon aria-hidden="true" />}
          label="Hide repositories panel"
        />
      </div>
      <div className="repo-section-header">
        <span>Repositories ({repos.length})</span>
        <div className="repo-section-actions">
          <div className="repo-sort-menu" ref={sortMenuRef}>
            <IconButton
              className="icon-button"
              onClick={() => setIsSortMenuOpen((isOpen) => !isOpen)}
              aria-expanded={isSortMenuOpen}
              aria-haspopup="menu"
              icon={<ListFilterIcon aria-hidden="true" />}
              label="Sort repositories"
            />
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
          <IconButton
            className="icon-button"
            disabled={isAdding || isPicking}
            onClick={() => void pickRepo()}
            icon={<FolderPlusIcon aria-hidden="true" />}
            label="Add repository"
          />
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
            <IconButton
              className="icon-button"
              containerClassName="repo-settings-button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenRepoSettings(repo);
              }}
              icon={<SettingsIcon aria-hidden="true" />}
              label="Repository settings"
              tooltip={`Repository settings for ${repo.name}`}
            />
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
  repos,
  selectedRepoId,
  onExpand,
  onOpenSettings,
  onSelectRepo,
}: {
  id: string;
  repos: readonly RepoSummary[];
  selectedRepoId: string | null;
  onExpand: () => void;
  onOpenSettings: () => void;
  onSelectRepo: (repoId: string) => void;
}) {
  return (
    <aside className="repo-sidebar-rail" id={id} aria-label="Repositories sidebar">
      <IconButton
        className="icon-button"
        containerClassName="sidebar-collapse-button"
        onClick={onExpand}
        aria-controls={id}
        aria-expanded="false"
        icon={<PanelLeftOpenIcon aria-hidden="true" />}
        label="Show repositories panel"
      />
      <div className="repo-rail-list" aria-label="Repositories">
        {repos.map((repo) => {
          const mark = repoMark(repo);
          return (
            <button
              key={repo.id}
              className={[
                "repo-rail-item",
                `repo-rail-item-${mark.color}`,
                repo.id === selectedRepoId ? "selected" : "",
                repo.isValid ? "" : "invalid",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelectRepo(repo.id)}
              aria-label={`Select ${repo.name}`}
              title={`${repo.name} - ${repo.path} - ${repo.openFindingCount} open`}
            >
              <span className="repo-rail-mark" aria-hidden="true">
                {mark.initials}
              </span>
            </button>
          );
        })}
      </div>
      <IconButton
        className="icon-button"
        containerClassName="sidebar-rail-settings-button"
        onClick={onOpenSettings}
        icon={<SettingsIcon aria-hidden="true" />}
        label="Settings"
      />
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

const repoMarkColorCount = 8;

function repoMark(repo: RepoSummary): { readonly initials: string; readonly color: number } {
  return {
    initials: repoInitials(repo),
    color: hashRepoKey(`${repo.name}:${repo.id}`) % repoMarkColorCount,
  };
}

function repoInitials(repo: Pick<RepoSummary, "id" | "name">): string {
  const words = repo.name
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word !== "");
  const letters =
    words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : words[0]?.slice(0, 2);
  const fallback = repo.id.match(/[A-Za-z0-9]/)?.[0] ?? "?";
  return (letters === undefined || letters === "" ? fallback : letters).toUpperCase();
}

function hashRepoKey(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
