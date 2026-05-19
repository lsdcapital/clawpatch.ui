import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";

export function DiffViewer({ diff, isLoading }: { diff: string; isLoading: boolean }) {
  return (
    <section className="panel diff-panel">
      <div className="panel-header">
        <h2>Git Diff</h2>
        <span>{isLoading ? "Loading" : diff === "" ? "Clean" : "Changed"}</span>
      </div>
      <CodeMirror
        value={diff || "No git diff."}
        height="240px"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: false
        }}
        extensions={[javascript()]}
        editable={false}
        theme="light"
      />
    </section>
  );
}
