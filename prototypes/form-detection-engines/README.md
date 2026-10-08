# Form-detection engine comparison (throwaway)

Evidence for [Compare form-detection engines: Proton classifier vs Bitwarden heuristics](https://github.com/maxdubmors/rimlock/issues/17). Findings: [`docs/research/form-detection-engines.md`](../../docs/research/form-detection-engines.md). Not production code.

- `engines/bitwarden.ts`: Bitwarden's `CollectAutofillContentService`, `DomQueryService`, `DomElementVisibilityService` and `InlineMenuFieldQualificationService`, lifted unmodified from `bitwarden/clients@5ea9cb2` (fetched by `fetch-bitwarden.sh` into `vendor/`). It replays the inline menu's per-field decision (`AutofillOverlayContentService.isIgnoredField` and the `setQualified*FillType` helpers). `engines/shims/` replaces the one module that would drag in the rest of the extension, and `bitwarden-shim.ts` answers `chrome.runtime.sendMessage` (no targeting rules, premium on).
- `engines/proton.ts`: `@protontech/autofill@0.0.38040317` (MPL-2.0, npm) with the bundled random-forest model, driven the way Proton's `detector.service.ts` does it. `toLabel` mirrors Proton's `FORM_TRACKER_CONFIG`.
- Both map onto one label set (`engines/types.ts`): `username`, `current-password`, `new-password`, `signup-username`, `otp`, or nothing.
- `build.mjs`: bundles each engine into an IIFE with esbuild and prints its size.
- `stamp.js`: injected into every frame first. It numbers every `<input>` (including in open shadow roots) in a page-side map, records a field summary, and removes fixture ground truth (`data-gt`) so neither engine can read it.
- `run.mjs`: loads each corpus page in Chrome for Testing (headless, fresh context per page), runs `stamp.js`, then Bitwarden, then Proton in every http(s) frame, and writes `results/raw/<page>.json` and a screenshot. Live pages are also saved as MHTML in `snapshots/` (gitignored: third-party content).
- `score.mjs`: compares the results with ground truth and writes `results/scores.md`. Only fields visible at capture time are scored.
- `fields.mjs`: prints live pages' visible fields, used to write `corpus/labels.json` by hand. `debug.mjs <url> [bitwarden|proton]`: per-field trace of either engine.
- `corpus/fixtures/`: synthetic pages for the hard cases, with ground truth inline. `corpus/sites.json`: the live pages. `corpus/labels.json`: hand labels for them.

Run:

```sh
pnpm install
./fetch-bitwarden.sh
npx @puppeteer/browsers install chrome@stable --path $PWD/.chrome
export CHROME=$(ls $PWD/.chrome/chrome/linux-*/chrome-linux64/chrome)
node build.mjs && node run.mjs && node score.mjs
npx tsc -p .   # strict type-check of both wrappers: the Bitwarden type closure
```

Caveat: the engines run in the page's main world through CDP, not in a content script's isolated world. Same DOM, but `chrome.dom.openOrClosedShadowRoot` is unavailable, so closed shadow roots are out of scope here.

## Shadow-root check

Evidence for [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24). Findings: [`docs/research/proton-shadow-roots.md`](../../docs/research/proton-shadow-roots.md).

- `engines/proton-walk.ts`: Proton fed every root (`protonWalk`), and the same plus rimlock's lone-field cluster flag and cross-root grouping (`protonGroup`). Public package exports only; nothing patched.
- `ext/`: a throwaway MV3 extension whose content script (isolated world) stamps fields, opens closed roots and runs one variant per page load on request (`rl-run` / `rl-result` CustomEvents).
- `make-shadow-fixtures.mjs`: writes `corpus/fixtures/shadow-*.html` and `corpus/fixtures-shadow.txt`.
- `run-ext.mjs <chrome|firefox> <fixtures|shadow-live|live>`: loads `ext/` into Chrome for Testing or Firefox and writes `results/shadow/<browser>/`. `score-shadow.mjs <browser> <fixtures|live>` writes `results/shadow/scores-*.md`. `trace.mjs <fixture|url>`: per-root trace of why a field got no type.

```sh
npx -p @puppeteer/browsers browsers install firefox@stable --path $PWD/.firefox
node make-shadow-fixtures.mjs && node build-ext.mjs
node run-ext.mjs chrome fixtures && node score-shadow.mjs chrome fixtures
```
