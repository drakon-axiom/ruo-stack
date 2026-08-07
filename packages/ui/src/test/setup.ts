import '@testing-library/jest-dom/vitest';

// jsdom ships no matchMedia; ThemeProvider and useMediaQuery both depend on it.
// Individual tests override this to simulate a viewport.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}
