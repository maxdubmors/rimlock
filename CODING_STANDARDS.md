# Coding standards

What review checks by judgement. A rule a command can check belongs in `pnpm check` or `pnpm test` instead, and the rules every agent follows while implementing are root `AGENTS.md` § Rules; neither is repeated here.

## Sources

Review a change against:

- root `AGENTS.md` § Rules, `crates/AGENTS.md`, `apps/extension/AGENTS.md`;
- the spec files the change touches (`docs/spec/README.md` lists them) and the ADRs they link;
- `docs/spec/security.md`, for anything that handles secrets, messages between contexts or storage;
- `GLOSSARY.md`: a name, comment or doc that uses a word under _Avoid_ in that term's sense.

## Rules

- **The Core contract.** `docs/spec/core-api.md` is the contract of `rimlock-core-wasm`. Every export matches it in inputs, outputs and failure behaviour, including what the spec says a function never does ("never runs the KDF", "holds no state"). `apps/extension/tests/core-api/` checks only that each export is declared there.
- **Core failures are values.** A Core error reaches its caller as a `CoreResult` (`core-api.md` § 8), and the caller switches on it. Only `CoreClient` catches what the bindings throw.
- **The spec moves with the code.** A spec sentence the change leaves untrue is a finding, even in a file the diff does not touch.
- **Every new spec claim has a source.** A sentence a pull request adds to `docs/spec/` or `docs/adr/` traces to its ticket, or the pull request body quotes the spec lines it follows from. A claim with neither is a finding, and becomes a `needs-triage` issue (root `AGENTS.md`).
- **Desired behavior is the owner's text.** A line a documentation pull request copies from its ticket's Desired behavior was reviewed at triage ([`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)). A problem with its wording or what it leaves out is a `needs-triage` issue, not a finding against the diff. A reviewer given the diff alone finds those lines in the ticket's Agent Brief (`gh issue view <n> --comments`) before judging their wording. The other rules still apply around it: a spec sentence elsewhere that the copied line leaves untrue, or a line the pull request words differently or adds, is reviewed as usual.
- **One home per rule.** A spec rule the change adds or rewords lives in one file ([`docs/spec/README.md`](docs/spec/README.md) § How the docs fit together); restating it in another file is a finding, even in a file the diff does not touch.
- **The commit message matches the diff.** Every claim a commit message (`git log <fixed-point>..HEAD`) makes about what the change does holds against the diff; an inaccurate one is a finding.
- **Docs describe what exists.** A doc or comment states what the repository does today. Planned work reads as planned: "for CI to call", not "CI runs it", until a workflow does.
