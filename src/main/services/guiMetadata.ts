import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GuiMetadata } from "../../shared/types";

export async function readGuiMetadata(repoPath: string): Promise<GuiMetadata> {
  const path = metadataPath(repoPath);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<GuiMetadata>;
    return {
      ...defaultMetadata(),
      ...parsed,
      filters: { ...defaultMetadata().filters, ...parsed.filters },
      notes: parsed.notes ?? {},
      schemaVersion: 1
    };
  } catch {
    return defaultMetadata();
  }
}

export async function writeGuiMetadata(repoPath: string, metadata: GuiMetadata): Promise<GuiMetadata> {
  const next = { ...metadata, schemaVersion: 1 as const, updatedAt: new Date().toISOString() };
  await mkdir(join(repoPath, ".clawpatch", "gui"), { recursive: true });
  await writeFile(metadataPath(repoPath), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function setGuiNote(repoPath: string, findingId: string, note: string): Promise<GuiMetadata> {
  const metadata = await readGuiMetadata(repoPath);
  const nextNotes = { ...metadata.notes };
  if (note.trim() === "") {
    delete nextNotes[findingId];
  } else {
    nextNotes[findingId] = note;
  }
  return writeGuiMetadata(repoPath, { ...metadata, notes: nextNotes, lastSelectedFindingId: findingId });
}

function metadataPath(repoPath: string): string {
  return join(repoPath, ".clawpatch", "gui", "state.json");
}

function defaultMetadata(): GuiMetadata {
  return {
    schemaVersion: 1,
    filters: {
      severity: null,
      status: null,
      search: ""
    },
    notes: {},
    lastSelectedFindingId: null,
    updatedAt: new Date(0).toISOString()
  };
}
