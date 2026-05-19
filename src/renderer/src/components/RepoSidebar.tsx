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
      <div className="brand">Clawpatch</div>
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
      <div className="repo-list">
        {repos.map((repo) => (
          <button
            key={repo.id}
            className={repo.id === selectedRepoId ? "repo-item selected" : "repo-item"}
            onClick={() => onSelectRepo(repo.id)}
          >
            <span>{repo.name}</span>
            <small>{repo.openFindingCount} open</small>
            {!repo.isValid ? <em>invalid</em> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
