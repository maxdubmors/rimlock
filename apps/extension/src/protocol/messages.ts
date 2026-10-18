// Requests from every other context to the background, and its answers (engineering.md
// § TypeScript modules). A new request kind is one more member of `Request`, one more case in
// `encodeRequest` and `parseRequest` and one more entry in `ResponseTo`; the background's
// exhaustive switch then fails to type-check until it answers it.

import { browser } from 'wxt/browser';

import { Secret } from '../shared/secret';
import { decodeBase64, encodeBase64 } from './base64';
import { decodeSecret, encodeSecret } from './secret-codec';

/** Is the background up, which Core does it run, and which Database is Unlocked? */
export type StatusRequest = { kind: 'status' };

/**
 * Add a Database from a `.kdbx` file by unlocking it with its Master password: the walking
 * skeleton of the add flow (databases-and-unlock.md § Adding a Database = the first unlock).
 */
export type UnlockRequest = { kind: 'unlock'; file: Uint8Array; masterPassword: Secret };

export type Request = StatusRequest | UnlockRequest;

export type StatusResponse =
  | { core: 'running'; version: string; unlocked: { name: string } | null }
  /** The Core could not be instantiated in this background, or a panic aborted it (core-api.md § 8, `CoreUnavailable`). */
  | { core: 'unavailable' };

/** Why a Database did not unlock; reason codes only, never file content (core-api.md § 8). */
export type UnlockFailure =
  | { kind: 'WrongKey' }
  | { kind: 'UnsupportedFile' | 'Corrupt'; reason: string }
  /** The Core is unavailable, a bug, or the Database could not be stored. */
  | { kind: 'Internal' };

export type UnlockResponse =
  { unlocked: true; name: string } | { unlocked: false; error: UnlockFailure };

/** The background's answer to each kind of request. */
export type ResponseTo<R extends Request> = {
  status: StatusResponse;
  unlock: UnlockResponse;
}[R['kind']];

/** The request as a message carries it: JSON, with the file as base64 and the Secret encoded. */
export function encodeRequest(request: Request): unknown {
  switch (request.kind) {
    case 'status':
      return request;
    case 'unlock':
      return {
        kind: 'unlock',
        file: encodeBase64(request.file),
        masterPassword: encodeSecret(request.masterPassword),
      };
  }
}

/**
 * A message as the background receives it: from any context, a content script in a hostile page
 * included (security.md), so it is checked and rebuilt, never trusted as it is.
 */
export function parseRequest(message: unknown): Request | undefined {
  if (typeof message !== 'object' || message === null || !('kind' in message)) return undefined;
  switch (message.kind) {
    case 'status':
      return { kind: 'status' };
    case 'unlock': {
      const fields = message as Record<string, unknown>;
      const file = typeof fields['file'] === 'string' ? decodeBase64(fields['file']) : undefined;
      const masterPassword = decodeSecret(fields['masterPassword']);
      if (file === undefined || masterPassword === undefined) return undefined;
      return { kind: 'unlock', file, masterPassword };
    }
    default:
      return undefined;
  }
}

/** Sends a request to the background and returns its answer. */
export function sendRequest<R extends Request>(request: R): Promise<ResponseTo<R>> {
  // The background answers every request it parses, with the type ResponseTo names.
  return browser.runtime.sendMessage<unknown, ResponseTo<R>>(encodeRequest(request));
}
