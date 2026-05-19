import { useEffect, useState } from "react";
import type { ClawpatchStatus, FindingDetail } from "../../../shared/types";
import { clawpatchStatuses } from "../../../shared/types";

interface Props {
  finding: FindingDetail | null;
  isLoading: boolean;
  isBusy: boolean;
  onTriage: (status: ClawpatchStatus, note: string) => void;
  onFix: () => void;
  onRevalidate: () => void;
}

export function FindingDetailPanel({
  finding,
  isLoading,
  isBusy,
  onTriage,
  onFix,
  onRevalidate,
}: Props) {
  const [status, setStatus] = useState<ClawpatchStatus>("open");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (finding !== null) {
      setStatus(finding.status);
      setNote("");
    }
  }, [finding]);

  if (finding === null) {
    return (
      <div className="detail-pane">
        <div className="empty-state">{isLoading ? "Loading finding" : "No finding selected"}</div>
      </div>
    );
  }

  const noteHistory = finding.history.filter(
    (entry) => entry.note !== null && entry.note.trim() !== "",
  );

  return (
    <div className="detail-pane">
      <div className="panel-header detail-header">
        <h2>{finding.title}</h2>
        <div className="detail-header-meta">
          <span>{finding.findingId}</span>
          <select
            aria-label="Finding status"
            className="detail-status-select"
            id="triage-status"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as ClawpatchStatus)}
          >
            {clawpatchStatuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="detail-body">
        <div className="meta-grid">
          <span>Severity</span>
          <strong>{finding.severity}</strong>
          <span>Confidence</span>
          <strong>{finding.confidence}</strong>
          <span>Category</span>
          <strong>{finding.category}</strong>
          <span>Triage</span>
          <strong>{finding.triage ?? "none"}</strong>
        </div>

        <section>
          <h3>Evidence</h3>
          {finding.evidence.map((evidence) => (
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

        <div className="triage-controls">
          <label htmlFor="triage-note">Note</label>
          <textarea
            id="triage-note"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <div className="detail-actions">
            <button disabled={isBusy} onClick={() => onTriage(status, note)}>
              Save triage
            </button>
            <button disabled={isBusy || finding.status === "fixed"} onClick={onFix}>
              Run fix
            </button>
            <button disabled={isBusy} onClick={onRevalidate}>
              Revalidate
            </button>
          </div>
        </div>
      </div>
    </div>
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
