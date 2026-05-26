import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  ListChecksIcon,
  MapIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { FeatureMapItem, FeatureMapSnapshot } from "../../../shared/types";
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import {
  defaultReviewQueueFilters,
  filterReviewQueue,
  getReviewQueueFilterOptions,
  isReviewQueueFiltersActive,
  type ReviewQueueFilters,
  type ReviewQueueStatusFilter,
} from "../reviewQueueFilters";
import { ActionIconButton } from "./ActionIconButton";

interface Props {
  snapshot: FeatureMapSnapshot | null;
  isLoading: boolean;
  isBusy: boolean;
  onReviewFeature: (featureId: string) => void;
  onReviewPending: (limit: number) => void;
  onUpdateMap: () => void;
}

export function ReviewMapPanel({
  snapshot,
  isLoading,
  isBusy,
  onReviewFeature,
  onReviewPending,
  onUpdateMap,
}: Props) {
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [filters, setFilters] = useState(defaultReviewQueueFilters);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterMenuRef = useDismissiblePopover<HTMLDetailsElement>({
    isOpen: isFilterMenuOpen,
    onDismiss: () => setIsFilterMenuOpen(false),
  });
  const features = useMemo(() => snapshot?.features ?? [], [snapshot]);
  const filteredFeatures = useMemo(() => filterReviewQueue(features, filters), [features, filters]);
  const filterOptions = useMemo(() => getReviewQueueFilterOptions(features), [features]);
  const filtersActive = isReviewQueueFiltersActive(filters);
  const pendingCount = snapshot?.coverage.pendingReviewCount ?? 0;
  const totalCount = snapshot?.coverage.totalFeatures ?? 0;
  const statusLabel = isLoading
    ? "Loading"
    : `${pendingCount} pending/error of ${totalCount} map items`;
  const countLabel = isLoading
    ? "Loading"
    : filtersActive
      ? `${filteredFeatures.length} of ${totalCount} shown`
      : `${totalCount} total`;

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

  return (
    <section className="panel review-queue-panel">
      <div className="panel-header">
        <h2>Review Queue</h2>
        <span>{statusLabel}</span>
      </div>
      <div className="review-queue-toolbar">
        <div className="action-toolbar review-queue-actions" aria-label="Review queue actions">
          <ActionIconButton
            disabled={isBusy || pendingCount === 0}
            icon={<ListChecksIcon aria-hidden="true" />}
            label={`Review all ${pendingCount} pending and error map items`}
            onClick={() => onReviewPending(pendingCount)}
            title="Review pending"
          />
          <ActionIconButton
            disabled={isBusy}
            icon={<MapIcon aria-hidden="true" />}
            label="Update map"
            onClick={onUpdateMap}
          />
        </div>
        <div className="findings-filter-row">
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
        <div className="review-queue-summary-row">
          <span>{countLabel}</span>
          {filtersActive ? (
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
          ) : null}
        </div>
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
          isBusy={isBusy}
          onReviewFeature={onReviewFeature}
          onToggleExpanded={toggleExpanded}
        />
      )}
    </section>
  );
}

function ReviewMapTable({
  features,
  expandedFeatureIds,
  hasActiveFilters,
  isBusy,
  onReviewFeature,
  onToggleExpanded,
}: {
  features: FeatureMapSnapshot["features"];
  expandedFeatureIds: ReadonlySet<string>;
  hasActiveFilters: boolean;
  isBusy: boolean;
  onReviewFeature: (featureId: string) => void;
  onToggleExpanded: (featureId: string) => void;
}) {
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
        <div className="feature-map-empty">
          {hasActiveFilters ? "No map items match these filters." : "No map items found."}
        </div>
      ) : (
        features.map((feature) => {
          const isExpanded = expandedFeatureIds.has(feature.featureId);
          return (
            <Fragment key={feature.featureId}>
              <div className="feature-map-row" role="row">
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
                <span className={`feature-status ${feature.status}`}>{feature.status}</span>
                <span>{feature.kind}</span>
                <span>{feature.source}</span>
                <span>{feature.ownedFileCount + feature.contextFileCount + feature.testCount}</span>
                <span>{feature.findingCount}</span>
                <strong title={feature.featureId}>{feature.title}</strong>
                <span>{formatUpdatedAt(feature.updatedAt)}</span>
                <ActionIconButton
                  disabled={isBusy}
                  icon={<ClipboardCheckIcon aria-hidden="true" />}
                  label={`Review ${feature.title}`}
                  onClick={() => onReviewFeature(feature.featureId)}
                  title={`Review ${feature.title} (${feature.featureId})`}
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
