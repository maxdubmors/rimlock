import { defineBackground } from 'wxt/utils/define-background';

import { startRouter } from '../background/router';

export default defineBackground({
  // An ES module, so Vite emits the Core's .wasm as its own file and wasm-bindgen's
  // `new URL(…, import.meta.url)` finds it; an IIFE build would inline it as base64.
  type: 'module',
  main() {
    startRouter();
  },
});
