import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  ListChecksIcon,
  MapIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { FeatureMapItem, FeatureMapSnapshot } from "../../../shared/types";
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import type { ReviewCompletionSummary } from "../hooks/useCommandRunner";
import {
  defaultReviewQueueFilters,
  filterReviewQueue,
  getReviewQueueFilterOptions,
  isActionableReviewItem,
  isNoActionReviewItem,
  isReviewQueueFiltersActive,
  type ReviewQueueFilters,
  type ReviewQueueStatusFilter,
} from "../reviewQueueFilters";
import { ActionIconButton } from "./ActionIconButton";
import { TooltipTrigger } from "./TooltipTrigger";

interface Props {
  snapshot: FeatureMapSnapshot | null;
  isLoading: boolean;
  isBusy: boolean;
  runningReviewFeatureId: string | null;
  queuedReviewFeatureIds: readonly string[];
  lastReviewCompletion: ReviewCompletionSummary | null;
  onReviewFeature: (featureId: string, options: ReviewRunOptions) => void;
  onUpdateMap: () => void;
}

export interface ReviewRunOptions {
  readonly limit?: number;
  readonly since?: string;
  readonly includeDirty?: boolean;
  readonly promptText?: string;
}

export function ReviewMapPanel({
  snapshot,
  isLoading,
  isBusy,
  runningReviewFeatureId,
  queuedReviewFeatureIds,
  lastReviewCompletion,
  onReviewFeature,
  onUpdateMap,
}: Props) {
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [filters, setFilters] = useState(defaultReviewQueueFilters);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [reviewLimit, setReviewLimit] = useState("");
  const [reviewSince, setReviewSince] = useState("");
  const [includeDirty, setIncludeDirty] = useState(false);
  const [reviewGuidance, setReviewGuidance] = useState("");
  const filterMenuRef = useDismissiblePopover<HTMLDetailsElement>({
    isOpen: isFilterMenuOpen,
    onDismiss: () => setIsFilterMenuOpen(false),
  });
  const features = useMemo(() => snapshot?.features ?? [], [snapshot]);
  const reviewActivityFeatureIds = useMemo(
    () => reviewActivityIds(runningReviewFeatureId, queuedReviewFeatureIds, lastReviewCompletion),
    [lastReviewCompletion, queuedReviewFeatureIds, runningReviewFeatureId],
  );
  const filteredFeatures = useMemo(
    () => reviewQueueVisibleFeatures(features, filters, reviewActivityFeatureIds),
    [features, filters, reviewActivityFeatureIds],
  );
  const filterOptions = useMemo(() => getReviewQueueFilterOptions(features), [features]);
  const queuedReviewFeatureIdSet = useMemo(
    () => new Set(queuedReviewFeatureIds),
    [queuedReviewFeatureIds],
  );
  const filtersActive = isReviewQueueFiltersActive(filters);
  const pendingCount = snapshot?.coverage.pendingReviewCount ?? 0;
  const pendingReviewFeatureIds = snapshot?.coverage.pendingReviewFeatureIds ?? [];
  const totalCount = snapshot?.coverage.totalFeatures ?? 0;
  const actionableCount = useMemo(() => features.filter(isActionableReviewItem).length, [features]);
  const noActionCount = useMemo(() => features.filter(isNoActionReviewItem).length, [features]);
  const parsedReviewLimit = parsePositiveInteger(reviewLimit);
  const hasInvalidReviewLimit = reviewLimit.trim() !== "" && parsedReviewLimit === null;
  const effectiveReviewLimit = parsedReviewLimit ?? pendingReviewFeatureIds.length;
  const bulkReviewFeatureIds = pendingReviewFeatureIds.slice(0, effectiveReviewLimit);
  const statusLabel = isLoading
    ? "Loading"
    : `${actionableCount} actionable of ${totalCount} map items`;
  const filteredCountLabel = isLoading
    ? "Loading"
    : `${filteredFeatures.length} of ${totalCount} shown`;

  const updateFilters = (nextFilters: Partial<ReviewQueueFilters>): void => {
    setFilters((current) => ({ ...current, ...nextFilters }));
  };
  const toggleExpanded = (featureId: string): void => {
    setExpandedFeatureIds((current) => {
      const next = new Set(current);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  };
  const reviewOptions = (fallbackLimit?: number): ReviewRunOptions => ({
    ...(fallbackLimit !== undefined && fallbackLimit > 0 ? { limit: fallbackLimit } : {}),
    ...(reviewSince.trim() !== "" ? { since: reviewSince.trim() } : {}),
    ...(includeDirty ? { includeDirty: true } : {}),
    ...(reviewGuidance.trim() !== "" ? { promptText: reviewGuidance.trim() } : {}),
  });
  const reviewPendingFeatures = (): void => {
    const options = reviewOptions();
    for (const featureId of bulkReviewFeatureIds) {
      onReviewFeature(featureId, options);
    }
  };

  return (
    <section className="panel review-queue-panel">
      <div className="panel-header">
        <h2>Review Queue</h2>
        <span>{statusLabel}</span>
      </div>
      <div className="review-queue-toolbar">
        <div className="action-toolbar review-queue-actions" aria-label="Review queue actions">
          <ActionIconButton
            disabled={isBusy}
            icon={<MapIcon aria-hidden="true" />}
            label="Update map"
            onClick={onUpdateMap}
          />
          <ActionIconButton
            disabled={isBusy || bulkReviewFeatureIds.length === 0 || hasInvalidReviewLimit}
            icon={<ListChecksIcon aria-hidden="true" />}
            label={`Review all ${pendingCount} mapped features pending review`}
            onClick={reviewPendingFeatures}
            title="Review all"
          />
        </div>
        <div className="review-scope-panel" aria-label="Review scope">
          <label>
            Limit
            <input
              aria-invalid={hasInvalidReviewLimit}
              aria-label="Review limit"
              inputMode="numeric"
              min={1}
              placeholder={String(pendingCount)}
              type="number"
              value={reviewLimit}
              onChange={(event) => setReviewLimit(event.currentTarget.value)}
            />
          </label>
          <label>
            Since
            <input
              aria-label="Review since ref"
              placeholder="origin/main"
              value={reviewSince}
              onChange={(event) => setReviewSince(event.currentTarget.value)}
            />
          </label>
          <label className="review-scope-checkbox">
            <input
              checked={includeDirty}
              type="checkbox"
              onChange={(event) => setIncludeDirty(event.currentTarget.checked)}
            />
            Include dirty changes
          </label>
          <label className="review-guidance-field">
            Guidance
            <textarea
              aria-label="Review guidance"
              placeholder="Extra reviewer guidance..."
              rows={2}
              value={reviewGuidance}
              onChange={(event) => setReviewGuidance(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="findings-filter-row review-queue-filter-row">
          <ReviewQueueModeTabs
            actionableCount={actionableCount}
            noActionCount={noActionCount}
            selectedValue={filters.status}
            totalCount={totalCount}
            onSelect={(status) => updateFilters({ status })}
          />
          <input
            aria-label="Search review queue"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.currentTarget.value })}
            placeholder="Search review queue..."
          />
          <details className="filter-menu" open={isFilterMenuOpen} ref={filterMenuRef}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setIsFilterMenuOpen((isOpen) => !isOpen);
              }}
            >
              Filter
            </summary>
            <div className="filter-popover">
              <StatusFilterGroup
                values={filterOptions.statuses}
                selectedValue={filters.status}
                onSelect={(status) => updateFilters({ status })}
              />
              <FilterGroup
                title="Kind"
                values={filterOptions.kinds}
                selectedValue={filters.kind}
                onSelect={(kind) => updateFilters({ kind })}
              />
              <FilterGroup
                title="Source"
                values={filterOptions.sources}
                selectedValue={filters.source}
                onSelect={(source) => updateFilters({ source })}
              />
            </div>
          </details>
          <button disabled={!filtersActive} onClick={() => setFilters(defaultReviewQueueFilters)}>
            Clear
          </button>
        </div>
        {filtersActive ? (
          <div className="review-queue-summary-row">
            <span>{filteredCountLabel}</span>
            <div className="filter-chips" aria-label="Active review queue filters">
              {filters.search.trim() !== "" ? (
                <FilterChip
                  label={`Search: ${filters.search.trim()}`}
                  onClear={() => updateFilters({ search: "" })}
                />
              ) : null}
              {filters.status !== defaultReviewQueueFilters.status ? (
                <FilterChip
                  label={statusLabelFor(filters.status)}
                  onClear={() => updateFilters({ status: defaultReviewQueueFilters.status })}
                />
              ) : null}
              {filters.kind !== null ? (
                <FilterChip
                  label={labelFor(filters.kind)}
                  onClear={() => updateFilters({ kind: null })}
                />
              ) : null}
              {filters.source !== null ? (
                <FilterChip
                  label={labelFor(filters.source)}
                  onClear={() => updateFilters({ source: null })}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {snapshot === null ? (
        <div className="empty-state">
          {isLoading ? "Loading map coverage." : "No map coverage loaded."}
        </div>
      ) : (
        <ReviewMapTable
          features={filteredFeatures}
          expandedFeatureIds={expandedFeatureIds}
          hasActiveFilters={filtersActive}
          queuedReviewFeatureIds={queuedReviewFeatureIdSet}
          runningReviewFeatureId={runningReviewFeatureId}
          lastReviewCompletion={lastReviewCompletion}
          reviewOptions={reviewOptions()}
          onReviewFeature={onReviewFeature}
          onToggleExpanded={toggleExpanded}
        />
      )}
    </section>
  );
}

function findingCountLabel(count: number): string {
  return `${count} ${plural("finding", count)}`;
}

function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function ReviewMapTable({
  features,
  expandedFeatureIds,
  hasActiveFilters,
  queuedReviewFeatureIds,
  runningReviewFeatureId,
  lastReviewCompletion,
  onReviewFeature,
  onToggleExpanded,
  reviewOptions,
}: {
  features: FeatureMapSnapshot["features"];
  expandedFeatureIds: ReadonlySet<string>;
  hasActiveFilters: boolean;
  queuedReviewFeatureIds: ReadonlySet<string>;
  runningReviewFeatureId: string | null;
  lastReviewCompletion: ReviewCompletionSummary | null;
  reviewOptions: ReviewRunOptions;
  onReviewFeature: (featureId: string, options: ReviewRunOptions) => void;
  onToggleExpanded: (featureId: string) => void;
}) {
  const reviewedFeatureId =
    lastReviewCompletion?.kind === "feature" ? lastReviewCompletion.featureId : null;
  return (
    <div className="feature-map-table" role="table" aria-label="Review queue map">
      <div className="feature-map-row feature-map-head" role="row">
        <span>More</span>
        <span>Status</span>
        <span>Kind</span>
        <span>Source</span>
        <span>Files</span>
        <span>Findings</span>
        <span>Title</span>
        <span>Updated</span>
        <span>Action</span>
      </div>
      {features.length === 0 ? (
        <div className="feature-map-empty">{reviewQueueEmptyLabel(hasActiveFilters)}</div>
      ) : (
        features.map((feature) => {
          const isExpanded = expandedFeatureIds.has(feature.featureId);
          const reviewState =
            runningReviewFeatureId === feature.featureId
              ? "running"
              : queuedReviewFeatureIds.has(feature.featureId)
                ? "queued"
                : reviewedFeatureId === feature.featureId
                  ? "reviewed"
                  : "idle";
          const reviewedFindingCount =
            reviewState === "reviewed" && lastReviewCompletion?.kind === "feature"
              ? (lastReviewCompletion.findingCount ?? feature.findingCount)
              : null;
          return (
            <Fragment key={feature.featureId}>
              <div className={reviewRowClassName(reviewState)} role="row">
                <ActionIconButton
                  aria-expanded={isExpanded}
                  className="feature-map-expand-button"
                  icon={
                    isExpanded ? (
                      <ChevronDownIcon aria-hidden="true" />
                    ) : (
                      <ChevronRightIcon aria-hidden="true" />
                    )
                  }
                  label={`${isExpanded ? "Collapse" : "Expand"} ${feature.title}`}
                  onClick={() => onToggleExpanded(feature.featureId)}
                  title={`${isExpanded ? "Collapse" : "Expand"} details`}
                />
                <ReviewStatusCell feature={feature} reviewState={reviewState} />
                <span>{feature.kind}</span>
                <span>{feature.source}</span>
                <span>{feature.ownedFileCount + feature.contextFileCount + feature.testCount}</span>
                <span>{feature.findingCount}</span>
                <TooltipTrigger className="feature-title-tooltip" tooltip={feature.featureId}>
                  {({ describedBy }) => (
                    <strong aria-describedby={describedBy} tabIndex={0}>
                      {feature.title}
                    </strong>
                  )}
                </TooltipTrigger>
                <span>{formatUpdatedAt(feature.updatedAt)}</span>
                <ReviewRowAction
                  feature={feature}
                  reviewedFindingCount={reviewedFindingCount}
                  reviewState={reviewState}
                  reviewOptions={reviewOptions}
                  onReviewFeature={onReviewFeature}
                />
              </div>
              {isExpanded ? <FeatureMapDetail feature={feature} /> : null}
            </Fragment>
          );
        })
      )}
    </div>
  );
}

function reviewQueueEmptyLabel(hasActiveFilters: boolean): string {
  return hasActiveFilters ? "No map items match these filters." : "No actionable map items.";
}

function reviewActivityIds(
  runningReviewFeatureId: string | null,
  queuedReviewFeatureIds: readonly string[],
  lastReviewCompletion: ReviewCompletionSummary | null,
): ReadonlySet<string> {
  const ids = new Set(queuedReviewFeatureIds);
  if (runningReviewFeatureId !== null) {
    ids.add(runningReviewFeatureId);
  }
  if (lastReviewCompletion?.kind === "feature") {
    ids.add(lastReviewCompletion.featureId);
  }
  return ids;
}

function reviewQueueVisibleFeatures(
  features: readonly FeatureMapItem[],
  filters: ReviewQueueFilters,
  reviewActivityFeatureIds: ReadonlySet<string>,
): FeatureMapItem[] {
  const filteredFeatures = filterReviewQueue(features, filters);
  if (reviewActivityFeatureIds.size === 0) {
    return filteredFeatures;
  }

  const visibleFeatureIds = new Set(filteredFeatures.map((feature) => feature.featureId));
  const passiveFilters = { ...filters, status: null };
  for (const feature of features) {
    if (
      reviewActivityFeatureIds.has(feature.featureId) &&
      filterReviewQueue([feature], passiveFilters).length > 0
    ) {
      visibleFeatureIds.add(feature.featureId);
    }
  }

  return features.filter((feature) => visibleFeatureIds.has(feature.featureId));
}

function ReviewQueueModeTabs({
  actionableCount,
  noActionCount,
  selectedValue,
  totalCount,
  onSelect,
}: {
  actionableCount: number;
  noActionCount: number;
  selectedValue: ReviewQueueStatusFilter;
  totalCount: number;
  onSelect: (value: ReviewQueueStatusFilter) => void;
}) {
  return (
    <div className="review-queue-mode-tabs" aria-label="Review queue visibility">
      <button
        className={selectedValue === "actionable" ? "active" : ""}
        onClick={() => onSelect("actionable")}
        type="button"
      >
        Actionable <span>{actionableCount}</span>
      </button>
      <button
        className={selectedValue === "no-action" ? "active" : ""}
        onClick={() => onSelect("no-action")}
        type="button"
      >
        No action <span>{noActionCount}</span>
      </button>
      <button
        className={selectedValue === null ? "active" : ""}
        onClick={() => onSelect(null)}
        type="button"
      >
        All <span>{totalCount}</span>
      </button>
    </div>
  );
}

type ReviewRowState = "idle" | "queued" | "running" | "reviewed";

function ReviewStatusCell({
  feature,
  reviewState,
}: {
  feature: FeatureMapItem;
  reviewState: ReviewRowState;
}) {
  if (reviewState === "reviewed") {
    return <span className="feature-status reviewed">reviewed</span>;
  }
  return <span className={`feature-status ${feature.status}`}>{feature.status}</span>;
}

function reviewRowClassName(reviewState: ReviewRowState): string {
  return reviewState === "reviewed" ? "feature-map-row review-row-reviewed" : "feature-map-row";
}

function ReviewRowAction({
  feature,
  reviewedFindingCount,
  reviewState,
  reviewOptions,
  onReviewFeature,
}: {
  feature: FeatureMapItem;
  reviewedFindingCount: number | null;
  reviewState: ReviewRowState;
  reviewOptions: ReviewRunOptions;
  onReviewFeature: (featureId: string, options: ReviewRunOptions) => void;
}) {
  if (reviewState === "idle") {
    return (
      <div className="review-action-cell">
        <ActionIconButton
          icon={<ClipboardCheckIcon aria-hidden="true" />}
          label={`Review ${feature.title}`}
          onClick={() => onReviewFeature(feature.featureId, reviewOptions)}
          title={`Review ${feature.title}`}
        />
      </div>
    );
  }

  if (reviewState === "reviewed") {
    return (
      <div className="review-action-cell">
        <ActionIconButton
          disabled
          icon={<ClipboardCheckIcon aria-hidden="true" />}
          label="Reviewed"
          title="Reviewed"
        />
        <span className="review-action-state review-action-state-reviewed">
          {reviewedFindingCount === null ? "Reviewed" : findingCountLabel(reviewedFindingCount)}
        </span>
      </div>
    );
  }

  if (reviewState === "queued") {
    const label = `Review queued for ${feature.title}`;
    return (
      <div className="review-action-cell">
        <ActionIconButton
          className="review-action-queued-button"
          disabled
          icon={<ClockIcon aria-hidden="true" />}
          label={label}
          tooltipHidden
        />
      </div>
    );
  }

  const label = `Review running for ${feature.title}`;
  return (
    <div className="review-action-cell">
      <ActionIconButton
        className="review-action-spinner-button"
        disabled
        icon={<LoaderCircleIcon aria-hidden="true" className="review-action-spinner" />}
        label={label}
        tooltipHidden
      />
    </div>
  );
}

function FeatureMapDetail({ feature }: { feature: FeatureMapItem }) {
  const hasDetail =
    feature.summary !== null ||
    feature.entrypoints.length > 0 ||
    feature.ownedFiles.length > 0 ||
    feature.contextFiles.length > 0 ||
    feature.tests.length > 0 ||
    feature.linkedFindings.length > 0;

  return (
    <div className="feature-map-detail" role="row">
      {hasDetail ? (
        <div className="feature-map-detail-grid">
          {feature.summary !== null ? (
            <section className="feature-map-detail-section feature-map-detail-summary">
              <h3>Summary</h3>
              <p>{feature.summary}</p>
            </section>
          ) : null}
          <EntrypointSection entrypoints={feature.entrypoints} />
          <FileSection title="Owned Files" files={feature.ownedFiles} />
          <FileSection title="Context Files" files={feature.contextFiles} />
          <FileSection title="Tests" files={feature.tests} />
          <FindingSection findings={feature.linkedFindings} />
        </div>
      ) : (
        <div className="feature-map-detail-empty">No additional detail recorded.</div>
      )}
    </div>
  );
}

function EntrypointSection({ entrypoints }: { entrypoints: FeatureMapItem["entrypoints"] }) {
  if (entrypoints.length === 0) {
    return null;
  }

  return (
    <section className="feature-map-detail-section">
      <h3>Entrypoints</h3>
      <ul>
        {entrypoints.slice(0, 6).map((entrypoint) => (
          <li key={entrypointLabel(entrypoint)}>
            <span>{entrypoint.path}</span>
            {entrypointMetadata(entrypoint) !== null ? (
              <small>{entrypointMetadata(entrypoint)}</small>
            ) : null}
          </li>
        ))}
      </ul>
      <OverflowCount count={entrypoints.length - 6} />
    </section>
  );
}

function FileSection({ title, files }: { title: string; files: FeatureMapItem["ownedFiles"] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <section className="feature-map-detail-section">
      <h3>{title}</h3>
      <ul>
        {files.slice(0, 6).map((file) => (
          <li key={file.path}>
            <span>{file.path}</span>
            {file.reason !== null ? <small>{file.reason}</small> : null}
          </li>
        ))}
      </ul>
      <OverflowCount count={files.length - 6} />
    </section>
  );
}

function FindingSection({ findings }: { findings: FeatureMapItem["linkedFindings"] }) {
  if (findings.length === 0) {
    return null;
  }

  return (
    <section className="feature-map-detail-section">
      <h3>Linked Findings</h3>
      <ul>
        {findings.slice(0, 6).map((finding) => (
          <li key={finding.findingId}>
            <span>{finding.title}</span>
            <small>
              {finding.status} / {finding.severity} / {finding.confidence}
            </small>
          </li>
        ))}
      </ul>
      <OverflowCount count={findings.length - 6} />
    </section>
  );
}

function OverflowCount({ count }: { count: number }) {
  return count > 0 ? <p className="feature-map-detail-overflow">+{count} more</p> : null;
}

function entrypointLabel(entrypoint: FeatureMapItem["entrypoints"][number]): string {
  return [
    entrypoint.path,
    entrypoint.symbol ?? "",
    entrypoint.route ?? "",
    entrypoint.command ?? "",
  ].join(":");
}

function entrypointMetadata(entrypoint: FeatureMapItem["entrypoints"][number]): string | null {
  const metadata = [entrypoint.symbol, entrypoint.route, entrypoint.command].filter(
    (value): value is string => value !== null,
  );
  return metadata.length > 0 ? metadata.join(" / ") : null;
}

function StatusFilterGroup({
  values,
  selectedValue,
  onSelect,
}: {
  values: readonly string[];
  selectedValue: ReviewQueueStatusFilter;
  onSelect: (value: ReviewQueueStatusFilter) => void;
}) {
  return (
    <div className="filter-group">
      <span>Status</span>
      <button
        className={selectedValue === "actionable" ? "active" : ""}
        onClick={() => onSelect("actionable")}
      >
        Actionable
      </button>
      <button
        className={selectedValue === "no-action" ? "active" : ""}
        onClick={() => onSelect("no-action")}
      >
        No action needed
      </button>
      <button className={selectedValue === null ? "active" : ""} onClick={() => onSelect(null)}>
        All
      </button>
      {values.map((value) => (
        <button
          key={value}
          className={selectedValue === value ? "active" : ""}
          onClick={() => onSelect(value)}
        >
          {labelFor(value)}
        </button>
      ))}
    </div>
  );
}

function FilterGroup({
  title,
  values,
  selectedValue,
  onSelect,
}: {
  title: string;
  values: readonly string[];
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
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
          {labelFor(value)}
        </button>
      ))}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-chip" onClick={onClear} aria-label={`Clear ${label} filter`}>
      <span>{label}</span>
      <span aria-hidden="true">x</span>
    </button>
  );
}

function statusLabelFor(value: ReviewQueueStatusFilter): string {
  if (value === "actionable") {
    return "Actionable";
  }
  if (value === null) {
    return "All statuses";
  }
  if (value === "no-action") {
    return "No action needed";
  }
  return labelFor(value);
}

function labelFor(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUpdatedAt(value: string): string {
  if (value.trim() === "") {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parsePositiveInteger(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
