# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

A `ready-for-agent` ticket comes with its test seams agreed: the public interface of each module it touches (root `AGENTS.md` § Rules), plus any seam the ticket names. A skill that asks to confirm seams with the user takes these and goes on; a seam outside them is a question for the ticket.

Its acceptance criteria list what this ticket makes observable. A rule every ticket follows (no panics, `zeroize` secrets, injected clock and RNG) stays in `AGENTS.md` and the spec; copied into criteria, it reads as met even where the ticket has nothing it applies to.

A test that holds behaviour the ticket leaves unchanged is a **pin**, and the ticket calls it one: it passes on `main` from the start, and "a bug fix starts with a failing test" covers only the behaviour the ticket changes.

Edit the right-hand column to match whatever vocabulary you actually use.
