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
    expect(ruleFor("\\.sidebar-rail-settings-button")).toContain("margin-top: auto;");
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

  it("keeps neutral chrome icon buttons borderless by default", () => {
    const iconButtonRule = ruleFor("^\\.icon-button");
    expect(iconButtonRule).toContain("background: transparent;");
    expect(iconButtonRule).toContain("border-color: transparent;");
    expect(iconButtonRule).toContain("min-height: 28px;");
    expect(iconButtonRule).toContain("width: 28px;");

    const iconButtonHoverRule = ruleFor("\\.icon-button:hover:not\\(:disabled\\)");
    expect(iconButtonHoverRule).toContain("background: var(--button-hover-bg);");
    expect(iconButtonHoverRule).toContain("border-color: transparent;");

    const activeDrawerToggleRule = ruleFor("\\.drawer-toggle\\.active");
    expect(activeDrawerToggleRule).toContain("background: var(--accent-soft);");
    expect(activeDrawerToggleRule).toContain("border-color: var(--accent-border);");

    expect(ruleFor("\\.action-icon-button")).not.toContain("border-color: transparent;");
  });

  it("shows icon control tooltips immediately", () => {
    const triggerRule = ruleFor("\\.icon-tooltip-trigger");
    expect(triggerRule).toContain("display: inline-flex;");

    const tooltipRule = ruleFor("\\.icon-tooltip");
    expect(tooltipRule).toContain("background: var(--surface-muted);");
    expect(tooltipRule).toContain("border: 1px solid var(--border);");
    expect(tooltipRule).toContain("border-radius: 3px;");
    expect(tooltipRule).toContain("box-shadow: var(--tooltip-shadow);");
    expect(tooltipRule).toContain("color: var(--text);");
    expect(tooltipRule).toContain("font-weight: 500;");
    expect(tooltipRule).toContain("opacity: 0;");
    expect(tooltipRule).toContain("position: fixed;");
    expect(tooltipRule).toContain("visibility: hidden;");
    expect(tooltipRule).not.toContain("transition");

    const visibleTooltipRule = ruleFor('\\.icon-tooltip\\[data-visible="true"\\]');
    expect(visibleTooltipRule).toContain("opacity: 1;");
    expect(visibleTooltipRule).toContain("visibility: visible;");
    expect(visibleTooltipRule).not.toContain("transition-delay");
    expect(styles).not.toMatch(/header-tooltip-trigger/);
    expect(styles).not.toMatch(/header-icon-tooltip/);
  });
});

function ruleFor(selectorPattern: string): string {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{[^}]+\\}`, "m"));
  expect(match, `Expected CSS rule for ${selectorPattern}`).not.toBeNull();
  return match![0];
}
