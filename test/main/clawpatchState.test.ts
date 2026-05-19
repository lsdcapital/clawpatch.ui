import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFindingDetail, readFindingList } from "../../src/main/services/clawpatchState";
import { readGuiMetadata, setGuiNote } from "../../src/main/services/guiMetadata";

const fixtureRepo = resolve("test/fixtures/clawpatch-repo");

describe("clawpatch state reader", () => {
  it("normalizes finding list items without mutating Clawpatch files", async () => {
    const findings = await readFindingList(fixtureRepo, await readGuiMetadata(fixtureRepo));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      findingId: "fnd-1",
      title: "Null branch can throw",
      severity: "high",
      status: "open"
    });
  });

  it("loads finding details with feature and linked patches", async () => {
    const detail = await readFindingDetail(fixtureRepo, "fnd-1", await readGuiMetadata(fixtureRepo));

    expect(detail.reasoning).toContain("null");
    expect(detail.feature).toMatchObject({ featureId: "feat-1" });
    expect(detail.patchAttempts).toHaveLength(1);
  });
});

describe("gui metadata", () => {
  it("stores app-only notes under .clawpatch/gui", async () => {
    const tempRepo = await mkdtemp(join(tmpdir(), "clawpatch-fixture-"));
    await cp(fixtureRepo, tempRepo, { recursive: true });
    try {
      const metadata = await setGuiNote(tempRepo, "fnd-1", "check later");

      expect(metadata.notes["fnd-1"]).toBe("check later");
      const findings = await readFindingList(tempRepo, metadata);
      expect(findings[0].localNote).toBe("check later");
    } finally {
      await rm(tempRepo, { recursive: true, force: true });
    }
  });
});
