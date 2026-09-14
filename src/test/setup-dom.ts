/** Test setup. A no-op under the Node environment; the DOM smoke tests get the
 *  pieces jsdom lacks but Chart.js needs — a canvas 2d context and a layout box.
 *  Stubbing those lets the tests exercise the real chart components rather than
 *  mocking them away: the ChartFrame around each chart is ordinary DOM, and that
 *  is what the assertions actually check. */

if (typeof window !== 'undefined') {
  await import('vitest-canvas-mock');

  // findBy* and waitFor give up after 1 second by default. With four jsdom workers
  // rendering whole pages at once, a busy machine sometimes needs longer — a
  // different page each run, never a real failure. Genuinely missing elements still
  // fail, just after a longer wait.
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 8000 });

  // jsdom reports every element as 0×0; Chart.js bails out of rendering at that size.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 240 });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width: 600, height: 240, top: 0, left: 0, right: 600, bottom: 240, x: 0, y: 0, toJSON: () => ({}) };
  };

  // Chart.js observes its container for resize; jsdom ships no implementation.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  // Radix and the theme hook both read matchMedia.
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
