import { useState } from "react";
import { PlusIcon } from "lucide-react";
import type { RepoSummary } from "../../../shared/types";
import { appName, appVersion } from "../appInfo";

interface Props {
  id?: string;
  repos: readonly RepoSummary[];
  selectedRepoId: string | null;
  isAdding: boolean;
  addError: unknown;
  onAddRepo: (repoPath: string) => void;
  onSelectRepo: (repoId: string) => void;
}

export function RepoSidebar({
  id,
  repos,
  selectedRepoId,
  isAdding,
  addError,
  onAddRepo,
  onSelectRepo,
}: Props) {
  const [isPicking, setIsPicking] = useState(false);
  const [pickError, setPickError] = useState<unknown>(null);

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
    <aside className="repo-sidebar" id={id}>
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-name">{appName}</span>
          <span className="brand-version">v{appVersion}</span>
        </div>
      </div>
      <div className="repo-section-header">
        <span>Repositories ({repos.length})</span>
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
        {repos.map((repo) => (
          <button
            key={repo.id}
            className={repo.id === selectedRepoId ? "repo-item selected" : "repo-item"}
            onClick={() => onSelectRepo(repo.id)}
            title={repo.path}
          >
            <span className="repo-name">{repo.name}</span>
            <small className="repo-count">{repo.openFindingCount} open</small>
            <span className="repo-path">{repo.path}</span>
            {!repo.isValid ? <em className="repo-invalid">invalid</em> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
