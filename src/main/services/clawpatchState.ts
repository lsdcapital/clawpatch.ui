import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FindingDetail, FindingListItem, GuiMetadata } from "../../shared/types";

interface RawFinding {
  findingId: string;
  featureId: string;
  title: string;
  category: string;
  severity: string;
  confidence: string;
  triage?: string;
  evidence?: unknown[];
  reasoning: string;
  reproduction: string | null;
  recommendation: string;
  whyTestsDoNotAlreadyCoverThis?: string | null;
  suggestedRegressionTest?: string | null;
  minimumFixScope?: string | null;
  status: FindingListItem["status"];
  history?: unknown[];
  linkedPatchAttemptIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export async function detectClawpatch(repoPath: string): Promise<boolean> {
  const stateDir = join(repoPath, ".clawpatch");
  const candidates = [join(stateDir, "config.json"), join(stateDir, "findings")];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return true;
    } catch {
      // Keep checking other markers.
    }
  }
  return false;
}

export async function readFindingList(
  repoPath: string,
  metadata: GuiMetadata
): Promise<FindingListItem[]> {
  const rawFindings = await readRawFindings(repoPath);
  return rawFindings.map((finding) => toFindingListItem(finding, metadata));
}

export async function readFindingDetail(
  repoPath: string,
  findingId: string,
  metadata: GuiMetadata
): Promise<FindingDetail> {
  const finding = (await readRawFindings(repoPath)).find((item) => item.findingId === findingId);
  if (finding === undefined) {
    throw new Error(`Finding not found: ${findingId}`);
  }

  const [features, patches] = await Promise.all([readRecords(repoPath, "features"), readRecords(repoPath, "patches")]);
  const feature = features.find((item) => objectId(item, "featureId") === finding.featureId) ?? null;
  const patchIds = new Set(finding.linkedPatchAttemptIds ?? []);
  const linkedPatches = patches.filter((item) => patchIds.has(objectId(item, "patchAttemptId")));

  return {
    ...toFindingListItem(finding, metadata),
    reasoning: finding.reasoning,
    reproduction: finding.reproduction ?? null,
    recommendation: finding.recommendation,
    whyTestsDoNotAlreadyCoverThis: finding.whyTestsDoNotAlreadyCoverThis ?? null,
    suggestedRegressionTest: finding.suggestedRegressionTest ?? null,
    minimumFixScope: finding.minimumFixScope ?? null,
    feature,
    patchAttempts: linkedPatches,
    history: finding.history ?? []
  };
}

async function readRawFindings(repoPath: string): Promise<RawFinding[]> {
  const records = await readRecords(repoPath, "findings");
  return records
    .filter(isRawFinding)
    .sort((a, b) => rankFinding(a) - rankFinding(b) || a.findingId.localeCompare(b.findingId));
}

async function readRecords(repoPath: string, directory: string): Promise<unknown[]> {
  const dir = join(repoPath, ".clawpatch", directory);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const records: unknown[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const path = join(dir, basename(name));
    records.push(JSON.parse(await readFile(path, "utf8")) as unknown);
  }
  return records;
}

function toFindingListItem(finding: RawFinding, metadata: GuiMetadata): FindingListItem {
  return {
    findingId: finding.findingId,
    featureId: finding.featureId,
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    triage: finding.triage ?? null,
    status: finding.status,
    evidence: (finding.evidence ?? []).map((item) => ({
      path: valueOrEmpty(item, "path"),
      startLine: nullableNumber(item, "startLine"),
      endLine: nullableNumber(item, "endLine"),
      symbol: nullableString(item, "symbol"),
      quote: nullableString(item, "quote")
    })),
    linkedPatchAttemptIds: finding.linkedPatchAttemptIds ?? [],
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    localNote: metadata.notes[finding.findingId] ?? null
  };
}

function isRawFinding(value: unknown): value is RawFinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["findingId"] === "string" &&
    typeof record["featureId"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["category"] === "string" &&
    typeof record["severity"] === "string" &&
    typeof record["confidence"] === "string" &&
    typeof record["reasoning"] === "string" &&
    typeof record["recommendation"] === "string" &&
    typeof record["status"] === "string" &&
    typeof record["createdAt"] === "string" &&
    typeof record["updatedAt"] === "string"
  );
}

function rankFinding(finding: RawFinding): number {
  const severity = { critical: 0, high: 1, medium: 2, low: 3 }[finding.severity] ?? 4;
  const status = finding.status === "open" ? 0 : 10;
  return status + severity;
}

function objectId(value: unknown, key: string): string {
  if (typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function valueOrEmpty(value: unknown, key: string): string {
  if (typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  return "";
}

function nullableString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function nullableNumber(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}
