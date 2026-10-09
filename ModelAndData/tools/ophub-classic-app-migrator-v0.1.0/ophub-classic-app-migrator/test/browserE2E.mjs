// End-to-end: drive the built single-file tool in headless Chromium and validate what it downloads.
// Usage: node test/browserE2E.mjs <classic package.zip> <output dir>
import fs from 'node:fs';
import path from 'node:path';
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
import { problems, validate } from './validateOutput.mjs';

const [pkg, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('file://' + path.resolve('dist/OpsHub-Classic-App-Migrator.html'));
await page.screenshot({ path: path.join(outDir, '1-start.png'), fullPage: true });
await page.setInputFiles('#file', pkg);
await page.screenshot({ path: path.join(outDir, '2-chosen.png'), fullPage: true });
const t0 = Date.now();
await page.click('#convert');
await page.waitForSelector('#result:not([hidden])', { timeout: 300000 });
console.log(`converted in browser in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.screenshot({ path: path.join(outDir, '3-result.png'), fullPage: false });
await page.click('details.page[data-warn]:not([data-warn="0"]) summary').catch(() => {});
await page.screenshot({ path: path.join(outDir, '4-result-full.png'), fullPage: true });

const save = async (sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const file = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
};
const zipFile = await save('#download-package');
const reportFile = await save('#download-report');
console.log('downloads:', path.basename(zipFile), fs.statSync(zipFile).size, 'bytes;', path.basename(reportFile));
await validate('browser output', fs.readFileSync(zipFile));

// Error path: a non-package file.
await page.click('#again');
const junk = path.join(outDir, 'not-a-package.zip');
fs.writeFileSync(junk, 'hello');
await page.setInputFiles('#file', junk);
await page.click('#convert');
await page.waitForSelector('#error:not([hidden])');
console.log('error shown:', await page.textContent('#error'));
await page.screenshot({ path: path.join(outDir, '5-error.png') });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto('file://' + path.resolve('dist/OpsHub-Classic-App-Migrator.html'));
await mobile.screenshot({ path: path.join(outDir, '6-mobile.png') });
await browser.close();
if (errors.length) console.log('PAGE ERRORS:', errors);
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'Browser output valid.');
