import { browser } from 'wxt/browser';

export type Root = Document | ShadowRoot;

/** The shadow root of `element`, open or closed, or `null` if it has none or it cannot be opened. */
export type ShadowRootOf = (element: Element) => ShadowRoot | null;

/**
 * Opens closed roots too, as only a content script can: Chrome through `chrome.dom`, Firefox
 * through a property its content scripts alone see on an element. `chrome.dom` throws on anything
 * that is not an `HTMLElement` (every `<svg>`), so both filter first.
 */
export const openOrClosedShadowRoot: ShadowRootOf = (element) => {
  if (!(element instanceof HTMLElement)) return null;
  if ('dom' in browser) return browser.dom.openOrClosedShadowRoot(element);
  return (
    (element as HTMLElement & { openOrClosedShadowRoot?: ShadowRoot | null })
      .openOrClosedShadowRoot ?? null
  );
};

// Elements whose shadow root, if any, is the browser's own (user-agent) one.
const userAgentHosts = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'VIDEO',
  'AUDIO',
  'IMG',
  'DETAILS',
  'METER',
  'PROGRESS',
]);

/** `document` and every shadow root under it, in document order: a host's root before its light children. */
export function collectRoots(document: Document, shadowRootOf: ShadowRootOf): Root[] {
  const roots: Root[] = [document];
  const walk = (root: Root) => {
    for (const element of root.querySelectorAll('*')) {
      if (userAgentHosts.has(element.tagName)) continue;
      const shadowRoot = shadowRootOf(element);
      if (shadowRoot) {
        roots.push(shadowRoot);
        walk(shadowRoot);
      }
    }
  };
  walk(document);
  return roots;
}
