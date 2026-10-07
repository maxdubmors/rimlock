# Form detection uses Proton's classifier, unmodified, behind a rimlock-owned FormDetector seam

The Extension classifies page fields (username, current password, new password, sign-up identifier, OTP) with Proton's `@protontech/autofill` package, used as an unmodified npm dependency. A rimlock-owned `FormDetector` interface wraps it, so nothing else in the Extension depends on Proton's types. Proton cannot see shadow DOM, so rimlock walks shadow roots itself, closed ones included (`openOrClosedShadowRoot` in the content script), and feeds each root to the classifier. On 55 live pages Proton tied with Bitwarden's heuristics (46 vs 45 fully correct), but it was better at form purpose: sign-up vs login, new-password and OTP. The Inline menu, the generator and TOTP fill all depend on purpose, and the package costs no extraction work. Remote per-site rules and model downloads stay off, because the Extension fetches nothing at runtime (ADR-0002).

## Considered Options

- **Fork Bitwarden's heuristics.** Rejected: it is smaller, faster and readable, and it already pierces shadow DOM. But it is weak on form purpose (0/7 OTP fixtures, a missed new-password), and it means owning a ~7k-line fork with a wide `@bitwarden/common` type closure.
- **Write rimlock's own heuristics.** Rejected: no labelled data to tune them on, and the two existing engines already took years of fixes.
- **Vendor a patched Proton copy now.** Deferred: AMO accepts third-party code only as unmodified releases, so a patch makes the copy rimlock's own code to review and maintain. It is the fallback if feeding shadow roots from outside does not work.

## Consequences

- The model is opaque and has no public repository or training data. rimlock cannot retrain it, only pin a version, wrap its output and override it in rimlock code.
- Proton classifies; it does not decide. rimlock owns the mapping from labels to actions, the fill-time visibility, honeypot and gesture checks, and per-site overrides.
- The shadow-root walk is untested: [Verify Proton classification across shadow roots](https://github.com/maxdubmors/rimlock/issues/24) must confirm it before implementation relies on it.
- Decision detail: [Decide the autofill approach](https://github.com/maxdubmors/rimlock/issues/15). Engine comparison: [Compare form-detection engines: Proton classifier vs Bitwarden heuristics](https://github.com/maxdubmors/rimlock/issues/17).
