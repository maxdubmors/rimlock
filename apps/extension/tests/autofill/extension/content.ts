// The test extension's content script: in a content script's isolated world, as the store
// bundle's will be, it runs the Extension's FormDetector once per page load when the runner asks,
// and answers with the labels. Proton keeps per-element flags in this world, so a second run in
// the same load would skip what the first one saw: one request per load is answered.

import type { FieldLabel } from '../../../src/autofill/form-detector';
import { createProtonFormDetector } from '../../../src/autofill/proton-form-detector';
import { openOrClosedShadowRoot, type Root } from '../../../src/autofill/shadow-roots';
import {
  detectRequestEvent,
  detectReplyEvent,
  type DetectRequest,
  type FrameDetection,
  type StampedField,
} from '../detection';

// Inputs nobody fills.
const unnumbered = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
]);

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const width = Math.max(document.documentElement.scrollWidth, innerWidth);
  const height = Math.max(document.documentElement.scrollHeight, innerHeight);
  return rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
}

/**
 * Numbers every input in document order, a shadow root's before its host's later siblings, and
 * takes each fixture's expected label off its field, so the classifier never reads it. The order
 * is the prototype's, which `live-corpus.json` was labelled by.
 */
function stamp(frameKey: string, ids: WeakMap<Element, string>): StampedField[] {
  const fields: StampedField[] = [];
  const walk = (root: Root, shadow: StampedField['shadow']) => {
    for (const element of root.querySelectorAll('*')) {
      const shadowRoot = element.tagName === 'INPUT' ? null : openOrClosedShadowRoot(element);
      if (shadowRoot)
        walk(shadowRoot, shadow === 'closed' || shadowRoot.mode === 'closed' ? 'closed' : 'open');
      if (!(element instanceof HTMLInputElement)) continue;
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      if (unnumbered.has(type)) continue;
      const id = `${frameKey}:${String(fields.length)}`;
      ids.set(element, id);
      const expected = element.getAttribute('data-gt');
      element.removeAttribute('data-gt');
      fields.push({
        id,
        type,
        name: element.getAttribute('name'),
        htmlId: element.id || null,
        autocomplete: element.getAttribute('autocomplete'),
        placeholder: element.getAttribute('placeholder'),
        ariaLabel: element.getAttribute('aria-label'),
        shadow,
        visible: isVisible(element),
        expected,
      });
    }
  };
  walk(document, false);
  return fields;
}

function detect({ frameKey }: DetectRequest): FrameDetection {
  const ids = new WeakMap<Element, string>();
  const fields = stamp(frameKey, ids);
  const labels: { id: string; label: FieldLabel }[] = createProtonFormDetector(
    document,
    openOrClosedShadowRoot,
  )
    .detect()
    .map(({ field, label }) => ({
      id: ids.get(field) ?? `unnumbered:${field.tagName.toLowerCase()}`,
      label,
    }));
  return { url: location.href, fields, labels };
}

let answered = false;
document.addEventListener(detectRequestEvent, (event) => {
  // The page's world made the event: in Firefox, an Xray of it, which `instanceof` may not see.
  const { detail } = event as CustomEvent<unknown>;
  if (answered || typeof detail !== 'string') return;
  answered = true;
  let detection: FrameDetection;
  try {
    detection = detect(JSON.parse(detail) as DetectRequest);
  } catch (error) {
    detection = { url: location.href, fields: [], labels: [], error: String(error) };
  }
  document.dispatchEvent(new CustomEvent(detectReplyEvent, { detail: JSON.stringify(detection) }));
});
