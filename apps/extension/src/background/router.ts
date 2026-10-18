import { browser, type Browser } from 'wxt/browser';

import { parseRequest, type Request, type ResponseTo } from '../protocol/messages';
import { core } from './core';
import type { CoreClient } from './core-client';
import { UnlockedState } from './unlocked-state';

/** What one background holds for as long as it lives. */
export type Background = { core: CoreClient; unlocked: UnlockedState };

/**
 * The background's answer to one request. Never rejects: a sender that gets no answer would wait
 * until the background dies.
 */
export async function answer(
  request: Request,
  background: Background,
): Promise<ResponseTo<Request>> {
  switch (request.kind) {
    case 'status': {
      const info = await background.core.coreInfo();
      if (!info.ok) return { core: 'unavailable' };
      const name = await background.unlocked.name();
      return {
        core: 'running',
        version: info.value.version,
        unlocked: name === undefined ? null : { name },
      };
    }
    case 'unlock':
      try {
        return await background.unlocked.unlock(request.file, request.masterPassword);
      } finally {
        request.masterPassword.wipe();
      }
  }
}

/**
 * Answers every request from the other contexts, and rebuilds the Unlocked Database at once: the
 * background has just woken (ADR-0005). The listener is registered synchronously at start-up, so
 * a message that wakes the background is not lost. The answer goes through `sendResponse` after
 * `return true`, the asynchronous form both browsers understand.
 */
export function startRouter(
  background: Background = { core, unlocked: new UnlockedState(core) },
): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const request = parseRequest(message);
    if (request === undefined || !accepts(request, sender)) return false;
    void answer(request, background).then(sendResponse);
    return true;
  });
  void background.unlocked.name();
}

/**
 * Whether `sender` may make `request`. A Master password is entered only in the popup or an
 * extension tab (ADR-0006), so only one of the Extension's own pages that is no frame inside
 * another page may unlock: neither a content script, in a hostile page (security.md), nor an
 * extension-origin iframe in one.
 */
function accepts(request: Request, sender: Browser.runtime.MessageSender): boolean {
  switch (request.kind) {
    case 'status':
      return true;
    case 'unlock':
      return (
        sender.id === browser.runtime.id &&
        (sender.url?.startsWith(browser.runtime.getURL('/')) ?? false) &&
        (sender.tab === undefined || sender.frameId === 0)
      );
  }
}
