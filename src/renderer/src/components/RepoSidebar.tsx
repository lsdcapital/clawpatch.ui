import { useState } from "react";
import type { RepoSummary } from "../../../shared/types";

interface Props {
  repos: readonly RepoSummary[];
  selectedRepoId: string | null;
  isAdding: boolean;
  addError: unknown;
  onAddRepo: (repoPath: string) => void;
  onSelectRepo: (repoId: string) => void;
}

export function RepoSidebar({
  repos,
  selectedRepoId,
  isAdding,
  addError,
  onAddRepo,
  onSelectRepo
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
    <aside className="repo-sidebar">
      <div className="sidebar-header">
        <div className="brand">Clawpatch</div>
      </div>
      <div className="repo-form">
        <button disabled={isAdding || isPicking} onClick={() => void pickRepo()}>
          {isPicking ? "Choosing repo" : "Add repo"}
        </button>
        {pickError ? <div className="form-error">{pickError instanceof Error ? pickError.message : String(pickError)}</div> : null}
        {addError ? <div className="form-error">{addError instanceof Error ? addError.message : String(addError)}</div> : null}
      </div>
      <div className="repo-section-header">
        <span>Repositories</span>
        <small>{repos.length}</small>
      </div>
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
