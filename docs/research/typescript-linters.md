# TypeScript linters: ESLint, Biome and oxlint

Research for ticket [#37](https://github.com/maxdubmors/rimlock/issues/37). Researched 2026-10-14. Feeds the decision in [#32](https://github.com/maxdubmors/rimlock/issues/32); this document does not make that choice.

## Question

Which TypeScript linter (and formatter) should the Extension use: ESLint with `typescript-eslint`, Biome, or oxlint (alone or alongside ESLint)? The answer must cover type-aware rules (including TypeScript 7 / `tsgo`), Svelte 5, per-directory import boundaries plus a `storage` ban in content-script code, the formatter, maintenance, and hybrid setups.

## Summary

- **TypeScript 7.0.2 is `latest` on npm (released 2026-07-08), but it ships no programmatic API.** typescript-eslint 8.71.2 declares `typescript >=4.8.4 <6.1.0` and throws "typescript-eslint does not support TS 7.0" when TS 7 is installed (verified). The documented workaround runs TS 6 side by side (`typescript` aliased to `@typescript/typescript6`). TS 7.1 is planned to stabilise an API (stable target 2026-11-24, beta was planned for 2026-10-06 but no 7.1 beta is on npm today). typescript-eslint's TS 7.1 support is a draft PR.
- **The Svelte toolchain is pinned to TS 6 regardless of the linter.** `svelte-check` 4.7.6 and `svelte2tsx` declare `typescript ^5 || ^6`, and the TS 7 announcement says Svelte workflows should "stay on TypeScript 6.0" for now. So a TS 6 dependency exists in the repo whichever linter is chosen.
- **oxlint's type-aware mode (tsgolint 7.0.2004) is declared stable (2026-07-22), uses TS 7 internally, and implements every type-aware rule the ticket names.** In the scratch test it caught the floating promise, the non-exhaustive `switch`, the string condition and the `Secret` interpolation in `.ts`. It does **not** run type-aware rules in `.svelte` files (it lints only `<script>` blocks, syntactically) and has no template linting.
- **Biome 2.5.15's type rules use its own inference, not `tsc`, so the TS version does not matter, but they are all nursery (experimental).** It caught the floating promise, the non-exhaustive `switch` and the `Secret` interpolation (via `noBaseToString`) in `.ts`. It caught **no** type-aware issue inside `.svelte`, even with full HTML support enabled. Its Svelte support (parse, format, lint) is labelled experimental.
- **ESLint 10.12 + typescript-eslint + eslint-plugin-svelte was the only setup that caught every planted issue, including type-aware ones inside `.svelte` scripts and the template** (12 of 12 in the sample). It is also the slowest (~0.8 s vs ~0.1 s for oxlint and ~0.05 s for Biome on the tiny sample) and is the one blocked on TS 7.
- **All three can express the module boundaries and the `storage` ban with config overrides.** `no-restricted-imports` (regex or glob patterns) per directory works in all three. For `browser.storage`: ESLint and oxlint have `no-restricted-properties` (catches destructuring too). Biome has no such rule and needs a GritQL plugin, which can be scoped per override and caught member access but not destructuring in the test. All three have `no-restricted-globals` for WXT's auto-imported `storage`.
- **Formatter:** oxfmt 0.73 (beta since 2026-02-24) formats `.svelte` through a bundled `prettier-plugin-svelte`. Its output was byte-identical to Prettier 3.9.10 + `prettier-plugin-svelte` 4.1.1 on the sample. Biome's experimental Svelte formatter produced different output (no script indentation, tabs by default, block layout of `{#if}`).
- **Hybrid oxlint + ESLint works but has a trap:** `eslint-plugin-oxlint` turns the overlapping rules off in ESLint for **all** files. That silently disabled the type-aware rules in `.svelte`, where oxlint doesn't run them (verified). Scoping the overlay to `**/*.ts` fixes this but produced a duplicate report from both tools for the same import in a `.svelte` file. oxlint honours `eslint-disable` comments with `@typescript-eslint/` rule names, so one suppression comment serves both tools.

## Findings

### 1. Type-aware rules and TypeScript 7 / `tsgo`

**State of TypeScript (checked on npm, 2026-10-14)**
- `typescript` dist-tags: `latest` 7.0.2 (published 2026-07-08), `next` 7.1.0-dev.20261014.1. TS 6.0.3 was published 2026-04-16 ([npm](https://www.npmjs.com/package/typescript)).
- "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API." Tools that need the compiler API (named example: typescript-eslint) should keep using TS 6. The new `@typescript/typescript6` package re-exports the 6.0 API and a `tsc6` binary, and the post recommends aliasing `typescript` to it. Vue, MDX, Astro and **Svelte** workflows "stay on TypeScript 6.0" for now ([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
- TS 7.1 iteration plan: beta 2026-10-06, RC 2026-11-10, stable 2026-11-24. The first item is "Stabilize API" (Content Mapper, Emit, Language Service APIs) ([microsoft/TypeScript#63703](https://github.com/microsoft/TypeScript/issues/63703)). No `7.1.0-beta` was on npm on 2026-10-14, so the beta has slipped.
- The TS 7 package's main export exposes only `version`. Its other exports are `./unstable/*` paths (from `npm view typescript@7.0.2 exports`).

**ESLint + typescript-eslint**
- typescript-eslint 8.71.2 (2026-10-12) declares `typescript: ">=4.8.4 <6.1.0"` and `eslint: "^8.57.0 || ^9.0.0 || ^10.0.0"` ([npm](https://www.npmjs.com/package/typescript-eslint)).
- The TS 7 support request was closed as not planned/duplicate on 2026-07-08. A maintainer said it "isn't compatible with TS 7 at this time, because there is no TS 7 API" and pointed to the side-by-side setup ([typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518)).
- Tracking issue [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) is open. Latest status (2026-09-29, JoshuaKGoldberg): TS 7.1 support "is looking more and more stable". It is in draft PR [#12803](https://github.com/typescript-eslint/typescript-eslint/pull/12803), "add projectService.EXPERIMENTAL_backend for TypeScript 7.1 native parser support over IPC". He adds: "we're not expecting performance to be significantly better with TS7 than TS6 at least for this initial IPC-based version."
- Rules the ticket names all exist in typescript-eslint: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `no-unsafe-*`, `strict-boolean-expressions` and `restrict-template-expressions`.

**oxlint + tsgolint**
- tsgolint "executes lint rules that require TypeScript semantic analysis, using typescript-go" and "targets TypeScript 7". Its version encodes the TS version: `7.0.2004` = TS 7.0.2, tsgolint patch 004. Its README says it is "stable" ([oxc-project/tsgolint](https://github.com/oxc-project/tsgolint)). The stable announcement is dated 2026-07-22 and "tracks TypeScript v7.0.2" ([Oxc blog](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable)).
- Coverage: the README checklist marks 60 of 62 targeted rules implemented. Only `naming-convention` and `prefer-destructuring` are missing. Every rule named in the ticket is checked, including all `no-unsafe-*`, `strict-boolean-expressions`, `restrict-template-expressions` and `switch-exhaustiveness-check`. `oxlint --rules -f json` (1.88.0) lists 871 rules, 60 of them `type_aware`.
- Requirements and limits: "TypeScript 7.0+ is required". Legacy options such as `baseUrl` are unsupported, and options deprecated in 6.0 or removed in 7.0 must be migrated. `typeAware`/`typeCheck` are root-config only. "Rule coverage is incomplete (but very close)", and "very large codebases may encounter high memory usage". `--type-check` also reports TS errors and "can replace a separate tsc --noEmit step in CI" ([Type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html)).
- WXT's generated `tsconfig.json` (on `wxt-dev/wxt` main) uses `moduleResolution: 'Bundler'`, `module: 'Preserve'` and `paths`, with no `baseUrl` ([generate-wxt-dir.ts](https://github.com/wxt-dev/wxt/blob/main/packages/wxt/src/internal/generate-wxt-dir.ts)). It contains nothing tsgolint is documented to reject.
- tsgolint ships its own Go binary (per-platform `@oxlint-tsgolint/*` packages). In the scratch test it worked while the project's `typescript` package was 6.0.3, so it does not depend on the installed `typescript`.

**Biome**
- Biome 2 introduced "type-aware linting rules that doesn't rely on the TypeScript compiler". Early testing found `noFloatingPromises` catches "about 75% of the cases that would be detected by using `typescript-eslint`", and the authors add "your mileage may vary" ([Biome v2 blog](https://biomejs.dev/blog/biome-v2/)). The inference work was sponsored by Vercel ([blog](https://biomejs.dev/blog/vercel-partners-biome-type-inference/)).
- In 2.5.15, the relevant rules are all in **nursery** ("experimental and the behavior can change at any time"): `noFloatingPromises` (since 2.0.0), `noMisusedPromises`, `useExhaustiveSwitchCases`, `useStrictBooleanExpressions` (since **2.5.15**, two weeks old), `noBaseToString` and `noUnsafeTypeAssertion` ([rules list](https://biomejs.dev/linter/javascript/rules/), [noFloatingPromises](https://biomejs.dev/linter/rules/no-floating-promises/), `biome explain`).
- There is no `restrict-template-expressions` equivalent. `noBaseToString` covers the "object would print as `[object Object]`" case only. There is no `no-unsafe-assignment`/`-member-access`/`-call`/`-return`/`-argument` family.
- `useStrictBooleanExpressions` has different semantics from typescript-eslint: it "allows booleans, non-nullable strings and numbers", and "Types that cannot be inferred are ignored" (`biome explain`). So `if (name)` on a `string` passes.
- Because Biome does not use `tsc`, the TS 7 question does not apply to it. The flip side is that its inference is a separate implementation of TS semantics.

**Hands-on (scratch project, 2026-10-14, outside the repo)**

Setup: Node 26.11.1, npm 12.2.0. ESLint 10.12.0, typescript-eslint 8.71.2, eslint-plugin-svelte 3.23.1, svelte-eslint-parser 1.9.0, Svelte 5.57.2, TypeScript 6.0.3. oxlint 1.88.0 + oxlint-tsgolint 7.0.2004. Biome 2.5.15 with `html.experimentalFullSupportEnabled`. Sample: `src/autofill/fill.ts` and `src/autofill/App.svelte` (`<script lang="ts">`, `$props`, `$state`), each with a restricted import of `../background/vault`, a non-exhaustive `switch` over a `CoreResult`-like union, a floating promise, `browser.storage.local.get(...)`, a `string` used as a condition (`.ts` only) and `` `${secret}` `` where `secret: Secret` (a class). Each rule was set to `error`, and `strict-boolean-expressions` used `allowString: false`.

| Planted issue | ESLint (.ts / .svelte) | oxlint (.ts / .svelte) | Biome (.ts / .svelte) |
|---|---|---|---|
| Restricted import `../background/vault` | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Non-exhaustive `switch` | ✔ / ✔ | ✔ / ✘ | ✔ / ✘ |
| Floating promise | ✔ / ✔ (2 of 2) | ✔ / ✘ | ✔ / ✘ |
| `browser.storage` access | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ (Grit plugin) |
| `string` as condition | ✔ / n.a. | ✔ / n.a. | ✘ by design / n.a. |
| `Secret` in a template literal | ✔ / ✔ (in the Svelte **template**) | ✔ / ✘ | ✔ (`noBaseToString`) / ✘ |

- A second `.svelte` file with a local `async` function and a local union (no cross-file types) gave the same picture: ESLint reported both issues, while oxlint and Biome reported nothing.
- `no-misused-promises` / `noMisusedPromises` did not flag `onclick={asyncHandler}` in Svelte in either ESLint or Biome. The cause was not investigated (Svelte's handler type may not be `void`-returning).
- With `typescript@7.0.2` installed, ESLint stopped with `Error: typescript-eslint does not support TS 7.0` and a link to the side-by-side instructions. With `typescript` aliased to `npm:@typescript/typescript6@^6.0.2` and `@typescript/native` aliased to `npm:typescript@^7.0.2`, ESLint worked again, `tsc` reported 7.0.2, `tsc6` reported 6.0.3 and `svelte-check` passed (0 errors).
- Wall time on the 7-file sample (3 runs each, warm): ESLint 819–860 ms, oxlint 110–116 ms, Biome 50–54 ms. On a sample this small, this mostly measures startup. tsgolint's published benchmarks claim a 12–18× speedup over ESLint + typescript-eslint on large repos (Apple M4 Pro) ([tsgolint README](https://github.com/oxc-project/tsgolint)). No benchmark was run on rimlock-sized code because the repo has no TS yet.

### 2. Svelte 5

**ESLint (eslint-plugin-svelte)**
- eslint-plugin-svelte 3.23.1 (2026-10-09) peers `eslint ^8.57.1 || ^9 || ^10` and `svelte ^3.37 || ^4 || ^5`. The repo has ~85 rule implementations. Type-aware TS is set up with `parserOptions.projectService: true`, `extraFileExtensions: ['.svelte']` and `parser: ts.parser` for `**/*.svelte`, `**/*.svelte.ts` and `**/*.svelte.js` ([user guide](https://sveltejs.github.io/eslint-plugin-svelte/user-guide/)).
- Documented limitations: types of **imported `.svelte` components** may not resolve (an experimental `typescript-eslint-parser-for-extra-files` is suggested). `settings.svelte.ignoreWarnings` exists for template false positives of `no-unsafe-assignment`/`no-unsafe-member-access`. `--cache` breaks with non-serialisable `svelteConfig` ([user guide](https://sveltejs.github.io/eslint-plugin-svelte/user-guide/)).
- Verified: type-aware rules ran inside `<script lang="ts">` with runes, and `restrict-template-expressions` fired on an expression in the **markup**. `svelte/no-at-html-tags` flagged `{@html}`.

**oxlint**
- "Framework files (`.vue`, `.svelte`, `.astro`) [are linted] by linting only their `<script>` blocks" ([Linter guide](https://oxc.rs/docs/guide/usage/linter.html)). The compatibility matrix footnote reads "Vue, Svelte, ... : No template linting yet" ([compatibility](https://oxc.rs/compatibility.html)). oxlint 1.88.0 has a `vue` rule scope (46 rules) and **no** `svelte` scope.
- JS plugins (ESLint-compatible, **alpha**) list "Custom file formats and parsers (e.g. Svelte, Vue, Angular)" and type-aware rules as "Not supported yet" ([JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)). So eslint-plugin-svelte cannot run inside oxlint.
- Verified: syntactic rules (restricted import, `browser.storage`) fired in the `.svelte` script. Type-aware rules did not.

**Biome**
- Support matrix: Svelte parsing, formatting and linting are all 🟡 "Experimental", and plugin support is 🚫. Full support is opt-in via `html.experimentalFullSupportEnabled`. Linting "may flag some false positives" ([Language support](https://biomejs.dev/internals/language-support/)).
- Biome's 2026 roadmap acknowledges "poor support of the Svelte files" at the 2.3 announcement and plans to "enhance existing lint rules so that they work for HTML-ish languages too, notably Vue, Svelte, and Astro" ([Roadmap 2026](https://biomejs.dev/blog/roadmap-2026/)).
- 2.5.x adds Svelte-specific nursery rules in a `svelte` domain: `noSvelteAtHtmlTags` (since 2.5.11), `noSvelteAtDebugTags`, `noSvelteExportLet`, `noSvelteLegacyConst`, `noSvelteUnnecessaryStateWrap`, `useSvelteRequireEachKey` and `useSvelteKitRuneImports` (from the 2.5.15 config schema). Verified: `noSvelteAtHtmlTags` flagged `{@html}`.
- Verified: no type-aware diagnostic in `.svelte`, even for purely local types.

**Type-checking `.svelte` stays separate in every option.** `svelte-check` 4.7.6 peers `typescript ^5 || ^6` ([npm](https://www.npmjs.com/package/svelte-check)). oxlint's `--type-check` covers TS files only.

### 3. Module boundaries and the `storage` ban

What the Extension needs: files under `autofill/` and the content entrypoints (WXT names them `entrypoints/*.content.ts` or `entrypoints/*.content/`) must not import `background/`, `sources/`, `core-bindings/` or `settings/`, and must not touch extension storage. In WXT, storage arrives in four ways: `browser.storage` / `chrome.storage`; WXT's wrapper via `import { storage } from '#imports'` (or `@wxt-dev/storage`); and, with auto-imports on, `storage` as an undeclared global ([WXT storage](https://wxt.dev/storage), [auto-imports](https://wxt.dev/guide/essentials/config/auto-imports.html)).

| Mechanism | ESLint | oxlint | Biome |
|---|---|---|---|
| Per-directory scope | flat-config `files` globs | `overrides[].files` | `overrides[].includes` |
| Import restriction | `no-restricted-imports` (`patterns` with `group` or `regex`, `importNames`) | `no-restricted-imports` (same options; `regex` verified) | `style/noRestrictedImports` (`paths` + `patterns.group` globs, `importNames`) |
| `browser.storage` member access | `no-restricted-properties` (catches destructuring, verified) or `no-restricted-syntax` selectors | `no-restricted-properties` (catches destructuring, verified). **No `no-restricted-syntax`** | No equivalent rule. A GritQL plugin works and can be listed in `overrides[].plugins` (verified). The pattern tried caught `browser.storage.local.get` but not `const { storage } = browser` |
| Auto-imported `storage` global | `no-restricted-globals` (verified) | `no-restricted-globals` (verified) | `style/noRestrictedGlobals` (verified) |
| Resolver-aware boundaries (by resolved file, not specifier string) | `eslint-plugin-boundaries` 7.2.0, `import-x/no-restricted-paths` | `import` plugin has no `no-restricted-paths` in 1.88 | none found |
| Custom rules | JS rules, full API | JS plugins (alpha), no custom parsers, no type info | GritQL plugins (diagnostics, code fixes since 2.5) |

- Pattern-based restrictions match the **specifier string**. A regex such as `(^|/)(background|sources|core-bindings|settings)(/|$)` catches relative paths and `@/` aliases, but not a re-export through an allowed module. Catching that needs a resolver-aware plugin (ESLint only) or a layout where those folders are separate packages.
- Biome's `noRestrictedImports` default severity is `warn`, and the override sets it to `error`. Its pattern syntax is gitignore-style (`group`), not regex. The pattern `**/background/**` matched `../background/vault`.
- Disabling WXT auto-imports (`imports: false`) and importing from `#imports` explicitly turns the global case into an import restriction (`importNames: ['storage']`), which all three support per their docs. That case was not tested hands-on.

### 4. Formatter

| | Prettier 3.9.10 + prettier-plugin-svelte 4.1.1 | oxfmt 0.73.0 | Biome 2.5.15 |
|---|---|---|---|
| Status | Stable. Plugin last released 2026-06-15 | **Beta** since 2026-02-24 ([Oxfmt Beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta)). Still 0.x | Formatter stable for JS/TS. Svelte **experimental** |
| Svelte | Via plugin (peers `prettier ^3`, `svelte ^5`) | Via a **bundled** `prettier-plugin-svelte`. Needs `svelte` installed and `"svelte": true` in `.oxfmtrc.json`. Svelte is "Prettier-backed" and needs Node (not the standalone binary). `<script>` contents are formatted natively ([Language support](https://oxc.rs/docs/guide/usage/formatter/language-support.html), config schema) | Needs `html.experimentalFullSupportEnabled` + `html.formatter.enabled` |
| JS/TS fidelity | reference | "passes 100% of Prettier's JavaScript and TypeScript conformance tests" ([Oxfmt Beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta)) | own style, Prettier-compatible by intent |
| Extras | plugins | import sorting, Tailwind class sorting, `package.json` sorting built in; `oxfmt --migrate prettier` | import organiser (assist) |

Verified on one `.svelte` file (runes, `{#if}`, `<style>`): oxfmt output was **byte-identical** to Prettier + `prettier-plugin-svelte`. Biome reformatted the script and markup differently. It did not indent `<script>`/`<style>` contents, used tabs (its default) and split `{#if}…{:else}…{/if}` into indented blocks. The Biome 2.5 blog lists HTML parser work among open contribution areas, and the roadmap aims to make HTML formatting "match Prettier's as much as possible" ([Roadmap 2026](https://biomejs.dev/blog/roadmap-2026/)).

### 5. Maintenance and maturity

All data from the GitHub API and npm on 2026-10-14.

| | Licence | Stars | Latest release | Cadence | Notes |
|---|---|---|---|---|---|
| ESLint (`eslint/eslint`) | MIT | 27.6k | v10.12.0, 2026-10-02 | minor every ~2 weeks (10.0 → 10.12 since 2026-02-06) | v10 removed eslintrc entirely, needs Node ≥ 20.19, and looks up `eslint.config.*` from each linted file's directory ([v10 release](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/)) |
| typescript-eslint | MIT | 16.4k | v8.71.2, 2026-10-12 | weekly | Blocked on the TS 7.1 API (above) |
| eslint-plugin-svelte (`sveltejs`) | MIT | 408 | 3.23.1, 2026-10-09 | frequent | Official Svelte org |
| oxlint (`oxc-project/oxc`) | MIT | 23.0k | oxlint 1.88.0, 2026-10-13 | **weekly minors** (1.0.0 on 2025-06-10, 1.88 now) | Part of VoidZero's toolchain ([README](https://github.com/oxc-project/oxc)). 1,025 open issues+PRs (monorepo incl. parser, transformer, minifier). Config `.oxlintrc.json`; JS/TS config files "experimental" (`oxlint --help`) |
| tsgolint | MIT | 1.5k | v7.0.2004, 2026-10-10 | follows TS releases | Tied to a specific TS version by design |
| oxfmt | MIT | (oxc repo) | 0.73.0, 2026-10-13 | weekly | Beta |
| Biome (`biomejs/biome`) | MIT OR Apache-2.0 | 26.0k | 2.5.15, 2026-09-30 | patches ~weekly, minors every 2–4 months (2.0 2025-06-17 … 2.5 2026-06-12) | Community-run, sponsor-funded (Depot platinum) ([README](https://github.com/biomejs/biome)). `biome migrate` for config changes |
| Prettier | MIT | 52.5k | 3.9.10, 2026-10-10 | frequent patches | reference formatter |
| prettier-plugin-svelte | MIT | 814 | 4.1.1, 2026-06-15 | slower | Official Svelte org |

All licences are permissive and compatible with GPL-3.0 dev tooling. None of these tools ships in the Extension bundle.

Editor integration: every tool has an LSP / VS Code extension (ESLint's `vscode-eslint`, oxc's VS Code extension with a `typeAware` option per the type-aware docs, and Biome's extension). Not tested hands-on.

### 6. Hybrid setups

**oxlint + ESLint via `eslint-plugin-oxlint`** (1.88.0, released in lockstep with oxlint). The README recommends `"lint": "oxlint && eslint"` and appending `oxlint.configs['flat/recommended']` or `buildFromConfigFile('./.oxlintrc.json')` last in `eslint.config.js` to "turn off all rules already supported by oxlint" ([README](https://github.com/oxc-project/eslint-plugin-oxlint)).

Verified in the scratch project:
- **Gap:** with `buildFromConfigFile` appended as documented, `eslint --print-config App.svelte` showed `no-floating-promises`, `switch-exhaustiveness-check`, `restrict-template-expressions` and `no-restricted-imports` all set to `0`. The ESLint run then reported only the `no-restricted-syntax` storage hit. **Every type-aware check in `.svelte` was lost**, because oxlint does not run those rules there either.
- **Fix:** mapping the overlay to `files: ['**/*.ts']` restored the `.svelte` checks (6 reports in `App.svelte`). But `no-restricted-imports` in `App.svelte` was then reported by **both** oxlint and ESLint.
- **Cost:** typescript-eslint still builds a TS 6 program for `.ts` files when they share a project service with `.svelte`, even with the rules off. That was not measured.
- **Shared suppressions:** oxlint honoured `// eslint-disable-next-line @typescript-eslint/no-floating-promises`, so one comment silences both tools.

Implications for agent-written code (observations, not measured):
- Two config files with different rule naming (`typescript/no-floating-promises` vs `@typescript-eslint/no-floating-promises`).
- Two output formats.
- Two type-checker versions: tsgolint uses TS 7.0.2 semantics, while typescript-eslint and `svelte-check` use TS 6.
- A rule that is "on" in one tool can be "off" in the other without any error.
- A drift test (e.g. `eslint --print-config` on a `.svelte` file in CI) would be needed to keep the split honest.

Other hybrids:
- **Biome (format + syntactic lint) + ESLint (type-aware + Svelte):** no official overlay plugin was looked for. Same duplication/gap concerns.
- **oxlint + oxfmt** is the "single vendor" counterpart to Biome. It still needs ESLint or `svelte-check`-only coverage for `.svelte` type rules.

## Comparison

| Criterion | ESLint + typescript-eslint + eslint-plugin-svelte | oxlint + tsgolint | Biome 2.5 |
|---|---|---|---|
| Named type-aware rules, `.ts` | All, mature | All (60/62 typescript-eslint type rules), stable since 2026-07 | Partial, all nursery. No `no-unsafe-*` family, no `restrict-template-expressions` (`noBaseToString` partially covers it). `useStrictBooleanExpressions` is laxer |
| Type-aware rules in `.svelte` | Yes (script and template, verified) | No | No |
| Svelte-specific rules | ~85 (official plugin) | None | 7 nursery rules |
| TypeScript 7 | Not supported. Needs the TS 6 alias. TS 7.1 support is a draft PR | Requires TS 7 semantics (bundled) | Independent of `tsc` |
| Import boundaries per directory | Yes, plus resolver-aware plugins | Yes (specifier patterns) | Yes (glob patterns) |
| `browser.storage` ban | `no-restricted-properties` / `no-restricted-syntax` | `no-restricted-properties` | GritQL plugin (per override) |
| Formatter pairing | Prettier + plugin, or oxfmt | oxfmt (Svelte via bundled Prettier plugin; matched Prettier on the sample) | Built in, Svelte experimental, differs from Prettier |
| Speed (tiny sample) | ~0.8 s | ~0.1 s | ~0.05 s |
| Maturity risk | Low, but the TS 7 transition is pending | Linter stable. JS plugins alpha. oxfmt beta | Svelte and type rules experimental |

## Open questions

1. **When does typescript-eslint support TS 7.1, and at what cost?** The TS 7.1 beta was planned for 2026-10-06 but was not on npm on 2026-10-14. typescript-eslint's PR #12803 is a draft behind an `EXPERIMENTAL_backend` flag. Until both land, an ESLint-based setup needs the `@typescript/typescript6` alias. Since `svelte-check` needs TS 6 anyway, the extra cost may be small. It was not verified that WXT itself is fine with `typescript` aliased to the TS 6 package.
2. **Will oxlint or Biome get type-aware linting inside `.svelte`?** Neither project documents a plan for Svelte specifically. Biome's 2026 roadmap targets HTML-ish languages in general. oxlint's JS plugins exclude custom parsers "for now".
3. **How much of the Extension's risky code will live in `.svelte` files?** If messaging, `CoreResult` handling and `Secret` handling are kept in `.ts` modules and components stay thin, oxlint's `.ts`-only type coverage loses less. Whether that convention is enforceable (e.g. a size or "no `async` in components" rule) was not examined.
4. **Two checkers, two TS versions.** With oxlint, tsgolint checks `.ts` under TS 7.0.2 while `svelte-check` checks `.svelte` under TS 6. Divergent diagnostics between the two were not looked for.
5. **Imported `.svelte` component types in type-aware rules.** eslint-plugin-svelte documents that these may not resolve. The sample did not import a component into `.ts`, so the effect on, e.g., `no-unsafe-*` rules was not tested in any tool.
6. **Resolver-aware boundaries.** If re-exports through allowed modules are a real risk, only ESLint has mature resolver-aware boundary plugins (`eslint-plugin-boundaries`, `import-x/no-restricted-paths`), and they were not tested. Splitting privileged code into separate pnpm packages (a #32 layout question) would make plain import restrictions sufficient in every tool.
7. **`no-misused-promises` on Svelte event attributes** (`onclick={async () => …}`) fired in neither ESLint nor Biome. Whether that is a gap worth a custom rule was not investigated.
8. **Biome GritQL coverage of destructuring** (`const { storage } = browser`). The plugin pattern tried did not catch it. A better pattern may exist.
9. **Editor and LSP behaviour** for all three, including oxlint's `typeAware` in the editor and ESLint's TS 6 alias inside VS Code, was not tested.
10. **Performance on the real repo.** The timings above are startup-dominated. tsgolint's own benchmarks cover large repos only.
