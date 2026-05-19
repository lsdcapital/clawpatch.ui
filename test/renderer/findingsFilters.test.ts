import { describe, expect, it } from "vitest";
import type { FindingListItem } from "../../src/shared/types";
import {
  defaultFindingFilters,
  filterFindings,
  getFindingFilterOptions,
  isFindingFiltersActive,
  resolveSelectedFindingId,
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
  ];

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
      filterFindings(findings, { ...defaultFindingFilters, search: "readvalue" }).map(
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
    expect(isFindingFiltersActive({ ...defaultFindingFilters, category: "security" })).toBe(true);
    expect(getFindingFilterOptions(findings, clawpatchStatuses)).toEqual({
      statuses: clawpatchStatuses,
      severities: ["high", "low", "medium"],
      categories: ["bug", "security", "test-gap"],
    });
  });

  it("moves selection to the first visible finding when the current selection is hidden", () => {
    expect(resolveSelectedFindingId("fnd-bug", [findings[0]!, findings[2]!])).toBe("fnd-security");
    expect(resolveSelectedFindingId("fnd-bug", [findings[1]!])).toBe("fnd-bug");
    expect(resolveSelectedFindingId("fnd-bug", [])).toBeNull();
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
    localNote: null,
    ...overrides,
  };
}
