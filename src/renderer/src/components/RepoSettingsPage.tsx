import { useEffect, useState } from "react";
import { ArrowLeftIcon, InfoIcon, Settings2Icon } from "lucide-react";
import type { CommandResult, RepoSettings, RepoSummary } from "../../../shared/types";
import { appName, appVersion } from "../appInfo";

export type SettingsSection =
  | { readonly kind: "general" }
  | { readonly kind: "repo"; readonly repoId: string };

export function RepoSettingsPage({
  repos,
  selectedRepo,
  selectedSection,
  settings,
  isLoading,
  isSaving,
  error,
  doctorResult,
  isDoctorLoading,
  doctorError,
  onBack,
  onSelectGeneral,
  onSelectRepo,
  onSave,
}: {
  repos: readonly RepoSummary[];
  selectedRepo: RepoSummary | null;
  selectedSection: SettingsSection;
  settings: RepoSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: unknown;
  doctorResult: CommandResult | undefined;
  isDoctorLoading: boolean;
  doctorError: unknown;
  onBack: () => void;
  onSelectGeneral: () => void;
  onSelectRepo: (repoId: string) => void;
  onSave: (repoId: string, settings: RepoSettings) => void;
}) {
  const selectedSettingsRepo =
    selectedSection.kind === "repo"
      ? (repos.find((repo) => repo.id === selectedSection.repoId) ?? null)
      : null;

  return (
    <main className="settings-page">
      <aside className="settings-sidebar">
        <button className="settings-back-button" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" />
          Back to app
        </button>
        <nav className="settings-nav" aria-label="Settings">
          <button
            className={
              selectedSection.kind === "general" ? "settings-nav-item active" : "settings-nav-item"
            }
            onClick={onSelectGeneral}
          >
            <InfoIcon aria-hidden="true" />
            <span>General</span>
          </button>
          <div className="settings-nav-group-label">Repositories</div>
          <div className="settings-repo-nav-list">
            {repos.map((repo) => (
              <button
                key={repo.id}
                className={
                  selectedSection.kind === "repo" && selectedSection.repoId === repo.id
                    ? "settings-repo-nav-item active"
                    : "settings-repo-nav-item"
                }
                onClick={() => onSelectRepo(repo.id)}
                title={repo.path}
              >
                <span className="settings-repo-nav-icon" aria-hidden="true">
                  {repo.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="settings-repo-nav-copy">
                  <span>{repo.name}</span>
                  <small>{repo.path}</small>
                </span>
              </button>
            ))}
          </div>
        </nav>
      </aside>
      <section className="settings-content">
        {selectedSection.kind === "general" ? (
          <GeneralSettings
            repoCount={repos.length}
            selectedRepo={selectedRepo}
            doctorResult={doctorResult}
            isDoctorLoading={isDoctorLoading}
            doctorError={doctorError}
          />
        ) : selectedSettingsRepo === null ? (
          <MissingRepoSettings onSelectGeneral={onSelectGeneral} />
        ) : (
          <RepositorySettings
            repo={selectedSettingsRepo}
            settings={settings}
            isLoading={isLoading}
            isSaving={isSaving}
            error={error}
            onSave={(nextSettings) => onSave(selectedSettingsRepo.id, nextSettings)}
          />
        )}
      </section>
    </main>
  );
}

function GeneralSettings({
  repoCount,
  selectedRepo,
  doctorResult,
  isDoctorLoading,
  doctorError,
}: {
  repoCount: number;
  selectedRepo: RepoSummary | null;
  doctorResult: CommandResult | undefined;
  isDoctorLoading: boolean;
  doctorError: unknown;
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <Settings2Icon aria-hidden="true" />
        <div>
          <h1>General</h1>
          <p>Application settings and current installation details.</p>
        </div>
      </div>
      <dl className="settings-facts">
        <div>
          <dt>Application</dt>
          <dd>{appName}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>v{appVersion}</dd>
        </div>
        <div>
          <dt>Repositories</dt>
          <dd>{repoCount}</dd>
        </div>
      </dl>
      <section className="settings-readonly-section" aria-label="Doctor diagnostics">
        <div className="settings-readonly-header">
          <h2>Doctor</h2>
          <span>{selectedRepo?.name ?? "No repository selected"}</span>
        </div>
        {selectedRepo === null ? (
          <p className="settings-muted">Select a repository to view Doctor diagnostics.</p>
        ) : isDoctorLoading ? (
          <div className="settings-loading">Loading Doctor diagnostics...</div>
        ) : doctorError ? (
          <div className="form-error">
            {doctorError instanceof Error ? doctorError.message : String(doctorError)}
          </div>
        ) : doctorResult === undefined ? (
          <p className="settings-muted">Doctor diagnostics are not available.</p>
        ) : (
          <pre className="settings-readonly-output">{formatDoctorOutput(doctorResult)}</pre>
        )}
      </section>
    </div>
  );
}

function formatDoctorOutput(result: CommandResult): string {
  if (result.parsedJson !== null) {
    return JSON.stringify(result.parsedJson, null, 2);
  }

  const sections = [`Exit code: ${result.exitCode ?? "null"}`];
  sections.push(result.stdout.trim() === "" ? "stdout: (empty)" : `stdout:\n${result.stdout}`);
  if (result.stderr.trim() !== "") {
    sections.push(`stderr:\n${result.stderr}`);
  }
  return sections.join("\n\n");
}

function MissingRepoSettings({ onSelectGeneral }: { onSelectGeneral: () => void }) {
  return (
    <div className="settings-panel">
      <div className="settings-empty-state">
        <h1>Repository not found</h1>
        <p>Select another repository or return to General settings.</p>
        <button onClick={onSelectGeneral}>Open General</button>
      </div>
    </div>
  );
}

function RepositorySettings({
  repo,
  settings,
  isLoading,
  isSaving,
  error,
  onSave,
}: {
  repo: RepoSummary;
  settings: RepoSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: unknown;
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
  }, [repo.id, settings]);

  const resetForm = (): void => {
    if (settings === undefined) {
      return;
    }
    setTerminalAppName(settings.terminalAppName);
    setTerminalStartupScript(settings.terminalStartupScript);
    setWorktreeSetupScript(settings.worktreeSetupScript);
  };

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
    <div className="settings-panel">
      <div className="settings-panel-header">
        <span className="settings-repo-heading-icon" aria-hidden="true">
          {repo.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{repo.name}</h1>
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
            <button type="button" onClick={resetForm} disabled={isSaving || settings === undefined}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
