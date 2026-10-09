// Convert every classic sample package and validate the output.
// Usage: node test/convertSamples.mjs <classic packages dir> <output dir>

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { convertPackage } from '../src/packageConverter.js';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('Usage: npm test -- <folder of classic .zip packages> <output folder>');
  process.exit(2);
}
const reference = JSON.parse(fs.readFileSync(new URL('../src/reference/reference.json', import.meta.url)));
fs.mkdirSync(outDir, { recursive: true });

import { problems, validate } from './validateOutput.mjs';

for (const file of fs.readdirSync(inDir).filter((f) => f.endsWith('.zip')).sort()) {
  const t0 = Date.now();
  const bytes = fs.readFileSync(path.join(inDir, file));
  const { bytes: out, outputFileName, report } = await convertPackage(
    { JSZip, DOMParser, XMLSerializer, reference },
    { bytes, fileName: file },
  );
  fs.writeFileSync(path.join(outDir, outputFileName), out);
  fs.writeFileSync(path.join(outDir, outputFileName.replace(/\.zip$/, '.report.json')), JSON.stringify(report, null, 1));
  const inCount = Object.values((await JSZip.loadAsync(bytes)).files).filter((f) => !f.dir).length;
  const outCount = await validate(report.appName, out);
  if (inCount !== outCount) fail(report.appName, `entry count ${inCount} -> ${outCount}`);
  const s = report.summary();
  console.log(`${report.appName.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(1)}s  pages=${s.pages} cards=${s.cards} queries=${s.queries} globals=${s.globals} copied=${s.copied} mapped=${s.mapped} skipped=${s.skipped} warnings=${s.warnings}`);
}

console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n` + problems.slice(0, 60).join('\n') : '\nAll outputs valid.');
process.exitCode = problems.length ? 1 : 0;
