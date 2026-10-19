import type { FieldLabel } from '../../src/autofill/form-detector';

/** A field's label, or `none` for a field nothing is offered on. */
export type ExpectedLabel = FieldLabel | 'none';

/**
 * The runner and the test extension's content script talk through these events on `document`,
 * the one thing a page's world and a content script's isolated world share. The details are JSON
 * text, which crosses between the worlds unchanged.
 */
export const detectRequestEvent = 'rimlock-autofill-detect-request';
export const detectReplyEvent = 'rimlock-autofill-detect-reply';

export type DetectRequest = { frameKey: string };

/** One `<input>` of a frame, numbered in document order with shadow roots included. */
export type StampedField = {
  /** `<frameKey>:<index>`, the key `live-corpus.json` labels fields by. */
  id: string;
  type: string;
  name: string | null;
  htmlId: string | null;
  autocomplete: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  shadow: false | 'open' | 'closed';
  visible: boolean;
  /** A fixture's expected label (`data-gt`, removed before detection), as the page spells it. */
  expected: string | null;
};

export type FrameDetection = {
  url: string;
  fields: StampedField[];
  /** What `FormDetector` labelled, by field id; a label on an unnumbered element gets `unnumbered:<tag>`. */
  labels: { id: string; label: FieldLabel }[];
  error?: string;
};
