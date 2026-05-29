// Shared filter UI primitives used by the findings table and the review-queue
// panel. Keeping these in one place avoids the two panels drifting apart (e.g.
// rendering the same status label differently).

export function FilterGroup<TValue extends string>({
  title,
  values,
  selectedValue,
  onSelect,
}: {
  title: string;
  values: readonly TValue[];
  selectedValue: TValue | null;
  onSelect: (value: TValue | null) => void;
}) {
  return (
    <div className="filter-group">
      <span>{title}</span>
      <button className={selectedValue === null ? "active" : ""} onClick={() => onSelect(null)}>
        All
      </button>
      {values.map((value) => (
        <button
          key={value}
          className={selectedValue === value ? "active" : ""}
          onClick={() => onSelect(value)}
        >
          {formatFilterLabel(value)}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-chip" onClick={onClear} aria-label={`Clear ${label} filter`}>
      <span>{label}</span>
      <span aria-hidden="true">x</span>
    </button>
  );
}

export function formatFilterLabel(value: string): string {
  if (value === "wont-fix") {
    return "Won't Fix";
  }
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
