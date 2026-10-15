# Coding standards

What review checks by judgement. A rule a command can check belongs in `pnpm check` or `pnpm test` instead, and the rules every agent follows while implementing are root `AGENTS.md` § Rules; neither is repeated here.

## Sources

Review a change against:

- root `AGENTS.md` § Rules, `crates/AGENTS.md`, `apps/extension/AGENTS.md`;
- the spec files the change touches (`docs/spec/README.md` lists them) and the ADRs they link;
- `docs/spec/security.md`, for anything that handles secrets, messages between contexts or storage.

## Rules

- **The Core contract.** `docs/spec/core-api.md` is the contract of `rimlock-core-wasm`. Every export matches it in inputs, outputs and failure behaviour, including what the spec says a function never does ("never runs the KDF", "holds no state"). `apps/extension/tests/core-api/` checks only that each export is declared there.
- **Core failures are values.** A Core error reaches its caller as a `CoreResult` (`core-api.md` § 8), and the caller switches on it. Only `CoreClient` (until it exists, `background/core.ts`) catches what the bindings throw.
- **The spec moves with the code.** A spec sentence the change leaves untrue is a finding, even in a file the diff does not touch.
- **Docs describe what exists.** A doc or comment states what the repository does today. Planned work reads as planned: "for CI to call", not "CI runs it", until a workflow does.
