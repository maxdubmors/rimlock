import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  main() {
    // Stub: FormDetector, Fill and the Inline menu host arrive with M2.
  },
});
