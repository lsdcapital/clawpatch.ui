import { LoaderCircleIcon } from "lucide-react";

interface Props {
  readonly label: string;
  readonly queuedCount?: number;
}

export function TaskStrip({ label, queuedCount = 0 }: Props) {
  return (
    <div className="task-strip" role="status" aria-label="Active task" aria-live="polite">
      <LoaderCircleIcon aria-hidden="true" />
      <span>{label}</span>
      {queuedCount > 0 ? <strong>{queuedCount} queued</strong> : null}
    </div>
  );
}
