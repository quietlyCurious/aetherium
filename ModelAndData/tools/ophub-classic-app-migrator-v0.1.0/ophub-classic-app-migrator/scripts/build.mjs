// Bundles the browser tool into one self-contained HTML file: dist/OpsHub-Classic-App-Migrator.html
import fs from 'node:fs';
import { build } from 'esbuild';

const pkgVersion = (await import('../src/packageConverter.js')).TOOL_VERSION;
const font = (w) => fs.readFileSync(`node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${w}-normal.woff2`).toString('base64');
const fontFaces = [400, 700].map((w) =>
  `@font-face{font-family:'Atkinson Hyperlegible';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${font(w)}) format('woff2');}`).join('\n');

const result = await build({
  entryPoints: ['src/ui/app.js'], bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  minify: true, write: false, loader: { '.json': 'json' }, legalComments: 'inline',
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = fs.readFileSync('src/ui/template.html', 'utf8')
  .replace('{{FONT_FACES}}', () => fontFaces)
  .replace('{{STYLES}}', () => fs.readFileSync('src/ui/styles.css', 'utf8'))
  .replace('{{SCRIPT}}', () => script)
  .replace('{{VERSION}}', pkgVersion);

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/OpsHub-Classic-App-Migrator.html', html);
console.log(`dist/OpsHub-Classic-App-Migrator.html  ${(html.length / 1024).toFixed(0)} KB`);
