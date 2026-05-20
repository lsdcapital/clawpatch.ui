import type { GitStatusSummary } from "../../../shared/types";

export function GitStatusStrip({
  status,
  onViewDiff,
}: {
  status: GitStatusSummary;
  onViewDiff: () => void;
}) {
  const dirty = status.staged + status.modified + status.untracked;
  return (
    <div className="git-status-strip" role="status">
      <span className="git-status-branch">
        {status.branch !== null ? `branch ${status.branch}` : "no branch"}
      </span>
      <span className="git-status-divider" aria-hidden="true">
        ·
      </span>
      {dirty === 0 ? (
        <span className="git-status-clean">Working tree clean</span>
      ) : (
        <span className="git-status-counts">{formatGitStatusCounts(status)}</span>
      )}
      {dirty > 0 ? (
        <button className="git-status-action" onClick={onViewDiff} type="button">
          View diff
        </button>
      ) : null}
    </div>
  );
}

function formatGitStatusCounts(status: GitStatusSummary): string {
  const parts: string[] = [];
  if (status.staged > 0) {
    parts.push(`${status.staged} staged`);
  }
  if (status.modified > 0) {
    parts.push(`${status.modified} modified`);
  }
  if (status.untracked > 0) {
    parts.push(`${status.untracked} untracked`);
  }
  return parts.join(" · ");
}
