# Form-detection engines: Proton classifier vs Bitwarden heuristics

Ticket: [Compare form-detection engines: Proton classifier vs Bitwarden heuristics](https://github.com/maxdubmors/rimlock/issues/17). It measures the two reuse candidates named in [Autofill engine prior art](https://github.com/maxdubmors/rimlock/issues/5) (`research/autofill-prior-art`, §6 and Open risks) and feeds [Decide the autofill approach](https://github.com/maxdubmors/rimlock/issues/15). It does not make that decision.

**Setup.** Chrome for Testing 155.0.8059.39, headless, Linux, 2026-10-07. Harness, corpus, labels and raw results: [`prototypes/form-detection-engines/`](../../prototypes/form-detection-engines/).

| Engine | Source | License |
|---|---|---|
| Bitwarden heuristics | `bitwarden/clients@5ea9cb2` (2026-10-07): `CollectAutofillContentService`, `DomQueryService`, `DomElementVisibilityService`, `InlineMenuFieldQualificationService`, unmodified | GPL-3.0 |
| Proton classifier | npm `@protontech/autofill@0.0.38040317` (+ `@protontech/fathom`, `@protontech/ml-inference`, same version), bundled random-forest model | MPL-2.0 |

**Method.**
- Each engine is bundled with esbuild and run in the page's main world in every http(s) frame, once the page has settled (network idle + 2.5–8 s). Bitwarden runs first: it only sets JS properties, while Proton writes `data-protonpass-*` attributes.
- Each wrapper replays what its extension does with the raw output, so the comparison is between *inline-menu decisions*, not internal scores. Bitwarden: `AutofillOverlayContentService.isIgnoredField` and the `setQualified*FillType` helpers. Proton: `detector.service.ts` (form/field tie-breaking) and `FORM_TRACKER_CONFIG` (which dropdown action a form type/field type pair gets).
- Both map onto one label set: `username`, `current-password`, `new-password`, `signup-username`, `otp`, or nothing.
- Both run with their remote per-site rules off (Bitwarden "Map the Web" targeting rules, Proton `rules.json` and runtime model downloads), because rimlock fetches nothing at runtime ([Define the threat model](https://github.com/maxdubmors/rimlock/issues/9)). Bitwarden runs as a premium user, because TOTP qualification is premium-gated and rimlock would always offer it.
- Ground truth: every visible `<input>` gets a label. Fixtures carry it inline (removed from the DOM before the engines run, since both read `data-*`). Live pages were labelled by hand from a field summary and a screenshot ([`corpus/labels.json`](../../prototypes/form-detection-engines/corpus/labels.json)). Only fields visible at capture time are scored. Predictions on invisible fields are counted separately.

**Corpus.**
- **55 live pages** with visible fields: 26 single-step logins, 17 multi-step logins (identifier step, plus Microsoft's password step), 5 sign-ups, 7 pages with no login (search boxes, password reset). Among them: shadow-DOM forms (Reddit, archive.org), a cross-origin iframe (Apple), non-English pages (Gosuslugi, Yandex, Mail.ru/VK ID), and login + sign-up forms on one page (Hacker News).
- 27 more pages were dropped: blocked from this network (Facebook, Instagram, LinkedIn, Proton, Medium, BBC, Ozon), a bot challenge for headless Chrome (GitLab, Stack Overflow sign-up, IMDb, eBay, Discord, WordPress, GitHub sign-up, PayPal, Etsy, Mozilla), or no form rendered ([`corpus/excluded.json`](../../prototypes/form-detection-engines/corpus/excluded.json)). Six more had no visible field at capture time and are not scored.
- **21 synthetic fixtures** for the hard cases the live pages under-represent: no `autocomplete` attributes, formless SPA, open and nested shadow DOM, a cross-origin iframe, OTP (single and split into 6 inputs), password change, PIN login, Russian/German labels, honeypot forms, a modal over a page with search and newsletter forms. They are deliberately adversarial, so their numbers are reported apart.
- No live OTP or password-change page: both need a real account. Those two classes rest on fixtures only.

## Answers

| Question | Bitwarden heuristics | Proton classifier |
|---|---|---|
| Accuracy, live pages (pages fully correct) | **45/55 (82%)**; fields 84/96 | **46/55 (84%)**; fields 85/96 |
| … single-step login | **24/26** | 21/26 |
| … multi-step login | 15/17 | **17/17** |
| … sign-up | 1/5 | 2/5 |
| … pages without a login | 5/7 | **6/7** |
| Accuracy, fixtures | 12/21; fields 37/55 | **14/21; fields 46/55** |
| Shadow DOM | **Yes** (open; closed via `chrome.dom.openOrClosedShadowRoot` in a content script) | **No**: Fathom selects with `document.querySelectorAll` |
| Content-script cost (esbuild, minified / +gzip) | **73 KiB / 21 KiB** | 197 KiB / 50 KiB (incl. ~280 KB of random-forest JSON) |
| Detection time per page (median / max) | **5 ms / 11 ms** | 18 ms / 31 ms |
| Predictions on invisible fields (live / fixtures) | 20 / 2 (fields of later steps; 2 honeypot fields) | 1 / 1 (1 honeypot field) |
| Extraction effort | 15 upstream files, ~7.2k lines, **one shim** (a 3,222-line `AutofillService` stood in by one static helper) plus a `chrome.runtime` message stub. Under strict TS the type closure is 52 files / 13.7k lines with 50 unresolvable modules (rxjs, `@bitwarden/sdk-internal`, `platform/state`, …) | **None**: an npm dependency; the wrapper type-checks clean under `strict` |
| Coupling | `AutofillField`/`AutofillPageDetails` models, message-based settings (`sendExtensionMessage`), its own observers (Mutation/Intersection) started in the constructor | A Fathom ruleset over `document`; `FORM_TRACKER_CONFIG` semantics live in Proton's extension, not the package |
| Bundle size "~20 MB unpacked" | n/a | 18.5 MB of it is generated `.d.ts`; the shipped JS is 212 KB |
| AMO review risk | Low: it becomes rimlock's own readable source | Low: unminified ES2020, all 51 source maps embed the original TypeScript, models are JSON data, nothing executes remotely. Only if unmodified (AMO third-party rule) |
| Source repo and training data | Public repo, hand-written rules and keyword lists | **None public**: npm-only, 7 versions (2025-03 → 2026-08, ~monthly in 2026), no training data or pipeline; Proton updates weights at runtime from its own server |

## Findings

### 1. Accuracy: a tie on live pages, with complementary errors

On the 55 live pages the two engines are within one page of each other. Where they differ:

- **Bitwarden wins on single-step logins** because of shadow DOM: Reddit and archive.org render their forms in open shadow roots, and Proton sees neither field. Its other misses: Netflix's `autocomplete="password"` (not a valid token) and Apple's password field in the `idmsa.apple.com` iframe.
- **Proton wins on multi-step pages and form purpose.**
  - Bitwarden misses Yandex's phone-number identifier, Steam's account-name field and Hacker News' login username (its sign-up form reuses the same field names).
  - It labels Booking's `id=hidden-password` input as a current password (on screen, but not part of the email step).
  - It treats sign-up identifiers as login usernames (Dropbox, Reddit and OSM register, OSM's password as a current password). For rimlock that would offer saved logins on a sign-up form, and no generator.
- **Both** mislabel the password-reset email (GitHub) as a login username. Both mark Wikipedia's optional sign-up email as a sign-up identifier (Wikipedia logs in by username only).
- **Bitwarden false positive on a search box** (Hacker News' Algolia search as a username). Proton had none on live pages but one on a fixture (a modal page's newsletter email).

The fixtures sharpen the same picture:

- **OTP:** Proton 7/7, Bitwarden 0/7. Bitwarden recognises a TOTP field only by `autocomplete="one-time-code"` or explicit keywords (`totp`, `otpcode`, `mfacode`, …). Plain `otp`, `code` and `2fa` are in its *ambiguous* list and never qualify on their own, and split 6-box inputs never do.
- **Password change:** Proton right; Bitwarden calls the current password a new one.
- **Sign-up without `autocomplete`, German sign-up, login + sign-up on one page:** Proton mostly right, Bitwarden misses the new-password fields.
- **PIN login:** Proton right; Bitwarden misses the customer-number field.
- **Shadow DOM** (open, nested): Bitwarden right, Proton blind.
- **Cross-origin iframe:** Proton right, Bitwarden misses the username.

### 2. Proton cannot see shadow DOM, and the fix is inside the package

Proton's Fathom fork builds candidates with `ruleset.doc.querySelectorAll(selector)` (`lhs.mjs`). Its `shadowPiercingContains` only answers "is this field inside that form". Proton's own extension only reacts to focus inside a custom element's shadow root (`client.observer.ts`); it does not classify inside one. Patching this means changing the package. AMO allows third-party libraries only as unmodified release versions, so a patched copy would have to be vendored as rimlock's own (MPL-2.0 is file-level copyleft and combines with GPL-3.0). The sources are recoverable from the source maps.

### 3. Hidden fields

- Bitwarden collects and qualifies invisible fields on purpose: the hidden password input of a multi-step page gets a fill type early, and the menu attaches when it becomes visible (IntersectionObserver). All 20 of its invisible predictions on live pages are such later-step fields: 12 hidden password inputs of multi-step pages, 4 hidden OTP inputs, and sign-up fields behind a tab.
- Both engines labelled at least one honeypot field: an `opacity:0` input, plus an off-screen form for Bitwarden.
- Neither engine is a defence against hidden-form harvesting. The "fill only on user action, only visible fields" rule from [Define the threat model](https://github.com/maxdubmors/rimlock/issues/9) has to live in rimlock's fill step whichever engine is used.

### 4. Bitwarden quirks found while extracting

- `fieldHasDisqualifyingAttributeValue` tests whether the field's `id`/`name`/`placeholder` is a *substring* of `"captcha,findanything,forgot"`. So `id="p"`, `"a"`, `"for"` or `"cap"` disqualifies the field (the first fixture run lost a password field to `id="p"`; fixtures were then given realistic ids).
- `InlineMenuFieldQualificationService` reads premium status in its constructor through a message. A stub that answers late silently turns TOTP detection off.
- `CollectAutofillContentService` asks the background for targeting rules and attribute settings before collecting. An empty reply falls back to heuristics, which is what rimlock would get.

### 5. Proton package anatomy

- `@protontech/autofill` is 19.6 MB unpacked: 18.5 MB of generated `.d.ts` (single files up to 7 MB), 212 KB of JS, 326 KB of model JSON (random forest plus an unused perceptron). After tree-shaking the content script carries 197 KiB minified / 50 KiB gzipped.
- The JS is TypeScript compiler output (ES modules, not minified). The source maps carry `sourcesContent`. Imports are self-referential (`@protontech/autofill/features/...`) without an `exports` map, so a bundler is required (Node ESM cannot load it directly).
- Proton's extension pins the exact version in `packages/pass/package.json`. Between releases it replaces the weights at runtime: `model-artifact.ts` fetches `model-artifact.zip` by model id from `MODEL_ARTIFACTS_BASE_URL`. rimlock would ship only the weights bundled at release.
- Field and form types (`login`, `register`, `password-change`, `recovery`, `noop`; `email`, `username`, `username-hidden`, `password`, `new-password`, `otp`, identity, credit card) map cleanly onto rimlock's needs: the generator on new-password, the Save prompt on login/register/password-change, TOTP fill.

## What this means for [Decide the autofill approach](https://github.com/maxdubmors/rimlock/issues/15)

Neither engine is clearly more accurate on real login pages. They differ in what their errors cost rimlock and in what reuse costs:

- **Proton** is a dependency, not a fork: zero extraction, strict-typed, permissively licensed. It is better exactly where rimlock's MVP features need form *purpose*: the generator on new-password fields, the Save prompt on sign-up/change forms, TOTP fill. Its costs:
  - it is blind to shadow DOM, and the fix needs a vendored fork;
  - it is 2.4× the gzipped size and ~3.5× the detection time (still ~20–30 ms);
  - its model is opaque and its releases are tied to Proton's monorepo cadence, with no public tests or training data.
- **Bitwarden** is cheaper at runtime, pierces shadow DOM (closed too, in a content script), and its rules are readable and fixable. Its costs:
  - weaker OTP and sign-up/new-password detection, plus false positives on search and reset fields;
  - adopting it means owning a ~7k-line fork whose strict type closure reaches into 50 Bitwarden modules that must be cut or re-typed.
- Either way rimlock needs its own layer around the engine:
  - visibility and user-gesture checks at fill time (§3);
  - frame scoping ([Define the threat model](https://github.com/maxdubmors/rimlock/issues/9));
  - a mapping from engine output to rimlock's actions, like the wrappers here.

  A hybrid (Proton classification plus a rimlock-owned shadow-root walk feeding it per root) is plausible but untested.

## Not covered

- Live OTP and password-change pages (need accounts); closed shadow roots (needs an isolated-world content script); Firefox; re-detection after DOM mutations (each page was classified once, after settling); Proton's and Bitwarden's remote per-site rules.
- The 27 dropped pages skew the corpus away from the largest consumer sites. A run from another network, or a headful browser, would restore them.
- 55 live pages is a small sample: a one-page difference is noise.
