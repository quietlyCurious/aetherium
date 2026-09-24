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
  Entities, Queries, Asset Sets, Scripts) — the original app, now areas on
  the Configuration Experience's left rail, alongside Visualization (see
  "The designer half"). The model switcher applies in Visualization,
  Screens and Asset Sets, and is dimmed in the other areas, which don't
  use a model.
- **The Operator/Configurator interface** — a next-gen industrial HMI
  concept: a thin `OperatorWorkspace.jsx` shell plus 45 modules and 7
  stylesheets, all under `src/operator/`. This is where essentially all recent work has
  happened, and is very likely where new work will continue. It was split
  out of one very large file in phases (see `docs/CODE_MAP.html`, the
  full map of how it fits together).

Eight simulated industry models exist — **refinery**, **water**,
**wastewater**, **wind** (Boreas Ridge), **ccgt**, **pipeline**,
**pharma** and **grid** — each with its own real asset hierarchy and
generated telemetry, loaded at runtime from `public/data/<model>/*.json`
rather than hardcoded. A model switcher in the title bar (next to the
workspace menu) picks which one is active.
The list of models, and which files each one loads, comes from
`public/data/models.json`, so adding an industry is a data-only change
(see `INDUSTRY_PACK_SPEC.md`).

Every model uses the one **generic** pack format (spec §6): any
hierarchy depth, data keyed directly by asset id, and its own timeline.
Refinery, water and wastewater were originally built in two older
layouts and were converted in Sept 2026 (spec §12); the old formats,
their id-conversion rules and the refinery-only Issue Map and Line
Detail are gone. Everything in `src/operator/` reads from whichever
model's data is currently loaded, never from a specific model by name.
So does the designer's Screens area (its Data tab's Model view and the
Create wizard): `src/model/useLoadedModel.js` fetches and
activates the title bar's model for whichever area needs it, and skips
the fetch when that model is already active.

## The two personas, and what each one is for

The app has two workspaces, picked from the title-bar menu: the
**Operator Experience** and the **Configuration Experience**. The
Configuration Experience's left rail holds Visualization (below), then the
page-builder areas (Design: Screens, Widgets, Theme) and the data
definitions (Data: Data Sources, Entities, Queries, Asset Sets, Scripts) — see "The
designer half". `OperatorWorkspace.jsx` renders both the Operator
Experience and Visualization, differently depending on `operatorPersona`:

- **`configurator`** (Visualization) — where display preferences get *set*. Left panel:
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

## The designer half (Screens, Widgets, Theme, Data Sources, Entities, Queries, Asset Sets)

Not refactored the way the Operator side was — it isn't seven comparable
areas. Screens is the big one (its own folder, below); Widgets has its
own folder too (below); Theme and Scripts are small; Data Sources,
Entities, Queries and Asset Sets are "a list of definitions plus an
editor".

Those four share `src/designer/DefinitionWorkspace.jsx`: it owns
selection, the confirm-before-losing-edits prompt, and publishing the open
editor's dirty state to `unsavedChangesStore` — the same store the
Configurator uses, which is what puts the amber dot on the title-bar Save.
Each area supplies its nouns, its list columns and its editor. An editor
exposes `isDirty()` and `save()` on its ref and reports dirty changes;
`useDefinitionDraft` does both halves of that for a simple form editor.

**Asset sets** (`src/model/assetSets.js`, area in `src/designer/assetSets/`)
are named ways of producing a list of asset ids from the loaded model —
the groundwork for a repeater widget that draws a screen per asset.
Kinds: *picked* (a hand-chosen list), *rule* (where to look, types,
attention, property conditions, and optionally the lowest/highest N by a
property — best/worst performers) and *query* (placeholder, not built).
A rule can look under a *start* asset given when it's used, the way a
query takes inputs, so "Turbines of a feeder" is one definition a feeder
screen would pass itself to. A set belongs to one model (`modelId`); the
area loads the title bar's model and lists that model's sets.
`resolveAssetSet(set, { start })` returns the ids plus the narrowing
steps the editor's preview shows. App holds the list with
`designer/useStoredDefinitions.js` (the other definition lists still have
hand-written handlers of the same shape). Switching model asks the open
area the same leave question as navigating away.

