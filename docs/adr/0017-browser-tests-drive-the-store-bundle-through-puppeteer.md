# Browser tests drive the store bundle through Puppeteer

End-to-end and autofill tests load the Extension into Chrome for Testing and Firefox, both pinned and headless, and drive them with Puppeteer (CDP for Chrome, WebDriver BiDi for Firefox), with Vitest as the runner. They load the same release bundle that goes to the stores. That bundle has no test hooks, no test build flavour and no flag-gated debug entrypoints: time is moved by fake clocks that Puppeteer installs in page contexts and by the shortest values the Settings schema allows, and anything that cannot be reached that way is tested one level down, where clocks are injected. Below the browser, the background is tested against `FakeCore` and `FakeSource`. A fake is allowed only together with a contract suite that runs the same tests against the fake and against the real implementation (the WASM Core; the WebDAV adapter against a Docker server matrix; the Chrome local-file adapter on OPFS handles), so a fake that drifts from reality fails a test instead of hiding a bug. Snapshots of third-party sites never enter the repository: the autofill suite in the repository is synthetic, and the live corpus is a list of URLs with expected labels, run by hand on every Proton bump, with each miss reduced to a synthetic fixture.

## Considered Options

- **Playwright.** Rejected: it loads extensions only in Chromium; its Firefox is a patched build that cannot run an MV3 Extension, so Firefox would need a second tool. Puppeteer already ran a real MV3 content script in both browsers in [Compare form-detection engines: Proton classifier vs Bitwarden heuristics](https://github.com/maxdubmors/rimlock/issues/17) and [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24).
- **WebdriverIO with chromedriver and geckodriver.** Rejected: both browsers work, but it brings a heavier, separate ecosystem for no capability Puppeteer lacks here.
- **A test build flavour with hooks** (fake clock, state injection behind `import.meta.env.TEST`). Rejected: the tested bundle would differ from the shipped one, and build-only failures (CSP, WASM loading, minification) would escape. Hooks in the shipped build are attack surface.
- **Real WASM in every TypeScript test.** Rejected: TypeScript-only work would need a Rust toolchain, and the fast tier would slow down.
- **Committing the 62 MB of live-page snapshots, or keeping them in Git LFS.** Rejected: it redistributes other sites' copyrighted pages in a GPL repository.

## Consequences

- Where Firefox's BiDi support is narrower than CDP, a scenario that cannot be expressed goes to the manual pre-release checklist; it does not bring in a second tool.
- Picker-based flows cannot be automated (`showOpenFilePicker` is not interceptable), so adding a Database in end-to-end tests goes through WebDAV in Chrome and import `<input type=file>` in Firefox; the File System Access permission lifecycle stays on the manual checklist. Until M1's add flow exists, the M0 walking skeleton adds a Database through `<input type=file>` in both browsers ([`plan.md`](../spec/plan.md) § M0).
- The wake-up rebuild criterion of ADR-0005 is measured in the same harness on the store bundle.
- Decision detail: [Decide the testing strategy](https://github.com/maxdubmors/rimlock/issues/33).
