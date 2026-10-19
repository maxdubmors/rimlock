/**
 * What a field is for, as rimlock acts on it (autofill.md § Form detection). A field with none of
 * these labels is not offered anything.
 */
export type FieldLabel =
  'username' | 'current-password' | 'new-password' | 'signup-username' | 'otp';

export type LabelledField = { field: HTMLElement; label: FieldLabel };

/**
 * Finds the fields of one frame's document that rimlock can fill, shadow roots included, and
 * labels each. The rest of the Extension knows form detection only through this interface
 * (ADR-0009).
 */
export type FormDetector = {
  detect(): LabelledField[];
};
