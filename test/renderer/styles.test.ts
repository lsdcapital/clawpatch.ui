import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "../../src/renderer/src/styles.css"), "utf8");

describe("renderer layout styles", () => {
  it("keeps the main workspace height chained to the viewport", () => {
    expect(ruleFor("html,\\s*body,\\s*#root")).toContain("height: 100%;");
    expect(ruleFor("body")).toContain("overflow: hidden;");
    const appShellRule = ruleFor("\\.app-shell");
    expect(appShellRule).toContain("height: 100%;");
    expect(appShellRule).toContain("overflow: hidden;");
    expect(ruleFor("\\.app-shell\\.sidebar-collapsed")).toContain(
      "grid-template-columns: 52px minmax(0, 1fr);",
    );
    const repoSidebarRule = ruleFor("\\.repo-sidebar");
    expect(repoSidebarRule).toContain("height: 100%;");
    expect(repoSidebarRule).toContain("max-height: 100%;");
    expect(repoSidebarRule).toContain("min-height: 0;");
    expect(repoSidebarRule).toContain("overflow: hidden;");
    const repoSidebarRailRule = ruleFor("\\.repo-sidebar-rail");
    expect(repoSidebarRailRule).toContain("border-right: 1px solid var(--border);");
    expect(repoSidebarRailRule).toContain("min-width: 52px;");
    expect(repoSidebarRailRule).toContain("width: 52px;");
    expect(ruleFor("\\.sidebar-collapse-button")).toContain("flex: none;");
    const repoListRule = ruleFor("\\.repo-list");
    expect(repoListRule).toContain("align-content: start;");
    expect(repoListRule).toContain("flex: 1 1 0;");
    expect(repoListRule).toContain("grid-auto-rows: max-content;");
    expect(repoListRule).toContain("min-height: 0;");
    expect(repoListRule).toContain("overflow: auto;");
    const repoSidebarFooterRule = ruleFor("\\.repo-sidebar-footer");
    expect(repoSidebarFooterRule).toContain("border-top: 1px solid var(--border);");
    expect(repoSidebarFooterRule).toContain("flex: none;");
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
    const gitStatusStripRule = ruleFor("\\.git-status-strip");
    expect(gitStatusStripRule).toContain("height: 32px;");
    expect(gitStatusStripRule).toContain("flex-wrap: nowrap;");
    expect(gitStatusStripRule).toContain("overflow: hidden;");
    const gitStatusBranchRule = ruleFor("\\.git-status-branch");
    expect(gitStatusBranchRule).toContain("text-overflow: ellipsis;");
    expect(gitStatusBranchRule).toContain("white-space: nowrap;");
    const settingsPageRule = ruleFor("\\.settings-page");
    expect(settingsPageRule).toContain("grid-template-columns: 280px minmax(0, 1fr);");
    expect(settingsPageRule).toContain("height: 100%;");
    const settingsSidebarRule = ruleFor("\\.settings-sidebar");
    expect(settingsSidebarRule).toContain("border-right: 1px solid var(--border);");
    expect(settingsSidebarRule).toContain("overflow: hidden;");
    expect(ruleFor("\\.settings-content")).toContain("overflow: auto;");
  });
});

function ruleFor(selectorPattern: string): string {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{[^}]+\\}`, "m"));
  expect(match, `Expected CSS rule for ${selectorPattern}`).not.toBeNull();
  return match![0];
}
