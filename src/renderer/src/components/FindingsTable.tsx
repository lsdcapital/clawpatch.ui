import type { FindingListItem } from "../../../shared/types";

interface Props {
  findings: FindingListItem[];
  selectedFindingId: string | null;
  isLoading: boolean;
  onSelectFinding: (findingId: string) => void;
}

export function FindingsTable({ findings, selectedFindingId, isLoading, onSelectFinding }: Props) {
  return (
    <section className="panel findings-panel">
      <div className="panel-header">
        <h2>Findings</h2>
        <span>{isLoading ? "Loading" : `${findings.length} total`}</span>
      </div>
      <div className="findings-table" role="table">
        <div className="table-row table-head" role="row">
          <span>Severity</span>
          <span>Status</span>
          <span>Category</span>
          <span>Title</span>
        </div>
        {findings.map((finding) => (
          <button
            key={finding.findingId}
            className={finding.findingId === selectedFindingId ? "table-row selected" : "table-row"}
            onClick={() => onSelectFinding(finding.findingId)}
            role="row"
          >
            <span className={`severity ${finding.severity}`}>{finding.severity}</span>
            <span>{finding.status}</span>
            <span>{finding.category}</span>
            <strong>{finding.title}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
