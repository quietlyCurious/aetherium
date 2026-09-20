# Aetherium — project context for a new chat

Read this first in a fresh chat, before touching code. It's a technical
map of where things stand, not a feature changelog — those go stale fast,
so this deliberately doesn't try to list everything ever built. For a
narrower, currently-relevant list of known deferred/hidden work, see
`TODO.md` in this same folder.

## How to actually use this in a new chat

Claude's sandbox does **not** carry over between chats — a new chat
starts with an empty `/home/claude`, even though this file (and the rest
of the repo) will look untouched to you on your own laptop. To pick up
work, in the new chat:

1. Paste or upload this file first.
2. Either paste/upload the specific source file(s) you want changed
   (your usual workflow), or give Claude the GitHub link to the file(s)
   on the `main` branch so it can fetch them directly —
   `https://github.com/quietlyCurious/aetherium`.
3. Claude re-creates whatever it needs in its own sandbox from there and
   works from that.

Working rhythm stays the same as it's been: Claude produces full new
versions of whatever files changed, you drop them into your local `src`
folder and commit/push yourself. Claude doesn't commit or push.

## What this app is

Aetherium is a React + DevExtreme 25.x app with two main halves:

- **A page-builder/designer** (Screens, Widgets, Theme, Data Sources,
  Entities, Queries) — the original app, reachable again from the
  title-bar menu (the title reads "Aetherium ▾" there, and the model
  switcher hides, since models only drive the Operator side). Active work
  is on the half below.
- **The Operator/Configurator interface** — a next-gen industrial HMI
  concept: a thin `OperatorWorkspace.jsx` shell plus 46 modules and 7
  stylesheets, all under `src/operator/`. This is where essentially all recent work has
  happened, and is very likely where new work will continue. It was split
  out of one very large file in phases (see `docs/CODE_MAP.html`, the
  full map of how it fits together).

Four simulated industry models exist — **refinery**, **water**,
**wastewater** and **wind** (Boreas Ridge, the first generic pack, built
from `ModelAndData/industries/wind/generate.py`) — each with its own real
asset hierarchy and generated
telemetry, loaded at runtime from `public/data/<model>/*.json` rather
than hardcoded. A model switcher in the title bar (next to the
Operator/Configurator experience switcher) picks which one is active.
The list of models, and which files each one loads, comes from
`public/data/models.json`, so adding an industry is a data-only change
(see `INDUSTRY_PACK_SPEC.md`).

