import { FormEvent, useState } from "react";
import type { RepoSummary } from "../../../shared/types";

interface Props {
  repos: RepoSummary[];
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
  const [repoPath, setRepoPath] = useState("");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (repoPath.trim() !== "") {
      onAddRepo(repoPath.trim());
    }
  };

  return (
    <aside className="repo-sidebar">
      <div className="sidebar-header">
        <div className="brand">Clawpatch</div>
      </div>
      <form className="repo-form" onSubmit={submit}>
        <label htmlFor="repo-path">Repository path</label>
        <input
          id="repo-path"
          value={repoPath}
          onChange={(event) => setRepoPath(event.currentTarget.value)}
          placeholder="/path/to/repo"
        />
        <button disabled={isAdding || repoPath.trim() === ""}>Add repo</button>
        {addError ? <div className="form-error">{addError instanceof Error ? addError.message : String(addError)}</div> : null}
      </form>
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
