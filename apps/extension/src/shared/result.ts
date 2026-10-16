/**
 * The outcome of an operation that can fail: callers switch on it instead of catching. The Core's
 * and the Sources' results take this shape (docs/spec/core-api.md § 8, § 10).
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
