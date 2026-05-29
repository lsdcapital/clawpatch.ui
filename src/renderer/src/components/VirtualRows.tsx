import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useReducer } from "react";
import type { ReactNode, RefObject } from "react";

// Lists shorter than this render every row directly; longer lists are
// windowed so we never mount thousands of DOM nodes (and so the per-command
// query invalidations don't re-render the whole list). The threshold keeps the
// common, small cases — and the test fixtures — on the simple code path.
export const VIRTUALIZE_THRESHOLD = 50;

// Windowed rows for the findings/review tables. Each row is measured after it
// mounts (`measureElement`), so it supports both the fixed-height findings rows
// and the variable-height feature rows that grow when expanded.
export function VirtualRows<T>({
  items,
  scrollRef,
  estimateSize,
  getKey,
  renderItem,
}: {
  items: readonly T[];
  scrollRef: RefObject<HTMLElement | null>;
  estimateSize: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 10,
    getItemKey: (index) => getKey(items[index], index),
  });

  // The virtualizer measures its scroll element in a layout effect and tries to
  // flush the first window with flushSync — which React ignores when called from
  // a layout effect, so the initial window never commits and the list shows up
  // empty until some other state change re-renders it. Force one render after
  // mount (a passive effect, after the measurement has been recorded) so the
  // first window appears without user interaction.
  const [, forceRenderAfterMount] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    forceRenderAfterMount();
  }, []);

  return (
    <div
      className="virtual-rows"
      style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          ref={virtualizer.measureElement}
          className="virtual-row"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          {renderItem(items[virtualItem.index], virtualItem.index)}
        </div>
      ))}
    </div>
  );
}
