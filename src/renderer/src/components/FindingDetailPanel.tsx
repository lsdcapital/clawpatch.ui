import { useEffect, useState } from "react";
import type { ClawpatchStatus, FindingDetail } from "../../../shared/types";
import { clawpatchStatuses } from "../../../shared/types";

interface Props {
  finding: FindingDetail | null;
  isLoading: boolean;
  isBusy: boolean;
  onTriage: (status: ClawpatchStatus, note: string) => void;
  onFix: () => void;
}

export function FindingDetailPanel({ finding, isLoading, isBusy, onTriage, onFix }: Props) {
  const [status, setStatus] = useState<ClawpatchStatus>("open");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (finding !== null) {
      setStatus(finding.status);
      setNote(finding.localNote ?? "");
    }
  }, [finding]);

  if (finding === null) {
    return (
      <section className="panel detail-panel">
        <div className="empty-state">{isLoading ? "Loading finding" : "No finding selected"}</div>
      </section>
    );
  }

  return (
    <section className="panel detail-panel">
      <div className="panel-header">
        <h2>{finding.title}</h2>
        <span>{finding.findingId}</span>
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

        <div className="triage-controls">
          <label htmlFor="triage-status">Status</label>
          <select
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
          <label htmlFor="triage-note">Note</label>
          <textarea id="triage-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} />
          <div className="detail-actions">
            <button disabled={isBusy} onClick={() => onTriage(status, note)}>
              Save triage
            </button>
            <button disabled={isBusy || finding.status === "fixed"} onClick={onFix}>
              Run fix
            </button>
          </div>
        </div>
      </div>
    </section>
  );
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
