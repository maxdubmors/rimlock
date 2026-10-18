// Bytes as base64 text, the form a message carries them in: Chrome's runtime messaging serialises
// messages as JSON, which has no binary type.

/** Fewer arguments than any engine's limit on a call's arguments. */
const chunkLength = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  // btoa, since Uint8Array.prototype.toBase64 is newer than the Chrome floor (Chrome 140).
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunkLength) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkLength));
  }
  return btoa(binary);
}

/** The bytes `text` encodes, or `undefined` if it is not base64. */
export function decodeBase64(text: string): Uint8Array | undefined {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return undefined;
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
