import { useEffect, useState } from "react";
import type { RepoSettings, RepoSummary } from "../../../shared/types";

export function RepoSettingsDialog({
  repo,
  settings,
  isLoading,
  isSaving,
  error,
  onCancel,
  onSave,
}: {
  repo: RepoSummary;
  settings: RepoSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (settings: RepoSettings) => void;
}) {
  const [terminalAppName, setTerminalAppName] = useState("Terminal");
  const [terminalStartupScript, setTerminalStartupScript] = useState("");
  const [worktreeSetupScript, setWorktreeSetupScript] = useState("");

  useEffect(() => {
    if (settings === undefined) {
      return;
    }
    setTerminalAppName(settings.terminalAppName);
    setTerminalStartupScript(settings.terminalStartupScript);
    setWorktreeSetupScript(settings.worktreeSetupScript);
  }, [settings]);

  const save = (): void => {
    onSave({
      schemaVersion: 1,
      terminalAppName,
      terminalStartupScript,
      worktreeSetupScript,
      updatedAt: settings?.updatedAt ?? new Date(0).toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-settings-title"
      >
        <div className="settings-dialog-header">
          <div>
            <h2 id="repo-settings-title">Repository Settings</h2>
            <p>{repo.path}</p>
          </div>
        </div>
        {isLoading ? (
          <div className="settings-loading">Loading settings...</div>
        ) : (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label>
              Terminal app
              <input
                value={terminalAppName}
                onChange={(event) => setTerminalAppName(event.target.value)}
                placeholder="Terminal"
              />
            </label>
            <label>
              Terminal startup script
              <textarea
                value={terminalStartupScript}
                onChange={(event) => setTerminalStartupScript(event.target.value)}
                rows={5}
                spellCheck={false}
              />
            </label>
            <label>
              Worktree setup script
              <textarea
                value={worktreeSetupScript}
                onChange={(event) => setWorktreeSetupScript(event.target.value)}
                rows={7}
                spellCheck={false}
              />
            </label>
            {error ? (
              <div className="form-error">
                {error instanceof Error ? error.message : String(error)}
              </div>
            ) : null}
            <div className="settings-actions">
              <button type="button" onClick={onCancel} disabled={isSaving}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={isSaving}>
                Save
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
