import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPanel } from "../../src/renderer/src/components/CommandPanel";
import type { CommandLogEntry } from "../../src/renderer/src/workspaceTypes";

describe("CommandPanel", () => {
  it("preserves adjacent stream chunks without inserting newlines", () => {
    render(
      <CommandPanel
        entries={[makeOutputEntry("hel"), makeOutputEntry("lo\n")]}
        isRunning={false}
        onInterrupt={vi.fn()}
      />,
    );

    const output = screen.getByText(/\[stdout\]/).closest("pre");
    expect(output).not.toBeNull();
    expect(output?.textContent).toBe("[stdout] hello\n");
    expect(output?.textContent).not.toContain("hel\nlo");
  });
});

function makeOutputEntry(chunk: string): CommandLogEntry {
  return {
    kind: "stream",
    event: {
      kind: "output",
      runId: "run-test",
      stream: "stdout",
      chunk,
    },
  };
}
