# Releases are built by CI and uploaded by hand; store credentials never leave the owner

The worst thing that can happen to a password manager's users is a malicious update pushed to every install at once. So no automated system holds the power to publish. CI builds every release: a tag signed by the owner and protected by a ruleset triggers a workflow that verifies the tag signature, runs `scripts/build-release.sh` in the pinned container on x86_64 and arm64, fails unless both `SHA256SUMS` match, rebuilds from the AMO source package itself to prove it self-contained, attests the artifacts with GitHub artifact attestations and leaves a **draft** GitHub Release. The owner then checks `gh attestation verify --signer-workflow` and the hashes, signs a CRX from the built zip with an offline RSA key, and uploads it to the Chrome Web Store and the XPI plus source package to AMO through their dashboards, behind 2FA. The Chrome Web Store has verified CRX uploads turned on, so it accepts only uploads signed with that key: even a taken-over Google account cannot ship an update. No store API key, OAuth token, service account or signing key exists in GitHub secrets.

## Considered Options

- **CI uploads to both stores** (CWS API v2 service account, AMO JWT keys in secrets). Rejected: any compromised workflow, action or build dependency could publish, and the stores review too lightly to stop a targeted change in a password manager.
- **Everything on the owner's machine.** Rejected: no public, attested record that the shipped bytes came from the tagged source, and the cross-architecture check would depend on one machine.
- **Staged or percentage rollout in CWS.** Not available: deploy percentages need more than 10,000 weekly users, and deferred publishing would only delay a reviewed version.

## Consequences

- A release costs about ten minutes of manual work, listed in `RELEASING.md` and a per-release issue from `.github/ISSUE_TEMPLATE/release.md` that also carries the manual pre-release checklist (ADR-0017). The tag is set only when that checklist is done.
- The CRX is signed after the build, so its bytes are not reproducible; the reproducible artifact is the zip inside it, which is what the hashes and attestation cover.
- Losing the CRX key blocks Chrome updates for up to a week of CWS support, so it has two offline backups. Store accounts (a CWS group publisher, a dedicated AMO account) use 2FA with offline recovery codes, so a second maintainer can be added later without transferring the listing.
- There is no beta channel: a beta CWS listing would need a second Extension ID (against the fixed IDs of ADR-0011), and a self-updating AMO unlisted channel would need its own manifest and burn version numbers. The candidate bundle is tested unpacked in Chrome and unsigned in Firefox Developer Edition, and the same bytes go to the stores.
- Automating uploads later means revisiting this ADR and the supply-chain part of the threat model (ADR-0002), not just adding a workflow step.
- Decision detail: [Decide CI, releases and store submission](https://github.com/maxdubmors/rimlock/issues/34).
