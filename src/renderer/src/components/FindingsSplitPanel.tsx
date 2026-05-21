import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type {
  ClawpatchStatus,
  FindingDetail,
  FindingListItem,
  FindingWorkStatus,
  PublishFixResult,
} from "../../../shared/types";
import type { FindingFilterOptions, FindingFilters, FindingSort } from "../findingsFilters";
import { FindingDetailPanel } from "./FindingDetailPanel";
import { FindingsTable } from "./FindingsTable";

const FINDINGS_SPLIT_WIDTH_STORAGE_KEY = "clawpatch.findingsSplitWidth.v1";
const MIN_LIST_WIDTH = 14;
const MAX_LIST_WIDTH = 62;
const DEFAULT_LIST_WIDTH = 42;
const KEYBOARD_STEP = 2;

interface Props {
  findings: readonly FindingListItem[];
  totalFindingCount: number;
  selectedFindingId: string | null;
  isFindingsLoading: boolean;
  filters: FindingFilters;
  filterOptions: FindingFilterOptions;
  sort: FindingSort;
  workStatusByFindingId: ReadonlyMap<string, FindingWorkStatus>;
  finding: FindingDetail | null;
  isDetailLoading: boolean;
  isBusy: boolean;
  commandStateLabel?: string;
  fixDisabledReason: string | null;
  canPublishFix: boolean;
  publishFixResult: PublishFixResult | null;
  publishFixError: Error | null;
  onFiltersChange: (filters: FindingFilters) => void;
  onSortChange: (sort: FindingSort) => void;
  onSelectFinding: (findingId: string) => void;
  onTriage: (status: ClawpatchStatus, note: string) => void;
  onFix: (status: ClawpatchStatus, note: string) => void;
  onRevalidate: () => void;
  onPublishFix: () => void;
  onInterrupt?: () => void;
  onOpenDiffFile?: (filePath: string) => void;
  filesInDiff?: ReadonlySet<string>;
}

export function FindingsSplitPanel({
  findings,
  totalFindingCount,
  selectedFindingId,
  isFindingsLoading,
  filters,
  filterOptions,
  sort,
  workStatusByFindingId,
  finding,
  isDetailLoading,
  isBusy,
  commandStateLabel,
  fixDisabledReason,
  canPublishFix,
  publishFixResult,
  publishFixError,
  onFiltersChange,
  onSortChange,
  onSelectFinding,
  onTriage,
  onFix,
  onRevalidate,
  onPublishFix,
  onInterrupt,
  onOpenDiffFile,
  filesInDiff,
}: Props) {
  const [listWidth, setListWidth] = useState(readStoredListWidth);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const setClampedListWidth = (nextWidth: number): void => {
    const clampedWidth = clampListWidth(nextWidth);
    setListWidth(clampedWidth);
    persistListWidth(clampedWidth);
  };

  const updateListWidthFromPointer = (clientX: number): void => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    setClampedListWidth(((clientX - rect.left) / rect.width) * 100);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    updateListWidthFromPointer(event.clientX);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isResizing) {
      return;
    }
    updateListWidthFromPointer(event.clientX);
  };

  const stopResizing = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
  };

  const handleSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft") {
      setClampedListWidth(listWidth - KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      setClampedListWidth(listWidth + KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "Home") {
      setClampedListWidth(MIN_LIST_WIDTH);
      event.preventDefault();
    } else if (event.key === "End") {
      setClampedListWidth(MAX_LIST_WIDTH);
      event.preventDefault();
    }
  };

  return (
    <section
      className={isResizing ? "panel findings-workspace resizing" : "panel findings-workspace"}
      ref={panelRef}
      style={{ "--findings-list-width": `${listWidth}%` } as CSSProperties}
    >
      <FindingsTable
        findings={findings}
        totalFindingCount={totalFindingCount}
        selectedFindingId={selectedFindingId}
        isLoading={isFindingsLoading}
        filters={filters}
        filterOptions={filterOptions}
        sort={sort}
        workStatusByFindingId={workStatusByFindingId}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onSelectFinding={onSelectFinding}
      />
      <div
        aria-label="Resize findings and detail panes"
        aria-orientation="vertical"
        aria-valuemax={MAX_LIST_WIDTH}
        aria-valuemin={MIN_LIST_WIDTH}
        aria-valuenow={Math.round(listWidth)}
        className="findings-resize-handle"
        onKeyDown={handleSeparatorKeyDown}
        onPointerCancel={stopResizing}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopResizing}
        role="separator"
        tabIndex={0}
      />
      <FindingDetailPanel
        finding={finding}
        workStatus={
          finding === null ? null : (workStatusByFindingId.get(finding.findingId) ?? null)
        }
        isLoading={isDetailLoading}
        isBusy={isBusy}
        commandStateLabel={commandStateLabel}
        fixDisabledReason={fixDisabledReason}
        canPublishFix={canPublishFix}
        publishFixResult={publishFixResult}
        publishFixError={publishFixError}
        onTriage={onTriage}
        onFix={onFix}
        onRevalidate={onRevalidate}
        onPublishFix={onPublishFix}
        onInterrupt={onInterrupt}
        onOpenDiffFile={onOpenDiffFile}
        filesInDiff={filesInDiff}
      />
    </section>
  );
}

function clampListWidth(nextWidth: number): number {
  return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, nextWidth));
}

function readStoredListWidth(): number {
  let storedWidth: string | null;
  try {
    storedWidth = window.localStorage.getItem(FINDINGS_SPLIT_WIDTH_STORAGE_KEY);
  } catch {
    return DEFAULT_LIST_WIDTH;
  }

  if (storedWidth === null) {
    return DEFAULT_LIST_WIDTH;
  }

  const parsedWidth = Number(storedWidth);
  if (!Number.isFinite(parsedWidth)) {
    return DEFAULT_LIST_WIDTH;
  }

  return clampListWidth(parsedWidth);
}

function persistListWidth(width: number): void {
  try {
    window.localStorage.setItem(FINDINGS_SPLIT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Resizing should keep working even if local storage is unavailable.
  }
}
