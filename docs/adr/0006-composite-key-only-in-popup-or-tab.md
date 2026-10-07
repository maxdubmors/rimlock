# The Composite key is entered only in the popup or an extension tab, never in UI inside a page

The Master password and Key file are entered only in the toolbar popup or in the Extension opened as a tab. They are never entered in UI that sits inside a web page, and that includes an extension-origin iframe. The security baseline permits such an iframe, because the page cannot read it. The threat, though, is not the page reading the real prompt. It is a phishing page drawing a fake one, and an in-page Locked prompt cannot be told apart from a fake one. Fake locked password-manager menus phished more than 30% of users (Anliker et al., USENIX Security 2025). A user who never types the Master password inside a page has no habit for such a fake to exploit. So when an unlock starts in a page, the in-page UI only sends the user to the popup. This covers "click to unlock" in the Inline menu and "Unlock and save" on the Save prompt. The interrupted action then resumes after the unlock.

## Considered Options

- **Unlock inside the extension-origin iframe** (Inline menu or Save prompt card). Rejected: it saves one step, but it teaches the exact behaviour that fake in-page prompts exploit.

## Consequences

- This narrows the unlock rule of the security baseline ([Define the threat model](https://github.com/maxdubmors/rimlock/issues/9)): of "popup, tab, extension-origin iframe", only the popup and the tab remain.
- In-page UI must be able to open the popup, or fall back to the tab. See [Opening the popup from in-page UI in Chrome and Firefox](https://github.com/maxdubmors/rimlock/issues/23).
- A pending save waits in memory until the unlock completes and is dropped if the user abandons it.
- Decision detail: [Sketch the Extension UI shape](https://github.com/maxdubmors/rimlock/issues/10).
