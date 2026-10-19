import type { FieldLabel } from '../../src/autofill/form-detector';

/**
 * The runner and the test extension's content script talk through these events on `document`,
 * the one thing a page's world and a content script's isolated world share. The details are JSON
 * text, which crosses between the worlds unchanged.
 */
export const detectEvent = 'rimlock-autofill-detect';
export const detectionEvent = 'rimlock-autofill-detection';

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
  /** A fixture's expected label (`data-gt`, removed before detection), `none` included. */
  expected: string | null;
};

export type FrameDetection = {
  url: string;
  fields: StampedField[];
  /** What `FormDetector` labelled, by field id; a label on an unnumbered element gets `unnumbered:<tag>`. */
  labels: { id: string; label: FieldLabel }[];
  error?: string;
};
