import { browser } from 'wxt/browser';

import { parseRequest, type Request, type ResponseTo } from '../protocol/messages';
import { describeCore } from './core';

async function answer(request: Request): Promise<ResponseTo<Request>> {
  switch (request.kind) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- one kind so far; reported as unused once a second arrives
    case 'status':
      return { coreVersion: (await describeCore()).version };
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
