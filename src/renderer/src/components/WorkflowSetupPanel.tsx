import { ClipboardCheckIcon, HeartPulseIcon, MapIcon, PlayIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ClawpatchCommandRequest, RepoSummary } from "../../../shared/types";
import { ActionIconButton } from "./ActionIconButton";

interface SetupStep {
  readonly command: ClawpatchCommandRequest;
  readonly icon: ReactNode;
  readonly label: string;
  readonly title: string;
  readonly description: string;
}

const SETUP_STEPS: readonly SetupStep[] = [
  {
    command: { command: "doctor" },
    icon: <HeartPulseIcon aria-hidden="true" />,
    label: "Run doctor",
    title: "Doctor",
    description: "Check the CLI, provider, Git, and repository prerequisites.",
  },
  {
    command: { command: "init" },
    icon: <PlayIcon aria-hidden="true" />,
    label: "Initialize",
    title: "Initialize",
    description: "Create the Clawpatch state directory and shared config.",
  },
  {
    command: { command: "map" },
    icon: <MapIcon aria-hidden="true" />,
    label: "Map application",
    title: "Map",
    description: "Build the feature map used for targeted reviews.",
  },
  {
    command: { command: "review", limit: 10 },
    icon: <ClipboardCheckIcon aria-hidden="true" />,
    label: "Generate findings",
    title: "Review",
    description: "Review mapped features and write findings into Clawpatch state.",
  },
];

export function WorkflowSetupPanel({
  repo,
  isBusy,
  runningCommandLabel,
  onRunCommand,
}: {
  repo: RepoSummary;
  isBusy: boolean;
  runningCommandLabel?: string;
  onRunCommand: (request: ClawpatchCommandRequest) => void;
}) {
  return (
    <section className="panel workflow-setup-panel" aria-label="Clawpatch setup">
      <div className="workflow-setup-heading">
        <SparklesIcon aria-hidden="true" />
        <div>
          <h2>Set up {repo.name}</h2>
          <p>{repo.path}</p>
        </div>
      </div>
      <div className="workflow-setup-steps">
        {SETUP_STEPS.map((step) => (
          <article className="workflow-setup-step" key={step.title}>
            <div className="workflow-setup-step-icon">{step.icon}</div>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
            <ActionIconButton
              disabled={isBusy}
              icon={step.icon}
              label={step.label}
              onClick={() => onRunCommand(step.command)}
            />
          </article>
        ))}
      </div>
      {isBusy && runningCommandLabel !== undefined ? (
        <div className="workflow-setup-running" role="status">
          <span className="detail-command-spinner" aria-hidden="true" />
          {runningCommandLabel} running
        </div>
      ) : null}
    </section>
  );
}
