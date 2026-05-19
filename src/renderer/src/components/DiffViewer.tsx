import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

interface DiffViewerProps {
  diff: string;
  isLoading: boolean;
  scrollToFilePath?: string | null;
  scrollToken?: number;
}

export function DiffViewer({ diff, isLoading, scrollToFilePath, scrollToken }: DiffViewerProps) {
  const prefersDarkMode = usePrefersDarkMode();
  const viewportRef = useRef<HTMLDivElement>(null);
  const themeType = prefersDarkMode ? "dark" : "light";

  const files = useMemo(() => parseDiffFiles(diff), [diff]);

  useEffect(() => {
    if (scrollToFilePath === null || scrollToFilePath === undefined || scrollToFilePath === "") {
      return;
    }
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const targetPath = stripDiffPathPrefix(scrollToFilePath);

    const scrollToTarget = (): boolean => {
      const target = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
      ).find((element) => element.dataset.diffFilePath === targetPath);
      if (target === undefined || typeof target.scrollIntoView !== "function") {
        return false;
      }
      target.scrollIntoView({ block: "start", behavior: "auto" });
      return true;
    };

    let cancelled = false;
    let animationId = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const attempt = (remainingFrames: number): void => {
      if (cancelled) return;
      scrollToTarget();
      if (remainingFrames > 0) {
        animationId = requestAnimationFrame(() => attempt(remainingFrames - 1));
      } else {
        timeoutId = setTimeout(() => {
          if (!cancelled) scrollToTarget();
        }, 120);
      }
    };

    attempt(3);

    return () => {
      cancelled = true;
      if (animationId !== 0) cancelAnimationFrame(animationId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [files, scrollToFilePath, scrollToken]);

  return (
    <section className="panel diff-panel">
      <div className="panel-header">
        <h2>Git Diff</h2>
        <span>
          {isLoading
            ? "Loading"
            : diff === ""
              ? "Clean"
              : `${files.length} file${files.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="diff-viewport" ref={viewportRef}>
        {files.length === 0 ? (
          <div className="diff-empty">{diff === "" ? "No git diff." : "Unable to parse diff."}</div>
        ) : (
          <Virtualizer
            className="diff-virtualizer"
            config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
          >
            {files.map((fileDiff) => {
              const filePath = resolveFileDiffPath(fileDiff);
              const key = fileDiff.cacheKey ?? `${fileDiff.prevName ?? "_"}:${fileDiff.name}`;
              return (
                <div
                  key={`${key}:${themeType}`}
                  data-diff-file-path={filePath}
                  className="diff-render-file"
                >
                  <FileDiff
                    fileDiff={fileDiff}
                    options={{
                      diffStyle: "unified",
                      lineDiffType: "none",
                      overflow: "scroll",
                      theme: themeType === "dark" ? "github-dark" : "github-light",
                      themeType,
                    }}
                  />
                </div>
              );
            })}
          </Virtualizer>
        )}
      </div>
    </section>
  );
}

function parseDiffFiles(diff: string): FileDiffMetadata[] {
  const trimmed = diff.trim();
  if (trimmed === "") {
    return [];
  }
  try {
    const parsed = parsePatchFiles(trimmed, `diff-viewer:${trimmed.length}`);
    return parsed.flatMap((patch) => patch.files);
  } catch {
    return [];
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  return stripDiffPathPrefix(raw);
}

function stripDiffPathPrefix(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    return normalized.slice(2);
  }
  return normalized;
}

const DIFF_GIT_HEADER_REGEX = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/gm;

export function extractDiffFilePaths(diff: string): ReadonlySet<string> {
  const paths = new Set<string>();
  if (diff === "") {
    return paths;
  }
  DIFF_GIT_HEADER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIFF_GIT_HEADER_REGEX.exec(diff)) !== null) {
    const name = match[3] ?? match[4];
    if (name !== undefined && name !== "") {
      paths.add(name);
    }
  }
  return paths;
}

function usePrefersDarkMode(): boolean {
  const [prefersDarkMode, setPrefersDarkMode] = useState(getPrefersDarkMode);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = (): void => setPrefersDarkMode(mediaQuery.matches);

    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);
    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  return prefersDarkMode;
}

function getPrefersDarkMode(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
