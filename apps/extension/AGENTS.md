# apps/extension/

Local rules for the WXT app. The module folders and their roles are `docs/spec/engineering.md` § TypeScript modules.

## Imports

- WXT auto-imports are off: import `browser` from `wxt/browser`, `defineBackground` and friends from `wxt/utils/…`, and `i18n` from `#i18n`.
- UI strings live in `locales/en.yml` and are read through `i18n.t(…)`.

## Boundaries and storage

The rules are `docs/spec/engineering.md` § TypeScript modules; `eslint.config.ts` enforces them. What the rules alone do not tell you:

- They are allowlists, because `import-x/no-restricted-paths` checks one import at a time and any unlisted path would let a re-export through. A module shared with content that needs anything outside the list is a design question: raise it, never add an exception.
- Type-only imports count too.
- Known gap: a property name computed at run time (`browser[key]`) escapes the storage rule.

## Manifest

- `wxt.config.ts` holds the manifest; `tests/manifest/` builds both browsers and checks it against `docs/spec/manifest-and-permissions.md`.
- A browser API or manifest key that is new to the code is looked up in that file's § Browser floors. One newer than the floor raises `minimum_chrome_version`, the table and the test in the same pull request.

## Svelte

- `rimlock/no-async-event-handler` (`eslint-rules/`) rejects an `on…` handler on an HTML element whose function returns a promise: typescript-eslint's `no-misused-promises` checks JSX only (`docs/spec/verification.md` V4). Handle the promise: `onclick={() => void save().catch(report)}`. Component props are not checked.

## Tests

- Vitest runs with `WxtVitest`: `browser` from `wxt/browser` is `fakeBrowser`, reset before every test (`tests/setup.ts`).
- **Lint fixtures** (`tests/lint/`): every lint rule above has a fixture that breaks it on purpose, and `rules.test.ts` asserts ESLint rejects it. `tests/lint/fixtures/` mirrors `src/` and runs `createConfig` from `eslint.config.ts` rooted there; the main `pnpm check` skips it. A new or changed rule gets its fixture and test in the same pull request.
- Vendored code (`src/vendor/`) is meant to be type-checked and boundary-checked but not reformatted or style-linted; the first vendored package sets up that ESLint override.
- **End-to-end tests** (`tests/e2e/`, `pnpm test:e2e`, `vitest.e2e.config.ts`): the global setup builds the store bundle for both browsers and installs the pinned browsers (`tests/e2e/browsers.ts`); a test launches them through `launchWithExtension` and talks to the Extension only as a user's pages would, through its own pages and `protocol/` messages. Never add a test hook, flag or entrypoint to the bundle for a test (ADR-0017).
- `src/core-bindings/` holds wasm-bindgen output: never edit it. Change the Rust side, run `pnpm build:core` and commit the regenerated `*.d.ts`. Only `background/` imports it: only the background calls the Core (`docs/spec/core-api.md` § 1).
