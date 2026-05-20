import "@testing-library/jest-dom/vitest";

process.env["LOG_LEVEL"] ??= "silent";

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    TestIntersectionObserver as unknown as typeof IntersectionObserver;
}