Models come in three **shapes**, and the shape (not the model's name)
decides how the loader and the property lookup behave:

- `generic`: the format for every new industry. Any hierarchy depth,
  data keyed directly by asset id, and its own timeline. This is the
  cleanest path through the code.
- `four-level`: legacy water/wastewater (plant/train/stage/equipment).
- `refinery`: legacy, with its hierarchy in `src/assetData.js`.

Legacy shapes rely on string rules that convert one asset id into
another; generic packs never do. Almost everything in `OperatorWorkspace.jsx` reads from whichever
model's data is currently loaded, not from a specific model by name.

## The two personas, and what each one is for

`OperatorWorkspace.jsx` renders differently depending on
`operatorPersona`:

- **`configurator`** — where display preferences get *set*. Left panel:
  a "Now" work area with **Types** and **Assets** tabs (a type is an
  abstract equipment category like "Bar Screen"; an asset is one real
  instance of it, like "Confluence T01 Bar Screen"). Selecting either
  shows a central preview (`NowTypeMainPreview`) with the same toolbar
  controls (view mode, flex/manual layout, flow direction) either way,
  and a right-hand Details panel (`NowTypeDetailsList`) with
  Properties/Related Assets grids for fine-grained visibility toggling.
  A title-bar Save button persists whatever's currently open.
- **`operator`** — where those preferences get *displayed* to someone
  running the plant. Left rail: Attention (alarms/investigation),
  ~Work~ (task list), Assets (browse any real asset and see it live).

## The core mental model: type-level defaults, asset-level overrides

This is the most important recent architectural addition, so it's worth
being explicit about the shape of it:

- A **type** has a saveable display template (layout/view mode),
  property-visibility config, and related-assets config/template —
  these apply to *every* instance of that type by default.
- A specific **asset** can now save its own version of all four of
  those, which overrides its type's for that one instance only, leaving
  every other instance of the same type unaffected and the type's own
  template completely untouched.
- The **fallback resolution lives in exactly one place**:
  `AssetCard` (the component that renders a single box
  showing one asset's properties, used everywhere — Configurator
  preview, Operator's Assets area, the Investigate panel, the All
  Assets diagram). It checks for an asset-level override first, falls
  back to the type's. Every other view threads `assetDisplayTemplates`/
  `assetPropertyConfigs`/etc. down to this one component rather than
  re-implementing the fallback itself. If a new visual option gets
  added later, it should extend this same resolution point rather than
  being special-cased per view.
- Storage: four `asset*Storage.js` files (`assetDisplayTemplatesStorage`,
  `assetPropertyConfigsStorage`, `assetRelatedAssetConfigsStorage`,
  `assetRelatedAssetsTemplatesStorage`) mirror the shape of the
  pre-existing `type*Storage.js` files exactly, just keyed by real asset
  id instead of type id. All localStorage-backed, no server persistence
  anywhere in this app yet.
- A useful gotcha found the hard way: DevExtreme's `TabPanel`, left
  uncontrolled (no `selectedIndex` prop), silently resets to its first
  tab on *any* unrelated re-render elsewhere in the same big component —
  not just its own interactions. Both the Now area's left tab switcher
  and the right Details panel's tab switcher are deliberately controlled
  (lifted `useState` + `onSelectionChanged`) because of this. If a new
  `TabPanel` gets added anywhere in this file, control it explicitly
  from the start rather than rediscovering this.

## Two related-assets rendering engines, same data underneath

Whenever a set of related assets needs laying out, there are two
interchangeable rendering modes sharing the same row data and the same
box component:

- **Cards** (`AssetCardsView`) — flexbox auto-flow, or a manual
  free-positioning sub-mode (`CardsLayoutCanvas`, itself a React Flow
  canvas used just for drag-positioning, not graph edges).
- **Diagram** (`AssetDiagramView` / `AssetDiagramViewInner`) —
  a real node-link graph via React Flow + elkjs for auto-layout, edges
  meaningful (asset relationships), with its own manual sub-mode too.

`ReadOnlyRelatedAssetsView` wraps both for the read-only contexts
(Operator's Assets area, Investigate panel); the editable Configurator
side calls `AssetCardsView`/`AssetDiagramView` more directly via
`RelatedAssetsEditor`. Both engines' boxes are `AssetCard`
underneath, so the type/asset fallback above applies identically in
either mode without extra work.

## Where things live

- `docs/CODE_MAP.html` — the code map: how the Operator/Configurator code
  is wired, the settings chain, the rendering stack, the patterns to know,
  and where each piece lives. Start here when orienting.
- `src/operator/OperatorWorkspace.jsx` — the shell: loading a model's
  data, and `OperatorWorkspaceInner`, which owns the shared state and
  arranges the panels into slots. Everything it renders sits beside it.
- `src/operator/model/` — the active model's data (`modelData.js`: the
  module-level variables and the loader that writes them; nothing else
  assigns them) and read-only questions about it (`assetQueries.js`).
- `src/operator/settings/` — per-property visuals and visibility
  (`propertyDisplay.js`), display order (`displayOrder.js`), and "which
  assets differ from their type" (`customizations.js`), plus the shared
  stores those publish through, and the toolbar option lists
  (`layoutOptions.js`).
- `src/operator/properties/` — `PropertyTile` and the sparklines (every
  property tile in the app), the property listing (`PropertyTilesView`)
  and `PropertyTileCanvas`, its manual-layout mode.
- `src/operator/relatedAssets/` — `AssetCard` (the fallback resolution
  point above), the Cards and Diagram engines, `AssetCardCanvas`, ELK
  auto-layout, the read-only views, and `relatedAssetRows.js` (which
  related assets an entity shows, in what order — one definition, read
  by the Details grid, the editor preview and the read-only view).
- `src/operator/canvas/` — `ManualLayoutCanvas`, the single canvas behind
  every manual layout (property tiles, asset cards, both diagrams);
  `CanvasAlignControls`, the align/distribute/arrange toolbar groups; and
  `canvasGeometry.js`, the node-bounds and floating-edge maths.
- `src/operator/configurator/` — the Configurator's own panels: the tree,
  the centre preview, the three editors (`PropertyTilesView` is the
  Properties one, plus `RelatedAssetsEditor` and `AllAssetsEditor`), the
  Details grids, the customization controls, and `diagramSettings.jsx`
  (`useDiagramSettings` plus the diagram toolbar controls, shared by both
  diagram editors — add a diagram control there and both get it).
- `src/operator/operatorViews/` — the Operator's own views: NowStrip, the
  issue map, Line Detail, Attention, Investigate and its evidence
  widgets, Work, task detail, the Assets area, and `statusVocabulary.js`
  (the status colour/label maps they all share).
- `src/operator/chrome/` — the two rails, the side panel, Contacts and
  the AI chat panel.
- `src/operator/icons.jsx` — every inline-SVG icon; `badges.jsx` — the
  `AiPill` marker.

When something needs doing in two places, prefer extending the shared
piece over copying it: the canvas, the row builder and the diagram
settings above all exist because the copies had started to drift.

Naming vocabulary, applied throughout as of phase 3: a **tile** is one
property (`PropertyTile`), a **card** is one asset's tiles (`AssetCard`),
a **view** lays tiles or cards out (`PropertyTilesView`, `AssetCardsView`,
`AssetDiagramView`), and an **editor** is a view plus the toolbar and Save
that change it (`RelatedAssetsEditor`, `AllAssetsEditor`). New components
should extend that vocabulary rather than inventing a parallel one. CSS
class names match, as of phase 5: `op-property-tile-*`,
`op-property-tiles-*`, `op-asset-card-*`, `op-manual-canvas`.

- `src/dev_extreme_asset_screen_wizard.jsx` — not imported anywhere right
  now, kept on purpose for future use. Leave it in place.
- `src/App.js` — the outer shell: title bar, nav dropdown, model
  switcher, the title-bar Save button's enablement logic.
- `public/data/models.json` + `src/modelRegistry.js` — the registry of
  industry models (id, label, shape, per-role file overrides), read by both
  the model switcher and `OperatorWorkspace`'s loader. A new industry pack
  is one entry here plus its `public/data/<id>/` folder, with no code
  changes. `INDUSTRY_PACK_SPEC.md` has the full requirements for building
  one, and `ModelAndData/tools/validate_industry_pack.py` checks it.
  `ModelAndData/tools/convert_legacy_to_generic.py` converts a legacy
  four-level pack to the generic format.
- `src/App.css` — title bar and other App.js-level chrome.
- `src/operator/styles/` — the Operator/Configurator styling, seven files
  mirroring the folders above (`base`, `properties`, `canvas`,
  `relatedAssets`, `configurator`, `operatorViews`, `chrome`). Every rule
  for a given class lives in exactly one file, and `App.js` loads them in
  cascade order, base first — so adding a rule means opening the file
  named after the area, not searching 3,000 lines.
- `src/*Storage.js` — one small file per localStorage-backed concern,
  each just a `load*`/`save*` pair with a try/catch around
  `JSON.parse`/`stringify`. New persisted state should follow this same
  one-file-per-concern shape rather than being folded into an existing
  file.
- `src/HierarchyTree.jsx`, `src/DataListGrid.jsx` — small shared
  components reused across both the page-builder and Operator sides.
- `public/data/<model>/*.json` — per-model generated data. Generic packs
  have 8 files (`assets`, `asset-values`, `asset-telemetry`,
  `properties`…, spec §6). The legacy description below is for the
  20-file packs: telemetry
  (multiple points per property, not just current-value snapshots),
  asset relationships, attention/alarm items, work items, property
  labels/tiers/ranges. `station-full-properties.json`'s "current" value
  for a property is always exactly the last point of that same
  property's own series in `station-telemetry.json` — confirmed
  empirically, and load-bearing for the Investigate panel's time-track
  scrubber, which pulls real historical readings from that series
  rather than faking movement.
- `TODO.md` — deliberately deferred/hidden features, each commented out
  in place with a note on why and how to restore it. Check this before
  assuming something unfinished was simply forgotten.

## How Claude verifies changes before handing them back

Given the no-upload workflow, Claude can't lean on you to catch broken
code — the discipline that's worked well across this project:

1. `npx esbuild <file> --bundle=false --outfile=/dev/null` after every
   meaningful edit, before moving to the next one.
2. For anything touching rendering/interaction, a real browser check:
   bundle with esbuild, serve statically, drive it with Playwright
   (`page.screenshot`, DOM/computed-style assertions, not just "did it
   crash"), and actually look at the screenshots rather than trusting
   the assertions alone.
3. A full rebuild + syntax check of every changed file, right before
   delivering.

This has caught real bugs before they reached you — worth keeping up
rather than shortcutting once a change "looks" right in the source.
