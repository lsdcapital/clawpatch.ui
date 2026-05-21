import { ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ClawpatchStatus,
  FindingDetail,
  FindingWorkStatus,
  PatchAttempt,
  PatchCommandRun,
  PublishFixResult,
} from "../../../shared/types";
import { clawpatchStatuses } from "../../../shared/types";
import {
  findingWorkLabel,
  findingWorkTitle,
  formatGitStatusCounts,
  isGitStatusDirty,
} from "../findingWorkStatus";

interface Props {
  finding: FindingDetail | null;
  workStatus: FindingWorkStatus | null;
  isLoading: boolean;
  isBusy: boolean;
  commandStateLabel?: string;
  fixDisabledReason: string | null;
  canPublishFix: boolean;
  publishFixResult: PublishFixResult | null;
  publishFixError: Error | null;
  onTriage: (status: ClawpatchStatus, note: string) => void;
  onFix: (status: ClawpatchStatus, note: string) => void;
  onRevalidate: () => void;
  onPublishFix: () => void;
  onInterrupt?: () => void;
  onOpenDiffFile?: (filePath: string) => void;
  filesInDiff?: ReadonlySet<string>;
}

export function FindingDetailPanel({
  finding,
  workStatus,
  isLoading,
  isBusy,
  commandStateLabel,
  fixDisabledReason,
  canPublishFix,
  publishFixResult,
  publishFixError,
  onTriage,
  onFix,
  onRevalidate,
  onPublishFix,
  onInterrupt,
  onOpenDiffFile,
  filesInDiff,
}: Props) {
  const [status, setStatus] = useState<ClawpatchStatus>("open");
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [note, setNote] = useState("");
  const statusSelectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (finding !== null) {
      setStatus(finding.status);
      setIsStatusMenuOpen(false);
      setNote("");
    }
  }, [finding]);

  useEffect(() => {
    if (!isStatusMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const selectorElement = statusSelectorRef.current;
      if (selectorElement === null || !(event.target instanceof Node)) {
        return;
      }

      if (!selectorElement.contains(event.target)) {
        setIsStatusMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsStatusMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStatusMenuOpen]);

  if (finding === null) {
    return (
      <div className="detail-pane">
        <div className="empty-state">{isLoading ? "Loading finding" : "No finding selected"}</div>
      </div>
    );
  }

  const evidence = finding.evidence ?? [];
  const history = finding.history ?? [];
  const patchAttempts = finding.patchAttempts ?? [];
  const noteHistory = history.filter((entry) => entry.note !== null && entry.note.trim() !== "");
  const saveTriageNote = (): void => {
    if (!isBusy) {
      onTriage(status, note);
    }
  };
  const handleNoteKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    saveTriageNote();
  };
  const fixButtonDisabled = isBusy || finding.status === "fixed" || fixDisabledReason !== null;

  return (
    <div className="detail-pane">
      <div className="panel-header detail-header">
        <h2>{finding.title}</h2>
        <div className="detail-header-meta">
          <span>{finding.findingId}</span>
        </div>
      </div>
      <div className="detail-body">
        <div className="meta-grid">
          <span>Status</span>
          <div className="detail-status-selector" ref={statusSelectorRef}>
            <button
              aria-expanded={isStatusMenuOpen}
              aria-haspopup="menu"
              aria-label={`Finding status: ${status}`}
              className="detail-status-trigger"
              type="button"
              onClick={() => setIsStatusMenuOpen((isOpen) => !isOpen)}
            >
              <span>{status}</span>
            </button>
            {isStatusMenuOpen ? (
              <div className="detail-status-menu" role="menu" aria-label="Finding status options">
                {clawpatchStatuses.map((item) => (
                  <button
                    aria-checked={item === status}
                    className={item === status ? "active" : ""}
                    key={item}
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setStatus(item);
                      setIsStatusMenuOpen(false);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span>Severity</span>
          <strong>{finding.severity}</strong>
          <span>Confidence</span>
          <strong>{finding.confidence}</strong>
          <span>Category</span>
          <strong>{finding.category}</strong>
          <span>Triage</span>
          <strong>{finding.triage ?? "none"}</strong>
        </div>

        {workStatus !== null ? <FindingWorkSummary status={workStatus} /> : null}

        <section>
          <h3>Evidence</h3>
          {evidence.map((evidence) => (
            <div className="evidence" key={`${evidence.path}:${evidence.startLine ?? 0}`}>
              <strong>{evidence.path}</strong>
              <span>
                {evidence.startLine ?? "?"}
                {evidence.endLine !== null ? `-${evidence.endLine}` : ""}
                {evidence.symbol !== null ? ` · ${evidence.symbol}` : ""}
              </span>
              {evidence.quote !== null ? <p>{evidence.quote}</p> : null}
            </div>
          ))}
        </section>

        <TextSection title="Reasoning" value={finding.reasoning} />
        <TextSection title="Recommendation" value={finding.recommendation} />
        <TextSection title="Reproduction" value={finding.reproduction} />
        <TextSection title="Suggested Test" value={finding.suggestedRegressionTest} />

        {noteHistory.length > 0 ? (
          <section>
            <h3>History</h3>
            <div className="history-list">
              {noteHistory.map((entry) => (
                <article className="history-entry" key={historyEntryKey(entry)}>
                  <div className="history-entry-meta">
                    <strong>{entry.status ?? entry.kind}</strong>
                    <time dateTime={entry.createdAt}>{formatHistoryDate(entry.createdAt)}</time>
                  </div>
                  <p>{entry.note}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {patchAttempts.length > 0 ? (
          <PatchAttemptsSection
            patches={patchAttempts}
            onOpenDiffFile={onOpenDiffFile}
            filesInDiff={filesInDiff}
          />
        ) : null}

        <div className="triage-controls">
          <label htmlFor="triage-note">Note for triage and fix</label>
          <div className="note-input">
            <textarea
              id="triage-note"
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              onKeyDown={handleNoteKeyDown}
            />
            <button
              aria-label="Save triage note"
              className="icon-button note-send-button"
              disabled={isBusy}
              onClick={saveTriageNote}
              title="Save triage note"
              type="button"
            >
              <ArrowUpIcon aria-hidden="true" />
            </button>
          </div>
          <div className="detail-actions">
            {isBusy && commandStateLabel !== undefined ? (
              <span className="detail-command-state">{commandStateLabel} running</span>
            ) : null}
            {fixDisabledReason !== null ? (
              <span className="detail-action-reason" id="fix-disabled-reason">
                {fixDisabledReason}
              </span>
            ) : null}
            <button
              aria-describedby={fixDisabledReason !== null ? "fix-disabled-reason" : undefined}
              disabled={fixButtonDisabled}
              onClick={() => onFix(status, note)}
              title={fixDisabledReason ?? undefined}
            >
              Run fix
            </button>
            <button disabled={isBusy} onClick={onRevalidate}>
              Revalidate
            </button>
            {canPublishFix ? (
              <button disabled={isBusy} onClick={onPublishFix}>
                Publish PR
              </button>
            ) : null}
            {isBusy && onInterrupt !== undefined ? (
              <button
                aria-label="Interrupt finding command"
                className="icon-button danger"
                onClick={onInterrupt}
                title="Interrupt finding command"
                type="button"
              >
                <SquareIcon aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {publishFixError !== null ? (
            <p className="detail-action-message error">{publishFixError.message}</p>
          ) : null}
          {publishFixResult !== null ? (
            <p className="detail-action-message success">
              PR draft opened for {publishFixResult.branchName}.{" "}
              <a href={publishFixResult.prUrl} rel="noreferrer" target="_blank">
                Open PR
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FindingWorkSummary({ status }: { status: FindingWorkStatus }) {
  const gitStatus = status.gitStatus;
  const hasDirtyChanges = gitStatus !== null && isGitStatusDirty(gitStatus);
  const statusText =
    gitStatus === null
      ? (status.error ?? "Unable to read worktree status")
      : hasDirtyChanges
        ? status.prUrl === null
          ? formatGitStatusCounts(gitStatus)
          : `Local unpublished changes: ${formatGitStatusCounts(gitStatus)}`
        : "Working tree clean";

  return (
    <section className="work-summary" aria-label="Finding work status">
      <div className="work-summary-header">
        <h3>Work</h3>
        <span className="work-summary-state" title={findingWorkTitle(status)}>
          {findingWorkLabel(status)}
        </span>
      </div>
      <dl>
        {gitStatus !== null && gitStatus.branch !== null ? (
          <>
            <dt>Branch</dt>
            <dd>{gitStatus.branch}</dd>
          </>
        ) : null}
        <dt>Status</dt>
        <dd>{statusText}</dd>
        <dt>Worktree</dt>
        <dd title={status.worktreePath}>{status.worktreePath}</dd>
        {status.error !== null ? (
          <>
            <dt>Error</dt>
            <dd>{status.error}</dd>
          </>
        ) : null}
        {status.prUrl !== null ? (
          <>
            <dt>PR</dt>
            <dd>
              <a href={status.prUrl} rel="noreferrer" target="_blank">
                Open PR
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function historyEntryKey(entry: FindingDetail["history"][number]): string {
  return [
    entry.createdAt,
    entry.kind,
    entry.status ?? "",
    entry.note ?? "",
    entry.runId ?? "",
  ].join(":");
}

function TextSection({ title, value }: { title: string; value: string | null }) {
  if (value === null || value.trim() === "") {
    return null;
  }
  return (
    <section>
      <h3>{title}</h3>
      <p>{value}</p>
    </section>
  );
}

function PatchAttemptsSection({
  patches,
  onOpenDiffFile,
  filesInDiff,
}: {
  patches: readonly PatchAttempt[];
  onOpenDiffFile?: (filePath: string) => void;
  filesInDiff?: ReadonlySet<string>;
}) {
  const newestId = patches[0]?.patchAttemptId ?? null;
  return (
    <section>
      <h3>Fix attempts</h3>
      <div className="patch-list">
        {patches.map((patch) => (
          <PatchAttemptCard
            key={patch.patchAttemptId}
            patch={patch}
            defaultExpanded={patch.patchAttemptId === newestId}
            onOpenDiffFile={onOpenDiffFile}
            filesInDiff={filesInDiff}
          />
        ))}
      </div>
    </section>
  );
}

function PatchAttemptCard({
  patch,
  defaultExpanded,
  onOpenDiffFile,
  filesInDiff,
}: {
  patch: PatchAttempt;
  defaultExpanded: boolean;
  onOpenDiffFile?: (filePath: string) => void;
  filesInDiff?: ReadonlySet<string>;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const filesChanged = patch.filesChanged ?? [];
  const git = patch.git ?? { baseSha: null, commitSha: null, branchName: null, prUrl: null };
  const testSummary = summarizeRuns(patch.testResults ?? []);
  const commandSummary = summarizeRuns(patch.commandsRun ?? []);

  return (
    <article className={`patch-entry status-${patch.status}`}>
      <button
        aria-expanded={isExpanded}
        className="patch-entry-summary"
        onClick={() => setIsExpanded((value) => !value)}
        type="button"
      >
        <span className="patch-chevron" aria-hidden="true">
          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </span>
        <span className={`patch-status patch-status-${patch.status}`}>{patch.status}</span>
        <span className="patch-files-count">
          {filesChanged.length} file{filesChanged.length === 1 ? "" : "s"}
        </span>
        {testSummary !== null ? (
          <span className={`patch-tests patch-tests-${testSummary.outcome}`}>
            tests {testSummary.outcome}
          </span>
        ) : null}
        <time className="patch-entry-time" dateTime={patch.createdAt}>
          {formatHistoryDate(patch.createdAt)}
        </time>
      </button>
      {isExpanded ? (
        <div className="patch-entry-body">
          {patch.plan !== null && patch.plan.trim() !== "" ? <p>{patch.plan}</p> : null}
          {filesChanged.length > 0 ? (
            <div className="patch-files">
              <span className="patch-section-label">Files changed</span>
              <ul>
                {filesChanged.map((filePath) => {
                  const isPresentInDiff = filesInDiff === undefined || filesInDiff.has(filePath);
                  if (onOpenDiffFile === undefined) {
                    return (
                      <li key={filePath}>
                        <span className="patch-file-path">{filePath}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={filePath}>
                      <button
                        className={
                          isPresentInDiff
                            ? "patch-file-button"
                            : "patch-file-button patch-file-button-missing"
                        }
                        disabled={!isPresentInDiff}
                        onClick={() => onOpenDiffFile(filePath)}
                        title={
                          isPresentInDiff
                            ? `Open ${filePath} in diff`
                            : `${filePath} is not in the current working-tree diff`
                        }
                        type="button"
                      >
                        {filePath}
                        {isPresentInDiff ? null : (
                          <span className="patch-file-badge" aria-hidden="true">
                            not in diff
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <dl className="patch-meta">
            {git.branchName !== null ? (
              <>
                <dt>Branch</dt>
                <dd>{git.branchName}</dd>
              </>
            ) : null}
            {git.baseSha !== null ? (
              <>
                <dt>Base</dt>
                <dd className="patch-sha">{git.baseSha.slice(0, 12)}</dd>
              </>
            ) : null}
            {git.commitSha !== null ? (
              <>
                <dt>Commit</dt>
                <dd className="patch-sha">{git.commitSha.slice(0, 12)}</dd>
              </>
            ) : null}
            {testSummary !== null ? (
              <>
                <dt>Tests</dt>
                <dd>
                  {testSummary.outcome} ({testSummary.total})
                </dd>
              </>
            ) : null}
            {commandSummary !== null ? (
              <>
                <dt>Commands</dt>
                <dd>
                  {commandSummary.outcome} ({commandSummary.total})
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </article>
  );
}

function summarizeRuns(
  runs: readonly PatchCommandRun[],
): { outcome: "passed" | "failed" | "unknown"; total: number } | null {
  if (runs.length === 0) {
    return null;
  }
  const hasFailure = runs.some((run) => run.exitCode !== null && run.exitCode !== 0);
  const hasUnknown = runs.some((run) => run.exitCode === null);
  const outcome = hasFailure ? "failed" : hasUnknown ? "unknown" : "passed";
  return { outcome, total: runs.length };
}
