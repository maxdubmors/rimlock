// Stands in for tests/build-bundle.ts.
export type BrowserName = 'chrome' | 'firefox';

export function buildBundle(browser: BrowserName): string {
  return browser;
}
