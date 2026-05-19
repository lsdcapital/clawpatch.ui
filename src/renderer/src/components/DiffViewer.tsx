import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useEffect, useState } from "react";

export function DiffViewer({ diff, isLoading }: { diff: string; isLoading: boolean }) {
  const prefersDarkMode = usePrefersDarkMode();

  return (
    <section className="panel diff-panel">
      <div className="panel-header">
        <h2>Git Diff</h2>
        <span>{isLoading ? "Loading" : diff === "" ? "Clean" : "Changed"}</span>
      </div>
      <CodeMirror
        value={diff || "No git diff."}
        height="100%"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: false,
        }}
        extensions={[javascript()]}
        editable={false}
        theme={prefersDarkMode ? "dark" : "light"}
      />
    </section>
  );
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
