## Start here

The MVP spec starts at `docs/spec/README.md`: what is being built, the reading order, and the implementation plan (`docs/spec/plan.md`). Read it before any implementation work.

- A pull request that departs from the spec updates the spec in the same pull request.
- A pull request that contradicts an ADR in `docs/adr/` says so explicitly and links it; it never overrides an ADR silently.
- A question the spec does not answer becomes an issue labelled `needs-triage`, not a decision inside a pull request.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (maxdubmors/rimlock) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
