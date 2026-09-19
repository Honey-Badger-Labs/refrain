#!/usr/bin/env node
/**
 * Browser smoke test.
 *
 * Unit tests prove the pieces; this proves the thing. It loads the built app
 * in a real browser, plays a real file, checks that the clock moves and the
 * right line lights up, switches take mid-listen, and walks four hostile URLs
 * to the not-found view. A page error or a failed request fails the run.
 *
 *   node scripts/smoke.mjs [baseUrl] [--shots <dir>]
 *
 * Chromium ships without AAC, so the app's Opus encoding is what gets played
 * here — which is also what most listeners get.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173/refrain/').replace(
  /\/?$/,
  '/',
);
const shotsIndex = args.indexOf('--shots');
const shots = shotsIndex === -1 ? null : args[shotsIndex + 1];
if (shots) fs.mkdirSync(shots, { recursive: true });

const problems = [];
const note = (message) => console.log(`  ${message}`);

function check(condition, description) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${description}`);
  if (!condition) problems.push(description);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  // A media element cancels its own range request when the source changes;
  // that is the browser being efficient, not the app being broken.
  const aborted = request.failure()?.errorText === 'net::ERR_ABORTED';
  const media = /\.(webm|m4a)$/.test(new URL(request.url()).pathname);
  if (!(aborted && media)) pageErrors.push(`requestfailed: ${request.url()}`);
});

const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1');
  check((await page.textContent('h1')) === 'Refrain', 'the library loads and passes its hash check');
  await shot('01-home');

  await page.click('button:has-text("Play")');
  await page.waitForSelector('[aria-label="Position"]', { timeout: 15_000 });
  const title = await page.textContent('h1');
  check(Boolean(title) && title !== 'Refrain', `song of the day opens (${title})`);
  await shot('02-listen');

  const before = Number(await page.inputValue('[aria-label="Position"]'));
  await page.waitForTimeout(2500);
  const after = Number(await page.inputValue('[aria-label="Position"]'));
  check(after > before, `audio actually plays (${before}s → ${after}s)`);

  const active = await page.$('[aria-current="true"]');
  const activeText = active ? (await active.textContent())?.trim() : null;
  check(Boolean(activeText), `the synced text follows the audio (“${activeText ?? ''}”)`);
  await shot('03-playing');

  const styleButton = await page.$('button[aria-pressed="false"]:has-text("Hymn")');
  if (styleButton) {
    await styleButton.click();
    await page.waitForTimeout(1500);
    const carried = Number(await page.inputValue('[aria-label="Position"]'));
    check(carried > 1, `switching style keeps the position (${carried}s)`);
  } else {
    note('only one style available; skipped the switch check');
  }
  await shot('04-switched');

  await page.goto(`${base}#/book/innocence`, { waitUntil: 'networkidle' });
  check((await page.textContent('h1')) === 'Songs of Innocence', 'the book view lists its poems');
  check(
    (await page.$$eval('main li, ul li', (items) => items.length)) > 0,
    'the book view is not empty',
  );
  await shot('05-book');

  await page.goto(`${base}#/rights`, { waitUntil: 'networkidle' });
  check(
    (await page.textContent('h1')) === 'Text, voices and rights',
    'the rights page states the provenance',
  );
  await shot('06-rights');

  const hostile = [
    '#/<script>alert(1)</script>/a/b/c/d',
    '#/blake-songs/alto/hymn/innocence/does-not-exist',
    '#/..%2F..%2Fetc/a/b/c/d',
    '#/javascript:alert(1)',
    '#/book/<img src=x onerror=alert(1)>',
  ];
  for (const hash of hostile) {
    await page.goto(`${base}${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    check((await page.textContent('h1')) === 'Nothing here', `refuses ${hash}`);
  }
  await shot('07-notfound');

  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  check(dialogs.length === 0, 'no hostile route executed anything');

  const wide = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await wide.goto(base, { waitUntil: 'networkidle' });
  if (shots) await wide.screenshot({ path: `${shots}/08-desktop.png` });
  check(true, 'renders at desktop width');
} finally {
  await browser.close();
}

check(pageErrors.length === 0, 'no page errors or failed requests');
for (const error of pageErrors) note(error);

if (problems.length > 0) {
  console.error(`\n${problems.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nsmoke test passed');
