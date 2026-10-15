# apps/extension/

Local rules for the WXT app. The module folders and their roles are `docs/spec/engineering.md` § TypeScript modules.

## Imports

- WXT auto-imports are off: import `browser` from `wxt/browser`, `defineBackground` and friends from `wxt/utils/…`, and `i18n` from `#i18n`.
- UI strings live in `locales/en.yml` and are read through `i18n.t(…)`.

## Boundaries and storage (`eslint.config.ts`)

- **Content side** (`src/autofill/`, the `content` and `inline-menu` entrypoints) imports only content-side code and the modules shared with content. That keeps out `background/`, `sources/`, `core-bindings/`, `settings/`, `ui/` and the other entrypoints.
- **Shared with content** (`src/protocol/`, `shared/`, `generator/`, `matching/`, `vendor/`) imports only each other. `import-x/no-restricted-paths` checks one import at a time, so this is what stops a re-export from carrying `background/` into the content bundle. A shared module that needs anything else is a design question: raise it, never add an exception.
- **Background**: only `background/` and the `background` entrypoint import `background/`. Everything else, `ui/` and the offscreen document included, talks to it through `protocol/` messages.
- Content-side and shared code never touches storage: any `.storage` property (destructuring included), the `storage` global, `wxt/utils/storage` and `@wxt-dev/storage` are errors there.
- The boundary rules count type-only imports too.
- Known gap: a property name computed at run time (`browser[key]`) escapes the storage rule.

## Svelte

- `rimlock/no-async-event-handler` (`eslint-rules/`) rejects an `on…` handler on an HTML element whose function returns a promise: typescript-eslint's `no-misused-promises` checks JSX only (`docs/spec/verification.md` V4). Handle the promise: `onclick={() => void save().catch(report)}`. Component props are not checked.

## Tests

- Vitest runs with `WxtVitest`: `browser` from `wxt/browser` is `fakeBrowser`, reset before every test (`tests/setup.ts`).
- **Lint fixtures** (`tests/lint/`): every lint rule above has a fixture that breaks it on purpose, and `rules.test.ts` asserts ESLint rejects it. `tests/lint/fixtures/` mirrors `src/` and runs `createConfig` from `eslint.config.ts` rooted there; the main `pnpm check` skips it. A new or changed rule gets its fixture and test in the same pull request.
- Vendored code (`src/vendor/`) is meant to be type-checked and boundary-checked but not reformatted or style-linted; the first vendored package sets up that ESLint override.