The workspaces and their areas are listed once, in
`src/shell/appAreas.js`: label, rail group, icon, and what the title-bar
Save says there. The title-bar menu lists the workspaces; the left rail
(`src/shell/AreaRail.jsx`) lists the open workspace's areas. The
Configuration Experience's rail is drawn by App, outside its areas, so it
stays put while you move between them; the Operator's is drawn inside
OperatorWorkspace, which owns its counts. The Configuration Experience
reopens on the area you last used in it. Clicking Visualization again
hides its list panel (OperatorWorkspace's `toggleListPanel`). The model
switcher is dimmed outside Visualization, Screens and the Operator, and Launch only
shows in Screens. Every area gives App the same handle — `save()` and
`confirmLeave()` (true, or a promise of true, to go ahead) — and
navigating asks only the area being left: the definition areas confirm
(leaving drops their unsaved edits), the Configurator shows its
Save/Discard dialog, and Screens asks nothing, because its canvas lives in
App and is still there when you come back. Every area with something to
save publishes its unsaved state to `unsavedChangesStore`, which lights the
Save button's amber dot.

**Widgets** (`src/designer/widgets/`) decides which of each widget's
DevExtreme options the Screens designer exposes. The shipped lists are
`src/widgetProperties.js` (split out of `widgetData.js`, which now holds
only the catalog). **Nothing reads that file directly**: every reader —
`ContainerDetails`, `MultiSelectionDetails`, `makeWidgetContainer`,
`widgetBindings`, the binding popover — goes through
`widgetPropertyDefs.js` (`getWidgetPropertyDefs`,
`useWidgetPropertyOverrides`), which layers the Widgets area's saved
edits on top. A widget with saved edits uses its saved list in full
(not a diff), stored per browser by `widgetPropertyOverridesStorage.js`.
The area's Export writes every list back out as a complete
`widgetProperties.js` (`widgetPropertiesSource.js`, in a .zip via
`zipFile.js`, or to the clipboard); commit it and any saved list that now
matches is dropped on the next load. The committed file is itself
exporter output, and a test checks they stay byte-identical — if you
hand-edit `widgetProperties.js`, keep the exporter's layout or that test
fails. The option list comes from
`public/data/widget-options.json` — all 75 widgets, real types and real
enum choices, generated from DevExtreme's own TypeScript declarations by
`scripts/generateWidgetOptions.js` (`npm run widget-options`; re-run it
after upgrading DevExtreme and commit the result, and read its drift
report). It's fetched by the Widgets area alone
(`widgetOptionsFile.js`), not bundled, since it's ~700 KB and no other
area needs it. `widgetConfigs.js` stays for two jobs: the defaults merged
into the catalog, and the in-browser fallback list if the file can't be
loaded (40 widgets, types guessed from names and flagged). A widget can
have several hundred options, so the list pins what's exposed at the top,
in details-panel order, and keeps the rest under closed group headings.
Options can also be added by path. A definition is `{ name, label, type,
options?, default, bindable?, group? }`; `type` gained `color` and `json`
(a list or object — a grid's `columns`, a gauge's `rangeContainer.ranges`
— edited as raw JSON in `JsonField`, committed only when it parses), and a
`group` is a heading in the details panel. Groups are derived, not stored:
a property with no `group` of its own is grouped by the first part of its
path (`optionNaming.groupOfDef`), so the details panel's headings match
the Widgets area's option list — for the shipped lists too — and a group
appears only when something in it is exposed.
`WidgetPropertyField` / `WidgetPropertyGrid` draw a widget's properties
for both the Screens details panel and the area's preview, so the preview
is the real panel. The area is two panels: the options list
(`WidgetOptionsEditor`), where a row is ticked to expose it and carries
the default value a new widget starts with, with label/type/choices/group/
bindable behind its ⋯ (`OptionAdvancedFields`); and the preview. Every
row draws the same columns whether or not it's exposed — path, the label
the details panel will use (read-only; it's changed under ⋯), type, the
control it's edited with (disabled until ticked, showing what the widget
defaults to today), and the ⋯ — so everything lines up down the list. Exposing
appends to the end of the list and nothing else moves — the list's order
is what the details panel shows, so a different order is a change to the
committed `widgetProperties.js`, not something the area does. The edits
themselves are plain functions on the list in `widgetPropertyEdits.js`
(the same split Screens has between `screenEdits.js` and its components).

Showing a saved screen is split out of the editor into
`src/designer/screens/`, so anything can render one — the Launch view
today, an asset visualization later:
- `widgetBindings.js` — turns a widget's static props plus its bindings
  into the props it renders with. One resolver per binding type
  (`expression`, `query`, `asset`) in `BINDING_RESOLVERS`; a new kind of
  binding is one more entry. `ContainerCard` calls it, so the canvas and
  the runtime resolve identically. It also gives a Chart with real rows a
  default series (DevExtreme draws nothing from `commonSeriesSettings`
  alone) and drops an empty series template.
- `usePageQueryResults(pageId)` — runs a page's query instances (plus
  app-scoped ones) on mount and every `POLL_INTERVAL_MS`.
