# Manifest V3 on every browser, including Firefox

The Extension ships as MV3 on Chrome and Firefox (and on Safari later), with MV3 pinned explicitly for Firefox because WXT defaults Firefox to MV2. This goes against the prior art: Bitwarden and KeePassXC-Browser still ship MV2 on Firefox, where a persistent background could simply keep the Unlocked Database in memory. Chrome forces the MV3 design anyway, with its ~30 s background teardown and state restored from `storage.session`, so MV2 on Firefox would add a second execution model, a second manifest and a second test matrix to save work we have to do regardless.

## Consequences

The Firefox background is an event page (Firefox has no background service worker or offscreen API), so the Core must run in service-worker, event-page and extension-page contexts. The MV2 fallback on Firefox is not needed: ADR-0005 rebuilds the Unlocked Database on every wake-up the same way in an event page and in a service worker.
