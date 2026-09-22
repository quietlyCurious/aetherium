// scripts/generateWidgetOptions.js
// Writes public/data/widget-options.json — every option each DevExtreme
// widget accepts, read from DevExtreme's own TypeScript declarations in
// node_modules. The Widgets area's "available options" list is built from
// it (designer/widgets/widgetOptionCatalog.js).
//
//   node scripts/generateWidgetOptions.js
//   REPORT_COLLAPSE=1 node scripts/generateWidgetOptions.js   (see below)
//
// Re-run it after upgrading DevExtreme and commit the result. It reads
// node_modules/devextreme, so run it after npm install.
//
// Why the declarations: they carry the whole option tree including
// inherited options, and string unions give an option's real choices
// ('inside' | 'outside' | 'center'), which nothing else has. What they
// don't carry is default values — those are merged in from
// src/widgetConfigs.js where it has them, which is the other half of why
// that file still exists.
//
// REPORT_COLLAPSE=1 prints every option whose sub-options were too many to
// list (MAX_SUBTREE) — the way to see what a bigger budget would buy.
//
// What's left out on purpose: event handlers (onXxx), templates, deprecated
// options, and the localization text blocks (texts.*, format.*), none of
// which belong in a details panel. Everything else comes through, down to
// MAX_DEPTH levels of nesting.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const DEVEXTREME = path.join(ROOT, 'node_modules', 'devextreme');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'widget-options.json');

const MAX_DEPTH = 3;
// A nested option that turns out to hold a whole widget's worth of options
// (a grid's filterBuilderPopup, a popover's animation) is kept as one JSON
// leaf rather than several hundred rows nobody will scroll past. Without
// this the file is 100k options and 8MB.
const MAX_SUBTREE = 160;
const SKIP_LAST = /^(onEventName|elementAttr|integrationOptions)$/;
const SKIP_SEGMENT = /^(texts|_)/;   // localization blocks and internals
const SKIP_NAME = /(^on[A-Z])|Template$|^bindingOptions$/;

// Options every widget inherits from the base component and that a page
// builder has no use for — the container already owns size and placement,
// and the rest are framework plumbing.
const NOISE = new Set([
  'accessKey', 'tabIndex', 'rtlEnabled', 'focusStateEnabled', 'activeStateEnabled',
  'twoWayBindingEnabled', 'renderAsync', 'aiIntegration', 'integrationOptions',
  'selectionFilter', 'filterValue', 'stateStoring',
]);

// name → snake_case, the way DevExtreme names its files.
function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

// Every widget module exports its options as `Properties`. Some are
// generic (a grid's Properties<TRowData, TKey>), so rather than reading the
// declaration — which leaves the type parameters unresolved and silently
// drops options like selection.mode — this writes one throwaway .ts file
// that imports each widget's Properties and declares a value of it. Asking
// for THAT value's type gets the generics instantiated with their defaults,
// which is the whole option set as a page would see it.
function moduleFor(widgetName) {
  const file = `${snake(widgetName)}.d.ts`;
  for (const dir of ['ui', 'viz']) {
    if (fs.existsSync(path.join(DEVEXTREME, dir, file))) return `devextreme/${dir}/${snake(widgetName)}`;
  }
  return null;
}

const PROBE_FILE = path.join(ROOT, 'node_modules', '.widget-options-probe.ts');

function buildProbe(names) {
  const modules = new Map();
  const lines = [];
  names.forEach((name, i) => {
    const module = moduleFor(name);
    if (!module) return;
    modules.set(name, `probe${i}`);
    lines.push(`import type { Properties as Options${i} } from '${module}';`);
    lines.push(`declare const probe${i}: Options${i};`);
  });
  fs.writeFileSync(PROBE_FILE, `${lines.join('\n')}\n`);
  return modules;
}

function probeTypes(program, checker, modules) {
  const sourceFile = program.getSourceFile(PROBE_FILE);
  const types = new Map();
  const byProbe = new Map([...modules].map(([widget, probe]) => [probe, widget]));
  ts.forEachChild(sourceFile, node => {
    if (!ts.isVariableStatement(node)) return;
    node.declarationList.declarations.forEach(declaration => {
      const widget = byProbe.get(declaration.name.getText());
      if (widget) types.set(widget, checker.getTypeAtLocation(declaration.name));
    });
  });
  return types;
}

// ── Reading one option's type ───────────────────────────────────────────────

