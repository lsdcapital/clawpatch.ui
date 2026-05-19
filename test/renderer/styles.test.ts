import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "../../src/renderer/src/styles.css"), "utf8");

describe("renderer layout styles", () => {
  it("keeps the main workspace height chained to the viewport", () => {
    expect(ruleFor("html,\\s*body,\\s*#root")).toContain("height: 100%;");
    expect(ruleFor("body")).toContain("overflow: hidden;");
    expect(ruleFor("\\.app-shell")).toContain("height: 100%;");
    expect(ruleFor("\\.app-shell\\.sidebar-collapsed")).toContain(
      "grid-template-columns: minmax(0, 1fr);",
    );
    const workspaceRule = ruleFor("\\.workspace");
    expect(workspaceRule).toContain("display: flex;");
    expect(workspaceRule).toContain("height: 100%;");
    const workspaceBodyRule = ruleFor("\\.workspace-body");
    expect(workspaceBodyRule).toContain("flex: 1 1 auto;");
    expect(workspaceBodyRule).toContain("padding: 0;");
    expect(ruleFor("\\.primary-workspace")).toContain("height: 100%;");
    const findingsWorkspaceRule = ruleFor("\\.findings-workspace");
    expect(findingsWorkspaceRule).toContain("height: 100%;");
    expect(findingsWorkspaceRule).toContain("minmax(180px, var(--findings-list-width))");
    expect(findingsWorkspaceRule).not.toContain("300px");
    const edgeToEdgePanelRule = ruleFor("\\.findings-workspace,\\s*\\.review-queue-panel");
    expect(edgeToEdgePanelRule).toContain("border: 0;");
    expect(edgeToEdgePanelRule).toContain("border-radius: 0;");
    expect(edgeToEdgePanelRule).toContain("box-shadow: none;");
    expect(ruleFor("\\.feature-map-table")).toContain("align-content: start;");
  });
});

function ruleFor(selectorPattern: string): string {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{[^}]+\\}`, "m"));
  expect(match, `Expected CSS rule for ${selectorPattern}`).not.toBeNull();
  return match![0];
}
