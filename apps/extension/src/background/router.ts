import { browser } from 'wxt/browser';

import type { CoreInfo } from '../core-bindings/rimlock_core_wasm.js';
import { parseRequest, type Request, type ResponseTo } from '../protocol/messages';
import { core } from './core';
import type { CoreResult, CoreUnavailable } from './core-client';

/**
 * The background's answer to one request, from the Core that `readCoreInfo` reaches. Never
 * rejects: a sender that gets no answer would wait until the background dies.
 */
export async function answer(
  request: Request,
  readCoreInfo: () => Promise<CoreResult<CoreInfo, CoreUnavailable>> = () => core.coreInfo(),
): Promise<ResponseTo<Request>> {
  switch (request.kind) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- one kind so far; reported as unused once a second arrives
    case 'status': {
      const info = await readCoreInfo();
      return info.ok ? { core: 'running', version: info.value.version } : { core: 'unavailable' };
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
