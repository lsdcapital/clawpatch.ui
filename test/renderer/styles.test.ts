import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "../../src/renderer/src/styles.css"), "utf8");

describe("renderer layout styles", () => {
  it("keeps the main workspace height chained to the viewport", () => {
    expect(ruleFor("html,\\s*body,\\s*#root")).toContain("height: 100%;");
    expect(ruleFor("body")).toContain("overflow: hidden;");
    expect(ruleFor("\\.app-shell")).toContain("height: 100%;");
    expect(ruleFor("\\.workspace")).toContain("height: 100%;");
    const workspaceBodyRule = ruleFor("\\.workspace-body");
    expect(workspaceBodyRule).toContain("height: 100%;");
    expect(workspaceBodyRule).toContain("grid-row: 3;");
    expect(ruleFor("\\.primary-workspace")).toContain("height: 100%;");
    expect(ruleFor("\\.findings-workspace")).toContain("height: 100%;");
  });
});

function ruleFor(selectorPattern: string): string {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{[^}]+\\}`, "m"));
  expect(match, `Expected CSS rule for ${selectorPattern}`).not.toBeNull();
  return match![0];
}