// DOM and jQuery types leak into the declarations wherever an option can
// take an element (a popup's dialogTrigger, a column chooser's container).
// Walking those produces ownerDocument.defaultView and several hundred
// other browser properties, so they're dropped rather than offered.
function isDomType(checker, type) {
  const name = checker.typeToString(type);
  if (/^(HTML[A-Za-z]*Element|SVG[A-Za-z]*Element|Element|Node|Document|Window|ShadowRoot|DOMRect|CSSStyleDeclaration|JQuery|UserDefinedElement)\b/.test(name)) return true;
  return checker.getPropertiesOfType(type).some(p => p.getName() === 'ownerDocument' || p.getName() === 'nodeType');
}

function isCallable(checker, type) {
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return true;
  // A function object reached through a union looks like a plain object but
  // its "options" are caller/apply/bind. Nothing to expose there.
  return checker.getPropertiesOfType(type).some(p => p.getName() === 'apply' || p.getName() === 'caller');
}

function isDeprecated(symbol) {
  return (symbol.getJsDocTags() || []).some(tag => tag.name === 'deprecated');
}

// An option becomes one of the details panel's types, plus, for an object,
// the sub-type to walk into. A union is read as a whole: string literals in
// it are the option's choices, and an object member in it (a gauge's
// `title: BaseWidgetTitle | string`) is still walked, so title.text is
// reached rather than lost behind the string.
function classify(checker, type) {
  if (type.isUnion()) {
    const parts = type.types.filter(t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    const literals = parts.filter(t => t.isStringLiteral()).map(t => t.value);
    const object = parts.find(t => (t.flags & ts.TypeFlags.Object) && !checker.isArrayType(t) && !isCallable(checker, t));
    if (object) return { kind: 'object', walk: object, choices: literals.length ? literals : undefined };
    if (literals.length) return { kind: 'enum', choices: literals };
    if (parts.length === 1) return classify(checker, parts[0]);
    const scalar = parts.find(t => t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike));
    return scalar ? classify(checker, scalar) : { kind: null };
  }
  // An intersection (a grid's `Editing` is EditingBase & extras) isn't an
  // object type by flags, but its properties read the same way — and these
  // are exactly the options a grid adds to the base, so missing them loses
  // selection.mode, editing.mode, pager.visible and the rest.
  if (type.isIntersection()) return isDomType(checker, type) ? { kind: null } : { kind: 'object', walk: type };
  if (type.flags & ts.TypeFlags.BooleanLike) return { kind: 'bool' };
  if (type.flags & ts.TypeFlags.NumberLike) return { kind: 'number' };
  if (type.flags & ts.TypeFlags.StringLike) return { kind: 'string' };
  if (checker.isArrayType(type)) return { kind: 'json' };
  if (isCallable(checker, type)) return { kind: null };
  if (type.flags & ts.TypeFlags.Object) {
    return isDomType(checker, type) ? { kind: null } : { kind: 'object', walk: type };
  }
  // `any` (an editor's `value`, mostly): treated as text, which is what
  // those hold in practice. The type is changed under the row's ⋯ when it
  // isn't.
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { kind: 'string' };
  return { kind: null };
}

// The options under one type, as details-panel leaves. A sub-object is
// walked when it's worth walking — shallow enough, and small enough once
// walked (MAX_SUBTREE); otherwise it stays one JSON leaf.
function walkOptions(checker, type, prefix, depth, seen) {
  const out = [];
  for (const symbol of checker.getPropertiesOfType(type)) {
    const name = symbol.getName();
    const declaration = symbol.valueDeclaration || (symbol.declarations || [])[0];
    if (!declaration) continue;
    if (SKIP_NAME.test(name) || SKIP_LAST.test(name) || SKIP_SEGMENT.test(name) || NOISE.has(name)) continue;
    if (isDeprecated(symbol)) continue;

    const full = prefix ? `${prefix}.${name}` : name;
    const optionType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const { kind, walk, choices } = classify(checker, optionType);

    if (walk) {
      // Guard against an option type that contains itself.
      const id = checker.typeToString(walk);
      const nested = depth < MAX_DEPTH && !seen.has(id) ? (() => {
        seen.add(id);
        const result = walkOptions(checker, walk, full, depth + 1, seen);
        seen.delete(id);
        return result;
      })() : [];
      if (process.env.REPORT_COLLAPSE && nested.length > MAX_SUBTREE) console.error(`COLLAPSE ${full} ${nested.length}`);
      if (nested.length > 0 && nested.length <= MAX_SUBTREE) { out.push(...nested); continue; }
      // Too big, too deep, or nothing editable inside: one JSON leaf.
      out.push({ n: full, t: 'json' });
      continue;
    }
    if (!kind) continue;
    out.push(choices ? { n: full, t: kind, o: choices } : { n: full, t: kind });
  }
  return out;
}

