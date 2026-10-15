// V2 probe (throwaway). Usage: node probe-v2.ts <chrome|firefox> <bundle dir>
import type { Page } from 'puppeteer-core';

import { installBrowser, launchWithExtension } from './tests/e2e/browsers.ts';

const [name, bundleDir] = process.argv.slice(2) as ['chrome' | 'firefox', string];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs `code` (an expression over `chrome`) in the page, giving up after 5 s.
async function run(page: Page, code: string): Promise<unknown> {
  const evaluation = page
    .evaluate(`(async () => { const chrome = globalThis.chrome; return await (${code}); })()`)
    .catch((e: unknown) => `evaluate failed: ${String(e).split('\n')[0]}`);
  const timeout = sleep(5000).then(() => 'no answer in 5 s');
  return Promise.race([evaluation, timeout]);
}

const session = await launchWithExtension(name, await installBrowser(name), bundleDir);
const out: Record<string, unknown> = { browser: name, bundleDir };
try {
  const hub = await session.openPage('welcome.html');
  out['background'] = await run(hub, `chrome.runtime.sendMessage({ kind: 'status' }).catch((e) => 'error: ' + e)`);
  const tab = await session.openPage('popup.html?tab');
  await sleep(1500);
  out['tab'] = await run(tab, 'globalThis.probeResult');
  out['openPopup'] = await run(hub, `chrome.action.openPopup().then(() => 'opened', (e) => 'error: ' + e)`);
  if (name === 'chrome') {
    out['createOffscreen'] = await run(
      hub,
      `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'V2 probe' }).then(() => 'created', (e) => 'error: ' + e)`,
    );
  }
  await sleep(3000);
  out['reports'] = await run(hub, 'globalThis.probeResults');
} finally {
  await session.close();
}
console.log(JSON.stringify(out, null, 1));
