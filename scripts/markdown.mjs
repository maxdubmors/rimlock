// What the Markdown scripts agree on (check-md-sentences.mjs, check-copied-text.mjs).

/** A trimmed line that opens a block: a list item, heading, quote, table row, HTML or a fence. */
export const opensBlock = /^(?:[-*+](?:\s|$)|\d+[.)](?:\s|$)|#|>|\||<|```|~~~)/;

/** A line that opens or closes fenced code. */
export const fence = /^\s*(?:```|~~~)/;
