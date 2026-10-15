import { browser } from 'wxt/browser';

import type { CoreInfo } from '../core-bindings/rimlock_core_wasm.js';
import { parseRequest, type Request, type ResponseTo } from '../protocol/messages';
import { describeCore } from './core';

/**
 * The background's answer to one request. Never rejects: a sender that gets no answer would
 * wait until the background dies.
 */
export async function answer(
  request: Request,
  describe: () => Promise<CoreInfo> = describeCore,
): Promise<ResponseTo<Request>> {
  switch (request.kind) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- one kind so far; reported as unused once a second arrives
    case 'status':
      try {
        return { core: 'running', version: (await describe()).version };
      } catch {
        return { core: 'unavailable' };
      }
  }
}

/**
 * Answers every request from the other contexts. Registered synchronously at start-up, so a
 * message that wakes the background is not lost. The answer goes through `sendResponse` after
 * `return true`, the asynchronous form both browsers understand.
 */
export function startRouter(): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = parseRequest(message);
    if (request === undefined) return false;
    void answer(request).then(sendResponse);
    return true;
  });
}
