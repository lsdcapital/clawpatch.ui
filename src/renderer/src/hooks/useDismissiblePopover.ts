import { useEffect, useRef } from "react";

interface UseDismissiblePopoverOptions {
  isOpen: boolean;
  onDismiss: () => void;
  dismissOnEscape?: boolean;
}

export function useDismissiblePopover<TElement extends HTMLElement>({
  isOpen,
  onDismiss,
  dismissOnEscape = true,
}: UseDismissiblePopoverOptions) {
  const containerRef = useRef<TElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent): void => {
      const containerElement = containerRef.current;

      if (containerElement === null || !(event.target instanceof Node)) {
        return;
      }

      if (!containerElement.contains(event.target)) {
        onDismiss();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);

    if (dismissOnEscape) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissOnEscape, isOpen, onDismiss]);

  return containerRef;
}
