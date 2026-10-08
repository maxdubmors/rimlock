# Proton classification across shadow roots

Ticket: [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24). It checks the assumption in ADR-0009 ([Decide the autofill approach](https://github.com/maxdubmors/rimlock/issues/15)): Proton's classifier stays unmodified, and rimlock walks the shadow roots itself and feeds each one to it. Seed: the harness and corpus from [Compare form-detection engines](https://github.com/maxdubmors/rimlock/issues/17) ([`form-detection-engines.md`](form-detection-engines.md)).

**Setup.** `@protontech/autofill@0.0.38040317`, unmodified. Chrome for Testing 155.0.8059.39 and Firefox 157.0.1, headless, Linux, 2026-10-08. Detection runs in a real MV3 content script (isolated world) of a throwaway extension ([`ext/`](../../prototypes/form-detection-engines/ext/)). The content script opens closed roots with `chrome.dom.openOrClosedShadowRoot` in Chrome and `element.openOrClosedShadowRoot` in Firefox. Each page is loaded once per variant, because Proton leaves expando flags (`__PP_SEEN__`, …) on every element it has seen, and a second run in the same load would skip them.

**Variants.**

| Variant | What it is |
|---|---|
| `proton` | The package exactly as in the engine comparison: `prepass()`, `shouldRunClassifier()`, `ruleset.against(document)` |
| `protonWalk` | ADR-0009 as written: collect every root (document plus all shadow roots, closed ones included, in document order), call `prepass(root)` and `ruleset.against(root)` for each root that has an `<input>`, and map each field to the form found in its own root. `shouldRunClassifier()` is rewritten in rimlock code with a list of roots, because the package's version reads only `document` |
| `protonGroup` | `protonWalk`, plus two rimlock-side steps that use only the package's public exports (details below) |

Code: [`engines/proton-walk.ts`](../../prototypes/form-detection-engines/engines/proton-walk.ts) (~150 lines, including a trace). Fixtures: [`make-shadow-fixtures.mjs`](../../prototypes/form-detection-engines/make-shadow-fixtures.mjs). Runner and scorer: `run-ext.mjs`, `score-shadow.mjs`. Raw results and score tables: [`results/shadow/`](../../prototypes/form-detection-engines/results/shadow/).

## Answer

**Feeding roots one by one to the unmodified package works only when a whole form lives in one root.** That covers open, closed and nested hosts, forms with and without a `<form>` element, and OTP. It fails on the most common real-world shape, a design-system field component where every `<input>` sits alone in its own root (Reddit's `faceplate-text-input`, Lit/Shoelace/Ionic-style inputs). Two small rimlock-side steps fix that shape **without patching the package**, so no vendored patch is needed.

| | `proton` | `protonWalk` | `protonGroup` |
|---|---|---|---|
| Fixtures fully correct (16) | 2 | 6 | **14** |
| Fixture fields correct (33) | 6 | 22 | **31** |
| Reddit login | ✗ | ✗ | **✓** |
| Reddit sign-up (step 1: email only) | ✗ | ✗ | ✗ |
| archive.org login | ✗ | **✓** | **✓** |
| archive.org home (no login; search boxes in shadow roots) | ✓ | ✓ | ✓ |
| Predictions on invisible fields | 0 | 0 | 0 |

Chrome and Firefox give identical labels on every fixture and live page.

Both remaining fixture misses are one field: the e-mail of a sign-up form (`shadow-signup`). The same form in the light DOM (`shadow-control-signup-light`) misses it the same way: Proton types the form as password change, so the miss comes from the model, not from the shadow DOM. Every shadow fixture now scores the same as its light-DOM equivalent.

### Per fixture (Chrome; Firefox identical)

| Fixture | Shape | `protonWalk` | `protonGroup` |
|---|---|---|---|
| open-shadow | whole `<form>` in one open root | ✓ | ✓ |
| shadow-closed | whole `<form>` in one closed root | ✓ | ✓ |
| shadow-formless | whole form in one root, no `<form>` element | ✓ | ✓ |
| shadow-otp | OTP form in one root | ✓ | ✓ |
| shadow-signup | sign-up form in one root | e-mail missed | e-mail missed (same in the light DOM) |
| nested-shadow | each field in its own root, inside a form-level root, no `<form>` | username missed | ✓ |
| shadow-nested-form | same, with a `<form>` in the form-level root | username missed | ✓ |
| shadow-closed-nested | same, closed form-level root | username missed | ✓ |
| shadow-closed-in-closed | same, every root closed | username missed | ✓ |
| shadow-split-form | `<form>` in the light DOM, each field in its own root | username missed | ✓ |
| shadow-split-closed | same, closed roots | username missed | ✓ |
| shadow-split-mixed | light username, password in a component root, one light `<form>` | both missed | ✓ |
| shadow-split-signup | split sign-up | e-mail missed | ✓ |
| shadow-slotted | light inputs slotted into a shadow layout (control) | ✓ | ✓ |
| shadow-negatives | search box and newsletter field in components | ✓ (no labels) | ✓ (no labels) |
| shadow-control-signup-light | `shadow-signup` in the light DOM (control) | e-mail missed | e-mail missed |

## Why the plain walk fails on split forms

- **A field is typed only if a form fnode sits around it in the same ruleset run.** The field rule requires `getParentFormFnode(field) !== null`, which looks for a `<form>` or a cluster (`[data-protonpass-form]`) that `contains()` the field. `contains()` does not cross a shadow boundary, so a form in an outer root does not count.
- **Clusters for a lone field form unreliably.** `prepass(root)` → `resolveFormClusters(root)` takes the field from the root but the submit buttons from `document.querySelectorAll` (hard-coded). The field then gets clustered with a button in another tree, the common ancestor lands outside the root (e.g. `<html>`), and the root ends up with no form. Whether this happens depends on layout. In `shadow-split-form` the username got a `<label>` cluster; in `shadow-split-closed`, the same markup with a shorter label, it got none. On Reddit no field got one, so nothing was typed at all.
- **Even with a cluster, the form context is gone.** A cluster holding one `<label>` and one input is typed `noop` (score 0.5), and Proton's dropdown mapping gives a username in a `noop` form no action. The password still works because it is offered in `noop` forms.
- **Proton types the field itself correctly.** In every case where a field got a form at all, its *field* type was right (`email`/`username`/`password`/`new-password`, score 1.00). What is missing is the *form purpose*.

## What `protonGroup` adds (rimlock code, no patch)

1. **Give a lone field a form.** In each shadow root, after `prepass(root)`, any input not inside a form candidate gets the package's own cluster flag (`flagCluster`, public export) on its outermost element in that root. This writes `data-protonpass-form`, the attribute Proton's clustering already writes. Proton then types the field.
2. **Decide the purpose across roots.** Fields that are alone in their own form (a lone-root cluster, or a light `<form>` whose other fields are in shadow roots) are grouped when they share a composed-tree ancestor at most 8 elements up (Reddit's inputs meet at their `<fieldset>`, 6 up). A group with a new password is a sign-up and one with a current password is a login. Labels then come from the same `FORM_TRACKER_CONFIG` mapping as before. A group with neither keeps Proton's form type. This sits squarely in ADR-0009's "Proton classifies; it does not decide": the purpose is rimlock's call.

Residual: a split form with a single visible field and no password in the group (Reddit sign-up step 1, an e-mail alone) stays `noop` and gets no label. The lone-root cluster carries too little context for Proton to call it a sign-up. A light-DOM multi-step sign-up does not always fare better (Proton got 2/5 sign-ups in the engine comparison). Possible later fixes: look at the group's *hidden* fields (Reddit's later `new-password` step is already in the DOM), or a per-site rule.

## The patch alternative

Making the package itself composed-tree-aware is not small. It means a deep `querySelectorAll` in Fathom's `dom()` LHS, plus shadow-piercing versions of about 36 `querySelectorAll`, 10 `querySelector`, 12 `contains`, 8 `parentElement` and 3 `closest` call sites across the form features, clustering, exclusion, label lookup and visibility code (`abstract.form.js`, `clustering.js`, `exclusion.js`, `form.js`, `dom.js`, `extract.js`). Every Proton release would need it re-applied, and AMO would review it as rimlock's own code. Because the rimlock-side steps reach the same scores as the light-DOM controls, they are the recommendation. Vendoring stays the fallback ADR-0009 already names.

## Cost

| | Chrome | Firefox |
|---|---|---|
| Root walk (all elements, `openOrClosedShadowRoot` on each), fixtures / live corpus, median / max | 0.2 / 0.6 ms; 0.9 / 4.7 ms | ≤ 1 ms (timer resolution, fixtures) |
| Detection per page, fixtures, median: `proton` → `protonWalk` → `protonGroup` | 0.6 → 22.5 → 21.3 ms | 0 → 14 → 15 ms |
| Detection per page, Reddit login / archive.org login, `protonGroup` | 25.4 / 27.7 ms | 18 / 18 ms |
| Bundle (content script with both variants, minified / +gzip) | 201.7 / 52.6 KiB, +~3 KiB over the plain wrapper | same |

The plain `proton` run is near zero on shadow pages only because it finds nothing. When the plain run does find a light form, it costs the same as the walk (18–23 ms). The cost is the classifier, which now actually runs: one ruleset run per root that holds an input (3–6 on these pages), each small. **Live corpus (Chrome, all 55 pages of the engine comparison, three loads each).** 51 pages showed the same visible fields on every load and are compared. The other 4 (Cloudflare, GitHub reset, Gosuslugi, Stack Overflow) hit a bot challenge or a different layout on a later load.

| | `proton` | `protonWalk` | `protonGroup` |
|---|---|---|---|
| Pages fully correct (51) | 43 | 44 | **45** |
| Visible fields correct (88) | 78 | 80 | **82** |
| Predictions on invisible fields | 1 | 1 | 1 |
| Detection per page, median / max | 19.4 / 28.9 ms | 18.3 / 29.1 ms | 18.8 / 33.4 ms |
| … of which the root walk, median / max | – | 0.9 / 4.5 ms | 0.8 / 4.7 ms |
| Roots with an input, median / max | – | 1 / 6 | 1 / 6 |

No page lost a correct label: `protonWalk` adds archive.org login, and `protonGroup` adds Reddit login on top. The remaining misses are the light-DOM ones from the engine comparison (Apple's cross-origin password frame, Netflix `autocomplete="password"`, Spotify, OpenStreetMap and Wikipedia sign-ups) plus Reddit sign-up step 1. On pages without shadow roots, the walk costs a full-DOM pass of under 5 ms. The detection median is unchanged, since load-to-load noise (5–29 ms on the same page) dwarfs the walk.

## Findings for implementation

- `chrome.dom.openOrClosedShadowRoot` **throws** on any element that is not an `HTMLElement` (every `<svg>` on Reddit and archive.org). Check `instanceof HTMLElement` before calling it. Firefox's `openOrClosedShadowRoot` property is safe either way.
- Proton's state lives in JS expandos on page elements, per JS world. One content script (one world) must own all detection runs, and a re-run in the same world relies on `shouldRunClassifier`'s flag logic, which rimlock must replicate per root (done in `shouldRun`).
- `protonWalk` and `protonGroup` lean on undocumented but exported internals (`selectFormCandidates`, `selectInputCandidates`, `isProcessableField`, `flagCluster`, `removeClassifierFlags`, …) and on the cluster attribute's meaning. Pin the version exactly, and keep the shadow fixtures as a regression suite that runs on every bump.
- Skip roots without an `<input>`: most roots on real pages are icons and buttons.

## Not covered

Mutation re-detection (roots attached after the first run), iframes inside shadow roots, declarative shadow DOM (same tree as `attachShadow` once parsed, so expected to behave the same), live OTP and password-change pages, form-associated custom elements (`ElementInternals`) where the `<input>` is not in the DOM at all.
