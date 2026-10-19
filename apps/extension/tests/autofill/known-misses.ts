/**
 * The baseline: where FormDetector's label differs from the one a fixture expects, by fixture and
 * field id, with what it labels instead (`none` for no label). Each entry says why. A Proton bump
 * that fixes a miss fails the suite too: remove the entry. One that adds a miss is a regression,
 * unless it is explained here.
 *
 * Every entry is a miss the prototype recorded too, identical in Chrome and Firefox: "Compare
 * form-detection engines" for the light-DOM fixtures, "Verify Proton classification across shadow
 * roots" for the shadow ones.
 */
export const knownMisses: Partial<Record<string, Record<string, string>>> = {
  // Proton types the reset form `recovery`, and an email in a recovery form is a login username
  // in its mapping. Bitwarden made the same call; so did both on GitHub's live reset page.
  'forgot-password': { 'f0:0': 'username' },
  // The model misses the e-mail of a German sign-up; its new-password fields are right.
  'german-signup': { 'f0:0': 'none' },
  // The visible password is lost, and the `opacity:0` honeypot input gets a sign-up label.
  // rimlock's fill-time checks, not the classifier, keep a Fill out of hidden fields
  // (autofill.md § Fill).
  honeypot: { 'f0:1': 'none', 'f0:4': 'signup-username' },
  // A login and a sign-up form side by side: the sign-up e-mail is missed.
  'login-and-signup': { 'f0:2': 'none' },
  // The newsletter e-mail under the login modal is taken for a login username.
  'modal-login': { 'f0:3': 'username' },
  // The model types this sign-up form as a password change, so the e-mail gets no label. The same
  // form in the light DOM misses it the same way (`shadow-control-signup-light`).
  'shadow-signup': { 'f0:0': 'none' },
  'shadow-control-signup-light': { 'f0:0': 'none' },
};
