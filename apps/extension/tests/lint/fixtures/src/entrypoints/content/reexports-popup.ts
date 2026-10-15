// Violation: content-side code reaches another entrypoint, which may import anything.
export * from '../popup/main';
