# Classic App Migrator for Operations Hub

Converts an Operations Hub app built in the **classic designer** into an app you can open in the **new designer**.

Queries, globals, and widgets carry over with their bindings and actions intact. Each top-level classic container becomes a card, and arranging the cards in the new designer is left to you.

## Using the tool

1. In Operations Hub, export the classic app. You'll get a `.zip` package.
2. Open `OpsHub-Classic-App-Migrator.html` in Chrome or Edge (double-click it). No install or internet connection is needed, and the package never leaves your computer.
3. Drop the `.zip` onto the page and choose **Convert app**.
4. Download the new package and the migration report.
5. Import the new package into Operations Hub, open it in the new designer, and arrange the cards. Use the report's **Needs attention** list as your checklist.

By default the converted app is imported **as a separate app**, named "*Your App* (New Designer)" with fresh ids. That way it can never replace the classic app on the same server. Untick the option to keep the original name and ids.

## What carries over

| Classic | New designer |
|---|---|
| Pages, page menu, icons, permissions | Same pages, one-to-one |
| Queries (data flows) | Unchanged |
| Globals | Unchanged; input/dropdown "component" globals and query-fed globals become regular globals with the same ids |
| Plugin widgets (Plant Apps, GE plugins, charts…) | Same plugin, settings and actions preserved |
| Text, Header | `text` plugin |
| Image, Button | `image`, `button` plugins (click actions preserved) |
| Dropdown, Input | `GEDropdown`, `textbox` plugins (write to the same global/query input) |
| Table | `DataGrid` |
| Visualization, Graph | `chartLine`, or `chartPie` for pie/donut |
| Bar Graph | `gaugeLinear` |
| HTML (custom code) | `GEHtmlEditor` (code moved; scripts using the classic EMBED API need updating) |
| New Line, Interactive Map | Skipped (no equivalent) |
| Containers | Top-level containers → cards; nested containers flattened |

**Visibility and show/hide behavior is preserved through flattening.** Conditions and "starts hidden" on a container move to its card, or pass down to the widgets inside it. Show/hide actions that targeted a nested container now target each widget that was inside it.

Everything that couldn't be carried over exactly is listed in the report, with what to do about it.

## For developers

```
npm install
npm test -- <folder of classic .zip packages> <out dir>   # convert each one and validate the output
npm run build     # -> dist/OpsHub-Classic-App-Migrator.html (single self-contained file)
npm run test:browser -- <classic.zip> <out dir>   # drive the built tool in headless Chromium
```

`src/` layout:

| Module | Job |
|---|---|
| `packageConverter.js` | Whole package: read zip/XML, convert globals and pages, write zip |
| `packageIO.js` | Zip in/out, plugin manifests from nested plugin zips |
| `pageConverter.js` | One page: plan cards (pass 1), convert widgets and lay out cards (pass 2) |
| `widgets/` | One converter per classic widget family, plus `index.js` registry |
| `bindings.js`, `actions.js`, `conditions.js`, `globals.js` | Shared translation of data sources, click actions, visibility, globals |
| `newDesignerShapes.js` | Builders for root/grid/card/widget objects |
| `pluginCatalog.js` | Manifests → `pluginInfo`; list of plugins verified in the new designer |
| `reference/reference.json` | Templates and manifests extracted from real exports (`scripts/extract_reference.py`) |
| `ui/` | Single-page tool and the report renderer (shared by the page and the downloadable report) |

The converter is environment-neutral: Node tests pass `jszip` and `@xmldom/xmldom`, while the browser passes its native `DOMParser`/`XMLSerializer`.

To add a widget mapping, write a converter in `src/widgets/` returning `{ typeName, data, size, label, notes }`, register it in `widgets/index.js`, and add the target plugin to `MAPPED_TARGETS` in `scripts/extract_reference.py`.
