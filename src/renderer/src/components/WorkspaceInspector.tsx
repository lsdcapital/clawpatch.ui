import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { CommandPanel } from "./CommandPanel";
import { DiffViewer } from "./DiffViewer";
import type { ActiveInspector, CommandLogEntry } from "../workspaceTypes";

const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_DEFAULT_WIDTH = 440;
const INSPECTOR_KEYBOARD_STEP = 24;
const INSPECTOR_RESIZE_TRACK_WIDTH = 8;
const PRIMARY_MIN_WIDTH = 520;

export function WorkspaceInspector({
  activeInspector,
  diff,
  isDiffLoading,
  diffJump,
  commandLog,
  isCommandRunning,
  onInterruptCommand,
  children,
}: {
  activeInspector: ActiveInspector;
  diff: string;
  isDiffLoading: boolean;
  diffJump: { path: string; epoch: number } | null;
  commandLog: CommandLogEntry[];
  isCommandRunning: boolean;
  onInterruptCommand: () => void;
  children: ReactNode;
}) {
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);
  const workspaceBodyRef = useRef<HTMLDivElement>(null);

  const inspectorMaxWidth = (): number => {
    const body = workspaceBodyRef.current;
    if (body === null) {
      return INSPECTOR_MAX_WIDTH;
    }
    const bodyWidth = body.getBoundingClientRect().width;
    if (bodyWidth === 0) {
      return INSPECTOR_MAX_WIDTH;
    }
    const availableWidth = bodyWidth - PRIMARY_MIN_WIDTH - INSPECTOR_RESIZE_TRACK_WIDTH;
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, availableWidth));
  };

  const clampInspectorWidth = (nextWidth: number): number =>
    Math.min(inspectorMaxWidth(), Math.max(INSPECTOR_MIN_WIDTH, nextWidth));

  const setClampedInspectorWidth = (nextWidth: number): void => {
    setInspectorWidth(clampInspectorWidth(nextWidth));
  };

  const updateInspectorWidthFromPointer = (clientX: number): void => {
    const body = workspaceBodyRef.current;
    if (body === null) {
      return;
    }
    const rect = body.getBoundingClientRect();
    setClampedInspectorWidth(rect.right - clientX);
  };

  const handleInspectorPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsInspectorResizing(true);
    updateInspectorWidthFromPointer(event.clientX);
    event.preventDefault();
  };

  const handleInspectorPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isInspectorResizing) {
      return;
    }
    updateInspectorWidthFromPointer(event.clientX);
  };

  const stopInspectorResizing = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsInspectorResizing(false);
  };

  const handleInspectorSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft") {
      setClampedInspectorWidth(inspectorWidth + INSPECTOR_KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      setClampedInspectorWidth(inspectorWidth - INSPECTOR_KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "Home") {
      setClampedInspectorWidth(INSPECTOR_MIN_WIDTH);
      event.preventDefault();
    } else if (event.key === "End") {
      setClampedInspectorWidth(INSPECTOR_MAX_WIDTH);
      event.preventDefault();
    }
  };

  return (
    <div
      className={
        activeInspector === null
          ? "workspace-body"
          : isInspectorResizing
            ? "workspace-body inspector-open resizing"
            : "workspace-body inspector-open"
      }
      ref={workspaceBodyRef}
      style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
    >
      <div className="primary-workspace">{children}</div>
      {activeInspector !== null ? (
        <div
          aria-label="Resize inspector pane"
          aria-orientation="vertical"
          aria-valuemax={inspectorMaxWidth()}
          aria-valuemin={INSPECTOR_MIN_WIDTH}
          aria-valuenow={Math.round(inspectorWidth)}
          className="workspace-resize-handle"
          onKeyDown={handleInspectorSeparatorKeyDown}
          onPointerCancel={stopInspectorResizing}
          onPointerDown={handleInspectorPointerDown}
          onPointerMove={handleInspectorPointerMove}
          onPointerUp={stopInspectorResizing}
          role="separator"
          tabIndex={0}
        />
      ) : null}
      {activeInspector !== null ? (
        <aside className="workspace-inspector" aria-label={inspectorLabel(activeInspector)}>
          {activeInspector === "diff" ? (
            <DiffViewer
              diff={diff}
              isLoading={isDiffLoading}
              scrollToFilePath={diffJump?.path ?? null}
              scrollToken={diffJump?.epoch ?? 0}
            />
          ) : (
            <CommandPanel
              entries={commandLog}
              isRunning={isCommandRunning}
              onInterrupt={onInterruptCommand}
            />
          )}
        </aside>
      ) : null}
    </div>
  );
}

function inspectorLabel(activeInspector: Exclude<ActiveInspector, null>): string {
  if (activeInspector === "diff") {
    return "Git diff";
  }
  return "Command output";
}