// ── Defaults, from the configuration file we already have ───────────────────

function loadConfigDefaults() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'widgetConfigs.js'), 'utf8')
    .replace('export default WIDGET_CONFIGS;', 'module.exports = WIDGET_CONFIGS;');
  const module = { exports: {} };
  new Function('module', 'exports', source)(module, module.exports); // eslint-disable-line no-new-func
  const flat = {};
  const walk = (value, prefix, into) => {
    Object.entries(value).forEach(([key, v]) => {
      const name = prefix ? `${prefix}.${key}` : key;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) walk(v, name, into);
      else if (typeof v !== 'function' && v !== undefined) into[name] = v;
    });
  };
  Object.entries(module.exports).forEach(([widget, config]) => { flat[widget] = {}; walk(config, '', flat[widget]); });
  return flat;
}

// ── Run ─────────────────────────────────────────────────────────────────────

// The property lists the app ships, for the drift report below.
function loadExposedProperties() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'widgetProperties.js'), 'utf8')
    .replace('export { WIDGET_PROPERTIES };', 'module.exports = WIDGET_PROPERTIES;');
  const module = { exports: {} };
  new Function('module', 'exports', source)(module, module.exports); // eslint-disable-line no-new-func
  return module.exports;
}

function widgetNames() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'widgetData.js'), 'utf8')
    .replace('export { DX_WIDGET_DATA };', 'module.exports = DX_WIDGET_DATA;');
  const module = { exports: {} };
  new Function('module', 'exports', source)(module, module.exports); // eslint-disable-line no-new-func
  return module.exports.filter(w => w.assetLevel === 'widget').map(w => w.name);
}

function main() {
  const names = widgetNames();
  const modules = buildProbe(names);

  const program = ts.createProgram([PROBE_FILE], {
    strict: false,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    target: ts.ScriptTarget.ES2020,
  });
  const checker = program.getTypeChecker();
  const optionTypes = probeTypes(program, checker, modules);
  const defaults = loadConfigDefaults();

  const widgets = {};
  const missing = [];
  names.forEach(name => {
    const type = optionTypes.get(name);
    if (!type) { missing.push(name); return; }
    const options = walkOptions(checker, type, '', 0, new Set());
    const withDefaults = options.map(option => {
      const value = defaults[name]?.[option.n];
      return value === undefined || value === null ? option : { ...option, d: value };
    });
    withDefaults.sort((a, b) => a.n.localeCompare(b.n));
    widgets[name] = withDefaults;
  });

  const { version } = JSON.parse(fs.readFileSync(path.join(DEVEXTREME, 'package.json'), 'utf8'));
  const output = {
    devextremeVersion: version,
    generatedAt: new Date().toISOString().slice(0, 10),
    generatedBy: 'scripts/generateWidgetOptions.js',
    widgets,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 1)}\n`);
  fs.unlinkSync(PROBE_FILE);

  // What the app exposes today but the catalog doesn't list — usually an
  // option DevExtreme has since renamed or deprecated. Nothing breaks (the
  // Widgets area always gives an exposed property a row), but after a
  // DevExtreme upgrade this is the list worth reading.
  const exposed = loadExposedProperties();
  const drifted = [];
  Object.entries(exposed).forEach(([widget, defs]) => {
    const names = new Set((widgets[widget] || []).map(o => o.n));
    defs.forEach(def => { if (!names.has(def.name)) drifted.push(`${widget}.${def.name}`); });
  });

  const total = Object.values(widgets).reduce((sum, list) => sum + list.length, 0);
  const withChoices = Object.values(widgets).reduce((sum, list) => sum + list.filter(o => o.o).length, 0);
  const withDefaults = Object.values(widgets).reduce((sum, list) => sum + list.filter(o => 'd' in o).length, 0);
  console.log(`DevExtreme ${version}`);
  console.log(`${Object.keys(widgets).length} widgets, ${total} options (${withChoices} with choices, ${withDefaults} with defaults)`);
  console.log(`→ ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
  if (missing.length) console.log(`no declarations found for: ${missing.join(', ')}`);
  if (drifted.length) {
    console.log(`\nexposed in widgetProperties.js but not in the catalog (${drifted.length}) —`);
    console.log(`DevExtreme may have renamed or deprecated these; they still work, they're just not offered:`);
    drifted.forEach(name => console.log(`  ${name}`));
  }
}

main();
