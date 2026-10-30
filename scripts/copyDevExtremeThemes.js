// scripts/copyDevExtremeThemes.js
// Copies the DevExtreme theme stylesheets the app styles use (listed in
// src/styles/appStyles.json), plus the icon and font folders they reference,
// from node_modules into public/devextreme-themes/ so the app can switch
// between them at runtime. Runs automatically before `npm start` and
// `npm run build` (prestart / prebuild in package.json). The output folder is
// generated — it's in .gitignore.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'devextreme', 'dist', 'css');
const target = path.join(root, 'public', 'devextreme-themes');
const { styles } = require(path.join(root, 'src', 'styles', 'appStyles.json'));

if (!fs.existsSync(source)) {
  console.error('copyDevExtremeThemes: devextreme is not installed — run npm install first.');
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });

const files = [...new Set(styles.map(s => s.dxFile))];
for (const file of files) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}
for (const folder of ['icons', 'fonts']) {
  fs.cpSync(path.join(source, folder), path.join(target, folder), { recursive: true });
}

console.log(`copyDevExtremeThemes: ${files.length} themes copied to public/devextreme-themes/`);
