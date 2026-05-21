import { describe, expect, it } from "vitest";
import type { FindingListItem } from "../../src/shared/types";
import {
  defaultFindingFilters,
  defaultFindingSort,
  filterFindings,
  getFindingFilterOptions,
  isFindingFiltersActive,
  resolveSelectedFindingId,
  sortFindings,
} from "../../src/renderer/src/findingsFilters";
import { clawpatchStatuses } from "../../src/shared/constants";

describe("finding filters", () => {
  const findings = [
    makeFinding({
      findingId: "fnd-security",
      title: "Token is logged in debug output",
      category: "security",
      severity: "high",
      status: "open",
      confidence: "high",
      evidence: [
        { path: "src/auth.ts", startLine: 10, endLine: 12, symbol: "logToken", quote: null },
      ],
    }),
    makeFinding({
      findingId: "fnd-bug",
      title: "Null branch can throw",
      category: "bug",
      severity: "medium",
      status: "fixed",
      confidence: "medium",
      evidence: [
        { path: "src/example.ts", startLine: 20, endLine: 21, symbol: "readValue", quote: null },
      ],
    }),
    makeFinding({
      findingId: "fnd-test",
      title: "Missing regression coverage",
      category: "test-gap",
      severity: "low",
      status: "uncertain",
      confidence: "low",
    }),
    makeFinding({
      findingId: "fnd-false-positive",
      title: "Framework handles escaping",
      category: "security",
      severity: "high",
      status: "false-positive",
      confidence: "low",
    }),
    makeFinding({
      findingId: "fnd-wont-fix",
      title: "Intentional legacy behavior",
      category: "maintainability",
      severity: "low",
      status: "wont-fix",
      confidence: "medium",
    }),
  ];

  it("defaults to actionable findings only", () => {
    expect(filterFindings(findings, defaultFindingFilters).map((item) => item.findingId)).toEqual([
      "fnd-security",
      "fnd-test",
    ]);
  });

  it("allows viewing all statuses or one resolved status explicitly", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, status: null }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-security", "fnd-bug", "fnd-test", "fnd-false-positive", "fnd-wont-fix"]);
    expect(
      filterFindings(findings, { ...defaultFindingFilters, status: "false-positive" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-false-positive"]);
  });

  it("filters by status", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, status: "fixed" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-bug"]);
  });

  it("filters by severity", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, severity: "high" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-security"]);
  });

  it("filters by confidence", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, confidence: "low" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-test"]);
    expect(
      filterFindings(findings, {
        ...defaultFindingFilters,
        status: null,
        confidence: "medium",
      }).map((item) => item.findingId),
    ).toEqual(["fnd-bug", "fnd-wont-fix"]);
  });

  it("filters security as a category", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, category: "security" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-security"]);
  });

  it("searches title, id, and evidence metadata", () => {
    expect(
      filterFindings(findings, { ...defaultFindingFilters, search: "LOG token" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-security"]);
    expect(
      filterFindings(findings, { ...defaultFindingFilters, status: null, search: "readvalue" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-bug"]);
    expect(
      filterFindings(findings, { ...defaultFindingFilters, search: "fnd-test" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-test"]);
  });

  it("reports active filters and derived options", () => {
    expect(isFindingFiltersActive(defaultFindingFilters)).toBe(false);
    expect(isFindingFiltersActive({ ...defaultFindingFilters, status: null })).toBe(true);
    expect(isFindingFiltersActive({ ...defaultFindingFilters, confidence: "low" })).toBe(true);
    expect(isFindingFiltersActive({ ...defaultFindingFilters, category: "security" })).toBe(true);
    expect(getFindingFilterOptions(findings, clawpatchStatuses)).toEqual({
      statuses: clawpatchStatuses,
      severities: ["high", "low", "medium"],
      confidences: ["high", "low", "medium"],
      categories: ["bug", "maintainability", "security", "test-gap"],
    });
  });

  it("moves selection to the first visible finding when the current selection is hidden", () => {
    expect(resolveSelectedFindingId("fnd-bug", [findings[0]!, findings[2]!])).toBe("fnd-security");
    expect(resolveSelectedFindingId("fnd-bug", [findings[1]!])).toBe("fnd-bug");
    expect(resolveSelectedFindingId("fnd-bug", [])).toBeNull();
  });

  it("sorts by default risk with severity, category priority, and deterministic ties", () => {
    const unsortedFindings = [
      makeFinding({
        findingId: "fnd-unknown-category",
        title: "Alpha unknown category",
        category: "api",
        severity: "high",
      }),
      makeFinding({
        findingId: "fnd-security-b",
        title: "Beta security finding",
        category: "security",
        severity: "high",
      }),
      makeFinding({
        findingId: "fnd-low-security",
        title: "Low security finding",
        category: "security",
        severity: "low",
      }),
      makeFinding({
        findingId: "fnd-security-a",
        title: "Alpha security finding",
        category: "security",
        severity: "high",
      }),
      makeFinding({
        findingId: "fnd-critical",
        title: "Critical finding",
        category: "maintainability",
        severity: "critical",
      }),
      makeFinding({
        findingId: "fnd-data-loss",
        title: "Data loss finding",
        category: "data-loss",
        severity: "high",
      }),
    ];

    expect(
      sortFindings(unsortedFindings, defaultFindingSort).map((item) => item.findingId),
    ).toEqual([
      "fnd-critical",
      "fnd-security-a",
      "fnd-security-b",
      "fnd-data-loss",
      "fnd-unknown-category",
      "fnd-low-security",
    ]);
  });

  it("sorts unknown categories alphabetically after known risk categories", () => {
    const unsortedFindings = [
      makeFinding({ findingId: "fnd-zeta", category: "zeta", severity: "high" }),
      makeFinding({ findingId: "fnd-security", category: "security", severity: "high" }),
      makeFinding({ findingId: "fnd-api", category: "api", severity: "high" }),
    ];

    expect(
      sortFindings(unsortedFindings, { field: "category", direction: "asc" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-security", "fnd-api", "fnd-zeta"]);
  });

  it("sorts confidence by low, medium, high, and unknown", () => {
    const unsortedFindings = [
      makeFinding({ findingId: "fnd-medium", confidence: "medium" }),
      makeFinding({ findingId: "fnd-unknown", confidence: "likely" }),
      makeFinding({ findingId: "fnd-low", confidence: "low" }),
      makeFinding({ findingId: "fnd-high", confidence: "high" }),
    ];

    expect(
      sortFindings(unsortedFindings, { field: "confidence", direction: "asc" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-unknown", "fnd-low", "fnd-medium", "fnd-high"]);
    expect(
      sortFindings(unsortedFindings, { field: "confidence", direction: "desc" }).map(
        (item) => item.findingId,
      ),
    ).toEqual(["fnd-high", "fnd-medium", "fnd-low", "fnd-unknown"]);
  });
});

function makeFinding(overrides: Partial<FindingListItem>): FindingListItem {
  return {
    findingId: "fnd-1",
    featureId: "feat-1",
    title: "Finding",
    category: "bug",
    severity: "medium",
    confidence: "medium",
    triage: null,
    status: "open",
    evidence: [],
    linkedPatchAttemptIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
