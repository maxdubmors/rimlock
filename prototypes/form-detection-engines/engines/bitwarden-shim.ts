// The services call chrome.runtime.sendMessage for settings and targeting rules.
// Answer with what a premium user with default settings would get: no targeting
// rules ("Map the Web" off), data-bwignore not honoured, premium on (TOTP
// qualification is premium-gated in Bitwarden; rimlock would always offer it).
const answers: Record<string, unknown> = { getUserPremiumStatus: { result: true } };
const g = globalThis as any;
if (!g.chrome?.runtime?.sendMessage) {
  g.chrome = {
    ...(g.chrome ?? {}),
    runtime: {
      sendMessage: (m: { command: string }, cb?: (r: unknown) => void) => cb?.(answers[m.command] ?? {}),
      lastError: undefined,
    },
  };
}
