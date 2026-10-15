// Requests from every other context to the background, and its answers (engineering.md
// § TypeScript modules). A new request kind is one more member of `Request`, one more case in
// `parseRequest` and one more entry in `ResponseTo`; the background's exhaustive switch then
// fails to type-check until it answers it.

/** Is the background up, and which Core does it run? */
export type StatusRequest = { kind: 'status' };

export type Request = StatusRequest;

export type StatusResponse = { coreVersion: string };

/** The background's answer to each kind of request. */
export type ResponseTo<R extends Request> = {
  status: StatusResponse;
}[R['kind']];

/**
 * A message as the background receives it: from any context, a content script in a hostile page
 * included (security.md), so it is checked and rebuilt, never trusted as it is.
 */
export function parseRequest(message: unknown): Request | undefined {
  if (typeof message !== 'object' || message === null || !('kind' in message)) return undefined;
  switch (message.kind) {
    case 'status':
      return { kind: 'status' };
    default:
      return undefined;
  }
}
