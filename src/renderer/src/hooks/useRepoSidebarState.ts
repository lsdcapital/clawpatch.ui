import { useState } from "react";

const REPO_SIDEBAR_COLLAPSED_STORAGE_KEY = "clawpatch.repoSidebarCollapsed.v1";

export function useRepoSidebarState(): {
  isRepoSidebarCollapsed: boolean;
  toggleRepoSidebar: () => void;
} {
  const [isRepoSidebarCollapsed, setIsRepoSidebarCollapsed] = useState(readStoredSidebarState);

  const toggleRepoSidebar = (): void => {
    setIsRepoSidebarCollapsed((current) => {
      const next = !current;
      persistSidebarState(next);
      return next;
    });
  };

  return { isRepoSidebarCollapsed, toggleRepoSidebar };
}

function readStoredSidebarState(): boolean {
  let storedState: string | null;
  try {
    storedState = window.localStorage.getItem(REPO_SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch {
    return false;
  }

  return storedState === "true";
}

function persistSidebarState(isCollapsed: boolean): void {
  try {
    window.localStorage.setItem(REPO_SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
  } catch {
    // The toggle should keep working even if local storage is unavailable.
  }
}