- `ScreenView` — renders a page's containers read-only through
  `ContainerCard`, supplying all its editing callbacks as no-ops, and
  optionally for one asset (`assetId`, its self).
`RuntimeView.jsx` is now just `loadPage` + the hook + `ScreenView` inside
the title bar (plus loading the model for a screen about a type).

**Screens about a type** (`designer/screens/screenAsset.jsx`,
`model/assetPaths.js`): a page's root container can carry
`context: { modelId, typeId }`, set any time from the Page's General
details ("About"). Such a screen is drawn for one asset of the type at a
time — its *self*: "Preview as" on the canvas toolbar, `&asset=<id>` on
the Launch URL. Widgets bind to it with ⚡ → Asset:
`{ type: 'asset', path, property }`, where the path goes by type
(`['drivetrain', 'gearbox']`, `'..'` for the parent), so one screen works
for every asset of the type. A list property (a Chart's data) gets the
property's history as `{ timestamp, value }` rows. The Data tab's "This
asset" view shows everything reachable from self with its values.
Changing the type checks the page's asset bindings first and never
removes them; ones that don't resolve keep the widget's static value and
show a red ⚡! badge. Self reaches `ContainerCard` through a React context
(`ScreenAssetProvider` / `useScreenAsset`), not props.

**Screen sizes** (`designer/screens/screenSizes.js`): every screen is one
of three fixed sizes — Tile (220×140), Card (360×280) or Page (fills
whatever room it's given). It's `pageSize` on the root container, set
from the Page's General details beside About, so it saves and
dirty-tracks like any other edit; it sits next to the context rather than
inside it, so clearing what a screen is about doesn't forget how big it
is. Screens saved before sizes existed are Pages, which is what they
were. The canvas and the Launch view frame a Tile or a Card at its own
size (a chosen device preview still wins), and the saved-screens list
badges anything that isn't a Page, since a type now usually has more than
one screen. One screen is one size for now: a type's Tile and its Card
are two saved screens. If that turns out tedious, the breakpoint tiers
the canvas already has are where a single screen with three layouts would
go.

**Repeaters** (`designer/screens/screenRepeat.jsx`): a container with
`repeat: { assetSetId, start, itemScreen, itemSize, max }` draws a screen
per asset instead of its own children. The assets come from a saved asset
set; a set that takes a start gets the screen's own asset by default (a
feeder screen passes its feeder). Each item is wrapped in its own
`ScreenAssetProvider`, so that asset is *self* inside it. Which screen it
gets is a lookup by **type and size** — a repeater asks for, say, each
type's Card — falling back the way Visualization does for a related
asset's box:

1. the screen about that asset's type at that size;
2. a card generated from that type's Visualization property config
   (`designer/screens/generatedCard.jsx`, which wraps the same
   `operator/relatedAssets/AssetCard.jsx` the Operator's related-asset
   views draw, titled with the asset's own name);
3. a placeholder — now only for an id the model doesn't have.

So a mixed set works, and a type nobody has designed for yet shows its
real values rather than a gap: a screen for a type is an improvement on a
sensible default, not a prerequisite. Every item gets the box its size
defines (with one fixed screen for everything, that screen's own size
decides); a screen smaller than its box is centred, not stretched.
Nesting stops at `MAX_REPEAT_DEPTH`, and a screen already being drawn
above can't appear inside itself. The saved screens and asset sets reach
the repeater through `ScreenDataProvider` (the canvas and RuntimeView
supply them). Set it up in the Layout tab's Repeat section, which shows
what the set resolves to and which screen each type gets. `RuntimeView`
loads the model a screen needs via `modelForScreen` — what it's about,
or, for a plain screen whose only tie to a model is a repeater, that
repeater's asset set's model.

**Screens about a property** (`designer/screens/screenProperty.jsx`): the
smallest fragment. A page's About can be *Any property*, stored as
`context: { kind: 'property' }` (no model or type — one works everywhere,
and `pageContextOf` ignores it, so repeaters never find one by type).
Choosing it shrinks a Page-sized screen to a Tile. Self is one property of
one asset: "Preview as" picks both, and `ScreenPropertyProvider` /
`useScreenProperty` carry `{ assetId, propertyKey, value? }` the way
`ScreenAssetProvider` carries an asset (a given `value` wins, so a
time-scrubbed box moves its custom tiles too). Widgets bind with ⚡ →
Property: `{ type: 'property', field }`, one of `PROPERTY_FIELDS` — value,
value with unit, label, unit, min, max, percent of range, asset name, and
history (list properties only). A Sparkline bound to history rows gets its
argument/value fields pointed at `timestamp`/`value` automatically
(`widgetBindings.js`). Changing About checks asset *and* property bindings
(`checkPageBindingsForAbout`, `screenSelfOf.changeAbout`).

A saved property screen is a **custom tile**: Visualization's per-property
Visual column lists them under "Your tiles", stored as
`'screen:<pageId>'` (`propertyDisplay.js` `screenViewMode` /
`screenIdOfViewMode` / `viewModeLabel` — use `viewModeLabel` anywhere a
visual is named). `PropertyTile` hands such a mode to
`operator/properties/PropertyScreenTile.jsx`, which draws the screen at its
own size through ScreenView, so AssetCard in every view gets custom tiles
for free; a deleted screen falls back to All. `propertyScreens.js` reads
the saved pages (cached against the raw stored string). The toolbar default
stays the built-in modes for now. Anything that draws a screen inside
something else gets ScreenView from `screenRenderer.js`
(`registerScreenRenderer` / `getScreenRenderer`) rather than importing it,
which would be a circle.

The Screens *editor* lives in the same folder, split the same way as
state vs. drawing:
- `useScreenEditor` — all of the editor's state and actions: saved
  screens and folders, the open page, selection, clipboard, paintbrush,
  device preview, and every edit. **App calls it**, not ScreensWorkspace,
  because the canvas outlives the area: leave Screens and come back and
  the open page and its unsaved edits are still there, so leaving
  doesn't prompt (opening or creating another screen does). Lock rules
  (`LOCK GUARD`) are enforced here.
- `screenEdits.js` — the edits themselves as plain `(tree, …) => tree`
  functions: moving, grid cells, layout changes, per-tier slot overrides,
  aspect ratio, paintbrush, bindings.
- `usePageQueryInstances` — the query instances on pages (the editing
  counterpart of `usePageQueryResults`). Lookups are scoped to the active
  page because instance ids restart at 1 per page.
- `ScreensWorkspace` — draws it: `ScreensLeftPanel` (Screens, Visuals,
  Data, Page Visuals, Page Data tabs), `ScreenCanvas` (toolbar + the
  page), `ScreenDetailsPanel` → `ContainerDetails` (one selection, a tab
  per settings area) or `MultiSelectionDetails`; plus the create wizard,
  the binding popovers, and the canvas's Ctrl/Cmd+C/V shortcuts, which
  only listen while Screens is open and never inside a text field.
- `detailsFields.jsx` — the details panel's inputs. `textField` and
  `sharedTextField` still differ (whole vs. decimal numbers,
  uncontrolled vs. blank when unset) — see its header.
`ContainerCard`, `PageVisualsTree`, `ScreensPanel`, `DevicePicker`,
`GridEditor` and the container model/tree files are still at `src/` root.

## Where things live

- `docs/CODE_MAP.html` — the code map: how the Operator/Configurator code
  is wired, the settings chain, the rendering stack, the patterns to know,
  and where each piece lives. Start here when orienting.
- `docs/INDUSTRY_PACK_MAP.html` — the same kind of map for the industry
  pack area: generators, detectors and tools under `ModelAndData/`, the
  pack files, the registry, and the runtime modules that load and read a
  pack. Keep it in step when the pack format or those modules change.
- `src/operator/OperatorWorkspace.jsx` — the shell: loading a model's
  data, and `OperatorWorkspaceInner`, which owns the shared state and
  arranges the panels into slots. Everything it renders sits beside it.
- `src/model/` — the active model, shared by the Operator side,
  Visualization, Screens and Asset Sets: its data (`modelData.js`: the
  module-level variables and the loader that writes them; nothing else
  assigns them), read-only questions about it (`assetQueries.js`),
  `useLoadedModel.js` (the hook that fetches a model and makes it active,
  used by OperatorWorkspace, ScreensWorkspace and AssetSetsWorkspace),
  `modelRegistry.js` (reads `models.json`), `assetSets.js` (resolving
  asset sets) and `assetPaths.js` (paths from an asset by type, for
  screens about a type), with tests beside them that load a real pack
  through `loadPackForTests.js`.
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
- `src/operator/operatorViews/` — the Operator's own views: NowStrip,
  Attention, Investigate and its evidence
  widgets, Work, task detail, the Assets area, and `statusVocabulary.js`
  (the status colour/label maps they all share). Investigate's AI tab has
  two versions sharing `InvestigateStatCards`: `explanation/ExplanationView`
  when the item has a detector-built explanation (the "why": checks,
  reference examples, what was ruled out, confidence — see below), and
  `AiInterpretationView` otherwise. `explanation/ExplanationChart.jsx` is
  the one SVG renderer for every chart spec in an explanation.
- `src/operator/chrome/` — the right rail, the side panel, Contacts and
  the AI chat panel. (The left rail is `src/shell/AreaRail.jsx`; both
  rails are styled by `src/shell/appRail.css`, class prefix `app-rail`.)
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
- `src/App.js` — the outer shell: title bar (area menu, model switcher,
  Launch, Save), navigation between areas, and the shared data
  definitions (data sources, entities, queries). Every area is its own
  workspace component; `src/shell/appAreas.js` lists them.
- `src/designer/widgets/` — the Widgets area (see "The designer half"):
  `WidgetsWorkspace`, `WidgetOptionsEditor` (+ `OptionAdvancedFields`,
  `ChoicesField`, `JsonField`), `WidgetPropertiesPreview`, `WidgetsExport`,
  `optionNaming` (the label and group a path implies),
  `widgetPropertyEdits`, the shared `WidgetPropertyField`, and the
  `widgetPropertyDefs` store every widget property lookup goes through.
- `src/designer/ScriptsWorkspace.jsx` — the Scripts area (a placeholder).
- **Explanations and detectors** (`INDUSTRY_PACK_SPEC.md` §14): a pack
  can ship `explanations.json`, written by its own `explain.py` from
  detectors built on the shared toolkit in `ModelAndData/tools/detectors/`.
  Detectors read only the runtime files, run on every asset of their type,
  and each pack has a `robustness.py` that re-checks them on regenerated
  data. The file is an optional role: a pack lists it under `"files"` in
  `models.json`, the loader reads it into `EXPLANATIONS`, and
  `getAttentionItemExplanation(item)` returns it. Wind, ccgt, pipeline,
  pharma and grid have explanations; refinery, water and wastewater fall
  back to the plain AI tab.
  `ModelAndData/tools/detectors/preview.py <model>` renders a pack's
  explanations as a standalone HTML page for reviewing content.
- `public/data/models.json` + `src/model/modelRegistry.js` — the registry of
  industry models (id, label, levels, unitLevel, optional file roles), read by both
  the model switcher and `OperatorWorkspace`'s loader. A new industry pack
  is one entry here plus its `public/data/<id>/` folder, with no code
  changes. `INDUSTRY_PACK_SPEC.md` has the full requirements for building
  one, and `ModelAndData/tools/validate_industry_pack.py` checks it.
  `validate_industry_pack.py --all` checks every registered pack.
  `ModelAndData/tools/convert_legacy_to_generic.py` is the one-off
  converter that produced refinery, water and wastewater (spec §12).
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
  `DataListGrid` passes a row click on once: DevExtreme raises both
  `onSelectionChanged` and `onRowClick`, which used to make any handler
  that prompts ask twice.
- `src/designer/` — pieces shared by the designer areas:
  `DefinitionWorkspace` (the list + editor shell behind Data Sources,
  Entities, Queries and Asset Sets), `useDefinitionDraft`,
  `useStoredDefinitions`, and the model pickers `AssetPicker` and
  `modelOptions` (used by Asset Sets and Screens); `screens/` holds the Screens area — the editor
  (`ScreensWorkspace`, `useScreenEditor`, `screenEdits`), the read-only
  renderer (`ScreenView`, `usePageQueryResults`, `widgetBindings`), and
  what a screen is about and how big it is (`screenAsset`, `screenSizes`,
  `screenRepeat`, `generatedCard`);
  `assetSets/` holds the Asset Sets area (workspace, editor, rule form,
  preview).
- `public/data/<model>/*.json` — per-model data, 8 files per pack
  (`assets`, `asset-relationships`, `properties`, `asset-values`,
  `asset-telemetry`, `unit-status`, `attention-items`, `work-items`;
  spec §6), plus `explanations.json` where a pack has detectors. An
  asset's current value for a property is always exactly the last point
  of that property's series in `asset-telemetry.json` — load-bearing for
  the Investigate panel's time-track scrubber, which pulls real
  historical readings from that series rather than faking movement.
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
