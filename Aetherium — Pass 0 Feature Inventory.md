# Aetherium — Pass 0 Feature Inventory

Oct 1, 2026 · @Amy Jo

## How to read this

Pass 0 lists every user-facing capability in Aetherium and ties each one to the code that implements it. It contains no requirements yet; its job is to make sure nothing is missed when Pass 1 writes them.

- **Source:** the `main` branch of the quietlyCurious/aetherium repo, latest commit be5670f ("Additional Dev Extreme Widgets", Oct 1 2026).
- **Method:** read every source file, map it to features, then run the app in a headless browser to check the tree against what's actually on screen.
- **Status legend:** **Complete** = works end to end · **Partial** = works, but has known gaps · **Stub** = UI or model exists without real behavior.
- **What to do with it:** correct the tree first (wrong groupings, missing areas, things that shouldn't carry over). Once you approve it, it becomes the table of contents for Pass 1.

## Capability tree

Aetherium has 2 experiences, 13 areas and about 85 leaf features, plus a shared platform layer that sits underneath both experiences. The IDs below (for example **SCR-07**) are what Pass 1 specs and ADO stories would cite.

&#91;embedded content: Aetherium at a glance · 2 experiences, 13 areas, 1 platform\]

Visualization's templates decide how assets look in Operator Assets and Investigate. Inside Configuration, Data feeds Design: queries and asset sets are what Screens binds to and repeats over.

- **PLT — Platform & shell** (shared by both experiences)
  - PLT-01 Workspace menu: Operator Experience / Configuration Experience
  - PLT-02 Area rail (Design group, Data group; expand/collapse)
  - PLT-03 Model switcher (8 industry models; dimmed in areas that don't use a model)
  - PLT-04 Title-bar Save with per-area behavior + unsaved (amber) indicator
  - PLT-05 Leave-with-unsaved-changes rules, per area
  - PLT-06 Launch (open a screen's runtime view in a new tab)
  - PLT-07 Deep links (Visualization type/tab, Operator asset/tab)
  - PLT-08 Session restore (persona, model, last selection per model)
  - PLT-09 Fitted viewport: auto-fit, zoom controls, pan, pinch, shortcuts
  - PLT-10 Industry model registry & loading (data-only packs)
  - PLT-11 Profile icon *(stub)*
- **CFG — Configuration Experience**
  - **CFG-VIS — Visualization** (type defaults, asset overrides)
    - VIS-01 Types / Assets selection (customized badges and dots)
    - VIS-02 Properties editor: view modes, flex options, manual layout, density slider
    - VIS-03 Related Assets editor: Cards vs Diagram, auto vs manual
    - VIS-04 All Assets editor (one global diagram, hide assets)
    - VIS-05 Details grids: Show (Always/Sometimes/Never), per-property Visual, drag order
    - VIS-06 Customizations: Match type, Update type, revert on N assets, Undo toast
    - VIS-07 Diagram settings: algorithm, direction, routing, spacing, arrows, labels
    - VIS-08 Manual layout tools: snap, box-select, align/distribute/arrange
    - VIS-09 Operator fit check and display preview
    - VIS-10 Property tile rendering (Text, Indicator, Spark, All, custom tiles)
    - VIS-11 Save / Discard rules (immediate vs explicit save)
  - **CFG-SCR — Screens** (page builder)
    - SCR-01 Screens list: folders, create, open, save, delete, search
    - SCR-02 Create wizard *(partial; Save does nothing)*
    - SCR-03 Left panel: Visuals (widget catalog), Data (Model / Queries / This asset), Page Visuals tree, Page Data
    - SCR-04 Canvas & toolbar: add container, follow/stay, gap, snap, move/reparent modes
    - SCR-05 Selection, drag & drop, resize, keyboard shortcuts
    - SCR-06 Zoom & pan on the canvas
    - SCR-07 Device preview & breakpoint tiers *(partial: runtime ignores tiers)*
    - SCR-08 Layout types: flex, grid (cells, merge), coordinate/manual; quick presets
    - SCR-09 Coordinate editing: anchors, stretch, snap guides, box-select, align/distribute/arrange
    - SCR-10 Details panel: Widget, Layout, Slot, Box, General tabs
    - SCR-11 Multi-selection details
    - SCR-12 Bindings: Expression, Query, Asset, Property; badges; render-time fixes
    - SCR-13 Screens about a type / about a property ("Preview as")
    - SCR-14 Screen sizes: Tile, Card, Page
    - SCR-15 Repeaters: over asset sets or properties; by type and size; flowed or by hand
    - SCR-16 Locking
    - SCR-17 Copy/paste and paintbrush
    - SCR-18 Widget catalog & placement rules (55 placeable, 21 not, with reasons)
    - SCR-19 Text widget (Aetherium's own)
    - SCR-20 Runtime / Launch view
  - **CFG-WID — Widgets** (which widget options page builders see)
    - WID-01 Widget list with exposure indicators
    - WID-02 Options list: expose, defaults, label/type/choices/group/bindable, add by path
    - WID-03 JSON value editing
    - WID-04 Live preview with try-out values
    - WID-05 Draft / save / reset to shipped
    - WID-06 Export to source *(prototype mechanism)*
    - WID-07 Generated option catalog from DevExtreme *(build tooling)*
  - **CFG-THM — Theme** *(browse only)*
    - THM-01 Data palettes gallery
    - THM-02 Base UI themes gallery (light, dark, compact)
    - THM-03 Shared widget preview gallery
  - **CFG-DS — Data Sources**
    - DS-01 List & create; product picker (10 products, 3 disabled)
    - DS-02 Connection fields per product (REST, OPC UA, SQL, GraphQL, Plant Apps)
    - DS-03 System-managed (read-only) sources *(nothing creates them yet)*
    - DS-04 Delete with in-use guard
  - **CFG-QRY — Queries**
    - QRY-01 List & create; data source + secondary
    - QRY-02 9 query types; computed result shape
    - QRY-03 Inputs / outputs editors; OPC UA templates
    - QRY-04 Type-specific configuration
    - QRY-05 Test panel (REST)
    - QRY-06 Sync from Operations Hub; Link Unlinked; read-only synced queries
    - QRY-07 Delete with in-use guard
  - **CFG-ENT — Entities**
    - ENT-01 List & create
    - ENT-02 Column editor
    - ENT-03 Row data editor (batch edit, bulk add)
  - **CFG-SET — Asset Sets**
    - SET-01 List per model, live count, description
    - SET-02 Picked kind
    - SET-03 Rule kind: where to look, keep, conditions, best/worst
    - SET-04 Live preview with narrowing steps
    - SET-05 Query kind *(stub)*
  - **CFG-SCP — Scripts** *(placeholder)*
  - **CFG-DEF — Shared definition shell** (list + editor, draft, leave guard; used by DS, QRY, ENT, SET)
  - **CFG-QI — Query instances on pages** (add, inputs, input bindings, execution, polling)
- **OPS — Operator Experience**
  - OPS-01 Now strip (unit tiles: state, mode, product)
  - OPS-02 Rail with counts: Attention, Work, Assets
  - **OPS-ATT — Attention**: group, sort, pin, attention cards
  - **OPS-INV — Investigate**
    - INV-01 Trend tab (signal chart with range selector, timeline, table)
    - INV-02 Assets tab: this asset / related assets, time-track scrubber, alarms sidebar
    - INV-03 AI tab, explainable "Why?" view (6 sections + detector details)
    - INV-04 AI tab fallback (interpretation text)
    - INV-05 Create work item from an attention item
  - **OPS-WRK — Work**: list (group/sort, margin), add task, task detail, mark done
  - **OPS-AST — Assets**: tree, Properties, Related Assets, All Assets, gear to Visualization
  - **OPS-CHR — Side panel**: Contacts/chat *(stub)*, AI chat *(stub)*
  - OPS-03 Shared status vocabulary (states, severities, modes, confidence, risk, priority)
- **DATA — Industry pack contract** (not UI, but the product needs it): 8 runtime files per model, plus optional explanations; see INDUSTRY\_PACK\_SPEC.md.

## Feature details

Of 86 features, 43 are Complete, 36 Partial and 7 Stubs (counting grouped rows such as THM-01–03 individually). The tables give each feature's main controls, the data it touches and its status. They are a coverage checklist, not the spec: Pass 1 expands every row into rules and acceptance criteria.

### Platform & shell

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| PLT-01 | Pick Operator or Configuration Experience from the title menu; Configuration reopens the last area used (in memory only) | — | Complete |
| PLT-02 | Use the left rail: Design (Visualization, Screens, Widgets, Theme) and Data (Data Sources, Entities, Queries, Asset Sets, Scripts); expand to 180px or collapse to 44px; click Visualization again to hide its list | Area registry | Complete |
| PLT-03 | Switch industry model; dimmed with a tooltip outside Operator, Visualization, Screens, Asset Sets; falls back if a saved model was removed | Model registry | Complete |
| PLT-04 | Save the open area from one title-bar button; tooltip and enabled state per area; amber dot when unsaved; hidden in Operator | Per area | Complete |
| PLT-05 | Get asked before losing edits: data areas confirm, Visualization shows Save/Discard, Screens never asks | Unsaved store | Complete |
| PLT-06 | Launch a saved screen in a new chrome-free tab, optionally for a preview asset | Page | Complete |
| PLT-07 | Open a deep link to a Visualization type/tab or an Operator asset/tab | URL | Partial: 2 shapes only; Back/Forward don't work |
| PLT-08 | Come back to the same persona, model and last selection per model | Browser storage | Partial: last area isn't restored |
| PLT-09 | Zoom 10–400% (×1.25 steps, presets 25–400, Fit), Ctrl+wheel, pinch, pan with a 5px threshold; editor shortcuts Ctrl ±/0, Shift+1 | — | Complete |
| PLT-10 | Load any registered industry model (8 today) with loading and error states | Pack files | Complete |
| PLT-11 | Profile icon | — | Stub |

### Visualization

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| VIS-01 | Pick a type (with a customized-asset count) or an asset in the hierarchy (dot = customized, lighter dot = customized inside) | Assets, types | Complete |
| VIS-02 | Set view mode (None/Text/Indicator/Spark/All), Flow, Wrap, Lines; switch to Manual (keeps positions) or reset to Flex; density slider (Always / +Sometimes / All) | Display template | Complete |
| VIS-03 | Show related assets as Cards (flex or manual) or a Diagram (auto or manual); 2-stop density slider | Related Assets template, related visibility | Partial: an asset's related boxes show example instances, not its real neighbours |
| VIS-04 | Lay out every asset in one diagram and hide individual assets | All Assets template (global) | Complete |
| VIS-05 | Cycle Show per property (Always/Sometimes/Never), pick a Visual per property including custom tiles, drag to reorder; related rows Always/Never | Visibility, view modes, order | Complete |
| VIS-06 | See which assets differ from their type; Match type, Update type, revert per property on chosen assets; 10s Undo | Asset overrides | Complete |
| VIS-07 | Choose diagram algorithm (Layered/Tree/Radial/Force), direction, routing, spacing; arrows, labels, connection point | Related/All templates | Complete |
| VIS-08 | Snap, box-select, group move; align (2+), distribute (3+), arrange in grid; auto-place new items | Manual positions | Complete |
| VIS-09 | See whether the layout fits the Operator view on a chosen display, and preview it there | Display preference | Partial: no verdict for Diagram |
| VIS-10 | See property tiles as Text, Indicator, Spark, All, or a custom tile built in Screens | Values, telemetry, property screens | Complete |
| VIS-11 | Visibility and order apply immediately; templates wait for Save; leaving asks Save/Discard (no Cancel) | All of the above | Complete |

### Screens

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| SCR-01 | Browse, search, create, open, save, delete screens; create, rename, delete folders; drag a screen into a folder | Page, folder | Partial: no screen rename or duplicate |
| SCR-02 | Step through Create: pick assets, pick properties, group them | Model | Stub: Save creates nothing; steps 3–4 are placeholders |
| SCR-03 | Drag widgets from Visuals; browse the model, add queries, see "This asset" values; reorder or reparent in Page Visuals; manage Page Data | Catalog, model, queries | Complete |
| SCR-04 | Add container, Follow/Stay, toggle direction, hide gaps, snap size, copy/paint/paste/delete, Move vs Reparent | Containers | Complete |
| SCR-05 | Click/Shift-select, drag to reorder or reparent, 8-handle resize (min 40px), Ctrl+C/V, Esc | Containers | Partial: no undo, Delete key or nudge |
| SCR-06 | Zoom and pan the canvas; Tile/Card open fitted up to 200% | — | Complete |
| SCR-07 | Preview on 22 devices or a custom size; edit Slot/Box/visibility per tier (Mobile, Tablet, Desktop base, Wide) | Tier overrides | Partial: Launch ignores tiers; widget props not per tier |
| SCR-08 | Choose flex, grid or coordinate layout and every flex/grid option; use Arrange/Flow/Wrap/Lines presets | Layout | Partial: grid merge reset and resize bugs |
| SCR-09 | Move with anchors and stretch, snap to guides, box-select, align/distribute/arrange | Coord | Complete |
| SCR-10 | Edit Widget props (with ⚡), Layout (+Repeat), Slot (flex or coordinate, ratio lock), Box (padding, margin, border, overflow, background, typography), General (name, lock, page type, size, About) | Container | Complete |
| SCR-11 | Edit shared coordinate/slot/box values and shared widget props across a selection | Containers | Partial: no ratio lock, binding or full typography |
| SCR-12 | Bind a property to an expression, a query output (first/last row, fields for lists), an asset path property, or a property field; see ⚡ and broken ⚡! badges | Bindings | Partial: canvas never runs queries |
| SCR-13 | Make a screen about a type or "any property"; preview as a chosen asset/property; get warned when bindings would break | Context | Complete |
| SCR-14 | Make a screen a Tile (220×140), Card (360×280) or Page | Page size | Complete |
| SCR-15 | Repeat over an asset set or this asset's properties; pick item screen by type or fixed, item size, max; flowed or by hand | Repeat | Partial: no align or per-item visual |
| SCR-16 | Lock items so they can't be clicked, moved or edited (unlock from the tree) | Container | Complete |
| SCR-17 | Copy/paste a subtree with bindings; paintbrush sizing, box and same-widget props | Clipboard | Partial: paste lands on top of the original |
| SCR-18 | See all 76 widgets; 21 greyed with a reason (overlay, layout, behaviour, service) | Catalog | Complete |
| SCR-19 | Place Text: size, weight, colour, align, decimals, prefix/suffix, overflow ellipsis/wrap/shrink | Widget props | Complete |
| SCR-20 | View the saved screen chrome-free with live query data polled every 5s | Page, query instances | Partial: no tiers, no property self, no zoom-to-fit |

### Widgets & Theme

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| WID-01 | Browse all widgets with exposed counts, a "no title option" dot and an edited marker | Property lists | Complete |
| WID-02 | Expose options with defaults; edit label, type, choices, group, bindable; filter; add by path | Property definitions | Partial: no reordering |
| WID-03 | Edit list/object options as JSON, saved only when it parses | Defaults | Complete |
| WID-04 | Try values on a live widget in the real details panel | — | Complete |
| WID-05 | Save, Reset to shipped, confirm on leave | Overrides | Complete |
| WID-06 | Export all lists as a source file (.zip or clipboard) | — | Complete (prototype mechanism) |
| WID-07 | Regenerate the option catalog from DevExtreme (10,149 options, 75 widgets) | Catalog file | Complete (tooling) |
| THM-01–03 | Browse 15 data palettes and 44 base themes on a sample widget gallery | — | Partial: nothing can be chosen, saved or applied |

### Data

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| DS-01–02 | Create a data source, pick a product, fill connection, TLS and auth fields per product | Data source | Partial: fields only; nothing connects; test buttons disabled |
| DS-03 | See a read-only, OpHub-managed source | Data source | Stub: nothing creates one |
| DS-04 | Delete, blocked while a query uses the source | — | Complete |
| QRY-01–04 | Create a query: source + secondary, type, inputs, outputs, type config; see the computed result shape | Query, params | Partial: SQL/OPC UA/Entity aren't executed natively |
| QRY-05 | Run a REST query test with default inputs | — | Partial |
| QRY-06 | Sync queries from Operations Hub, link unlinked ones; synced queries are read-only except their data source | Query | Partial: re-sync clears links; deletions not synced |
| QRY-07 | Delete, blocked while a page uses the query | — | Complete |
| ENT-01–03 | Create an entity, define columns, edit rows in a batch grid, bulk-add rows | Entity | Partial: no rename; not linked to queries |
| SET-01–04 | Define picked or rule-based asset sets with live preview and narrowing steps | Asset set | Complete |
| SET-05 | Query-based asset set | — | Stub |
| SCP | Scripts | — | Stub |
| QI | Add query instances to a page, see effective inputs, bind inputs to expressions; run on load and every 5s | Query instance | Partial: overrides, triggers, poll interval, app scope have no UI |

### Operator Experience

| ID | What the user can do | Data | Status |
| --- | --- | --- | --- |
| OPS-01 | See every unit's state, time in state, mode and product; click to open it in Assets | Unit status | Partial: Down shares the Running icon |
| OPS-02 | See counts on Attention (new in 30 min) and Work (open AI tasks) | Attention, work | Partial: Attention count is static |
| OPS-ATT | Group (None/Severity/Asset/State), sort (Time/Severity/State), pin; read severity, state, signal, AI text | Attention items | Partial: read-only; pins not saved |
| INV-01 | Read the signal chart with a range selector, the evidence timeline and table | Telemetry, evidence | Complete |
| INV-02 | See this asset or related assets, scrub/play through history, see alarms active at that time | Telemetry, templates | Partial: related boxes show wrong instance; scrub doesn't reset |
| INV-03 | Read the "Why?": what we see, checks, reference examples, ruled out, confidence, what to do, detector details | Explanations | Complete |
| INV-04 | Read the plain AI interpretation when no explanation exists | Attention detail | Complete |
| INV-05 | Create a work item from the recommendation | Work item | Partial: duplicates; tagged as AI |
| OPS-WRK | Group and sort tasks by margin or priority, add a task, mark done, read task detail | Work items | Partial: in memory; no edit, assign or due date |
| OPS-AST | Browse the asset tree; see Properties, Related Assets, All Assets as configured; gear jumps to Visualization | Assets, templates | Partial: related boxes show wrong instance |
| OPS-CHR | Chat with contacts; ask the AI | — | Stub: hardcoded people, canned replies |
| OPS-03 | Read consistent colours and labels for state, severity, mode, confidence, risk, priority | Vocabulary | Complete |

## Traceability

All 238 files under `src/` map to a feature, apart from 7 dead or boilerplate files (listed at the end). Files that serve one feature together are grouped in a row. Tests are listed with what they cover, because they record intended rules Pass 1 should capture.

### Platform & shell

| Files | Features | Notes |
| --- | --- | --- |
| App.js | PLT-01–08, PLT-11, CFG-DEF handlers | Title bar, navigation, deep links, data-definition handlers with delete guards, license-banner hiding |
| index.js, index.css | Bootstrap | CRA entry |
| shell/appAreas.js, shell/AreaRail.jsx, shell/areaIcons.jsx, shell/appRail.css | PLT-02, PLT-04 | The one list of workspaces and areas |
| unsavedChangesStore.js | PLT-04, PLT-05, VIS-11 | Global dirty flag and position-aware dirty tracker |
| viewport/FitViewport.jsx, viewport/fitViewportMath.js, viewport/fitViewport.css | PLT-09 | Used by Screens canvas, Visualization, Operator |
| breakpointConfig.js, DevicePicker.jsx | SCR-07, VIS-09 | Device catalog and tiers; runtime helpers unused |
| HierarchyTree.jsx | VIS-01, OPS-AST, SCR-03, WID-01 | Shared tree |
| DataListGrid.jsx | CFG-DEF, VIS-01, THM | Shared list grid |
| operatorNavigationStorage.js, nowSelectionStorage.js, operatorFitDisplayStorage.js | PLT-08, VIS-09 | Per-browser preferences |
| model/modelRegistry.js, model/useLoadedModel.js, model/modelData.js, model/assetQueries.js | PLT-10, everything that reads a model | Loader, active model, read-only queries |
| model/assetPaths.js | SCR-12, SCR-13 | Paths from an asset by type |
| model/assetSets.js | SET-01–05, SCR-15 | Asset set resolver |
| App.css | PLT shell, SCR-02, SCR-04–10 | Also global DevExtreme tree overrides |
| App.suppressLicenseBanner.css | PLT (prototype) | Hides DevExtreme trial banner |
| App.thinScrollbars.css, App.detailsRadius.css | SCR-04, SCR-10 | Style experiments |

### Screens

| Files | Features | Notes |
| --- | --- | --- |
| designer/screens/useScreenEditor.js, designer/screens/screenEdits.js | SCR-01, SCR-04–17 | All editor state and edits; lock guard |
| designer/screens/ScreensWorkspace.jsx | SCR-02, SCR-05, SCR-12 | Layout, wizard popup, popovers, shortcuts |
| designer/screens/ScreensLeftPanel.jsx | SCR-03, CFG-QI | Five left-panel tabs |
| designer/screens/ScreenCanvas.jsx | SCR-04, SCR-06, SCR-07, SCR-09, SCR-13 | Toolbar and canvas frame |
| designer/screens/ScreenDetailsPanel.jsx, designer/screens/ContainerDetails.jsx, designer/screens/detailsFields.jsx | SCR-10, SCR-13–15 | Details tabs |
| designer/screens/MultiSelectionDetails.jsx | SCR-11 |  |
| designer/screens/LayoutPresets.jsx, designer/screens/layoutPresetMapping.js | SCR-08 | Quick presets |
| designer/screens/widgetBindings.js, WidgetBindingPopover.jsx, expressionEval.js, App.bindings.css | SCR-12 | Binding editor and resolvers |
| designer/screens/screenAsset.jsx, designer/screens/screenProperty.jsx | SCR-13 | About, Preview as, binding checks |
| designer/screens/screenSizes.js | SCR-14 |  |
| designer/screens/screenRepeat.jsx, designer/screens/generatedCard.jsx | SCR-15 | Repeaters and generated-card fallback |
| designer/screens/ScreenView.jsx, designer/screens/screenRenderer.js, RuntimeView.jsx | SCR-20, VIS-10 (custom tiles) | Read-only renderer |
| designer/screens/usePageQueryInstances.js, designer/screens/usePageQueryResults.js, InputBindingPopover.jsx, QueryInstanceDetailsPanel.jsx | CFG-QI | Instances, polling, input bindings |
| ContainerCard.jsx, containerModel.js, containerStyles.js, containerTree.js | SCR-04–10, SCR-16 | Container rendering, defaults, tree helpers |
| GridEditor.jsx | SCR-08 | Grid merge and reset |
| PageVisualsTree.jsx | SCR-03, SCR-16 |  |
| ScreensPanel.jsx, pagesStorage.js | SCR-01 | List, folders, storage with ID repair |
| coordinate/CoordinateCanvas.jsx, coordinate/coordinateMove.js, coordinate/coordinateCanvasDom.js, coordinate/coordinateArrange.js, coordinate/coordinatePlacement.js, coordinate/coordinateCanvas.css | SCR-09, SCR-15, VIS-08 | One coordinate engine for both designers |
| Wizard.jsx | SCR-02 |  |
| App.locked.css | SCR-16 |  |
| WidgetPreview.jsx, widgetData.js, widgetSupport.js, widgetSampleData.js | SCR-18 | Catalog, placement rules, sample data |
| customWidgets/TextWidget.jsx, customWidgets/customWidgets.js, customWidgets/textFormat.js, customWidgets/textWidget.css | SCR-19 |  |

### Widgets & Theme

| Files | Features | Notes |
| --- | --- | --- |
| designer/widgets/WidgetsWorkspace.jsx | WID-01, WID-05 |  |
| designer/widgets/WidgetOptionsEditor.jsx, designer/widgets/OptionAdvancedFields.jsx, designer/widgets/ChoicesField.jsx, designer/widgets/widgetPropertyEdits.js, designer/widgets/optionNaming.js | WID-02 |  |
| designer/widgets/JsonField.jsx | WID-03 |  |
| designer/widgets/WidgetPropertiesPreview.jsx, designer/widgets/WidgetPropertyField.jsx, designer/widgets/widgetPropertyField.css | WID-04, SCR-10 | Same field grid as the Screens details panel |
| designer/widgets/widgetPropertyDefs.js, widgetPropertyOverridesStorage.js, widgetProperties.js | WID-05, SCR-10, SCR-11, SCR-12 | Every widget-property lookup goes through here |
| designer/widgets/WidgetsExport.jsx, designer/widgets/widgetPropertiesSource.js, designer/widgets/zipFile.js | WID-06 |  |
| designer/widgets/widgetOptionCatalog.js, designer/widgets/widgetOptionsFile.js, widgetConfigs.js | WID-02, WID-07 | Catalog and fallback |
| designer/widgets/widgets.css | WID-01–05 |  |
| ThemeWorkspace.jsx, ThemeModeSwitcher.jsx | THM-01 |  |
| BaseThemeGallery.jsx | THM-02 |  |
| GalleryPreviewFrame.jsx, themeGalleryHtml.js | THM-03 |  |

### Data definitions

| Files | Features | Notes |
| --- | --- | --- |
| designer/DefinitionWorkspace.jsx, designer/useDefinitionDraft.js, designer/useStoredDefinitions.js | CFG-DEF | Shared list + editor shell |
| DataSourcesWorkspace.jsx, dataSourcesStorage.js | DS-01–04 |  |
| QueriesWorkspace.jsx, queriesStorage.js, ParamListEditor.jsx | QRY-01–07 |  |
| dataModel.js | DS, QRY, CFG-QI | Enumerations, defaults, result-shape inference |
| FormFields.jsx, App.data.css | DS, QRY, SCP |  |
| queryExecution.js, restResolver.js, queryInstancesStorage.js | CFG-QI, QRY-05 | Execution through an external OpHub proxy |
| ophubFlowDiscovery.js | QRY-06 |  |
| EntitiesWorkspace.jsx, entityModel.js, entitiesStorage.js | ENT-01–03 |  |
| designer/assetSets/AssetSetsWorkspace.jsx, designer/assetSets/AssetSetEditor.jsx, designer/assetSets/RuleEditor.jsx, designer/assetSets/AssetSetPreview.jsx, designer/assetSets/assetSets.css, assetSetsStorage.js | SET-01–05 |  |
| designer/AssetPicker.jsx, designer/modelOptions.js | SET-03, SCR-13, SCR-15 | Shared model pickers |
| designer/ScriptsWorkspace.jsx | SCP | Placeholder |
| Aetherium\_DataModel\_and\_OpHub\_Import\_Spec.md | DS, QRY, CFG-QI | Design reference (June 2026); code has diverged |

### Visualization

| Files | Features | Notes |
| --- | --- | --- |
| operator/OperatorWorkspace.jsx | VIS-01–11 state, all OPS routing | Shell for both personas |
| operator/configurator/NowAssetTreePanel.jsx | VIS-01 |  |
| operator/configurator/NowAssetDetail.jsx, operator/configurator/NowTypeMainPreview.jsx | VIS-02–04 | Preview host |
| operator/configurator/NowTypeDetailsList.jsx | VIS-05, VIS-06 | Details grids |
| operator/configurator/RelatedAssetsEditor.jsx | VIS-03 |  |
| operator/configurator/AllAssetsEditor.jsx | VIS-04 |  |
| operator/configurator/diagramSettings.jsx | VIS-07 |  |
| operator/configurator/OperatorFitCheck.jsx | VIS-09 |  |
| operator/configurator/customizationControls.jsx, operator/settings/customizations.js | VIS-06 |  |
| operator/settings/propertyDisplay.js, operator/settings/displayOrder.js, operator/settings/layoutOptions.js | VIS-02, VIS-05 |  |
| operator/properties/PropertyTilesView.jsx | VIS-02 |  |
| operator/properties/PropertyTile.jsx, operator/properties/sparklines.jsx, operator/properties/PropertyScreenTile.jsx, operator/properties/propertyScreens.js, operator/properties/AssetPropertyTile.jsx | VIS-10, SCR-15 |  |
| operator/properties/shownProperties.js | VIS-10, OPS-AST | Type → asset fallback rule |
| operator/properties/AssetPropertiesView.jsx | OPS-AST, VIS-09 |  |
| operator/relatedAssets/AssetCard.jsx | VIS-03, OPS-AST, INV-02, SCR-15 | The one box every view draws |
| operator/relatedAssets/AssetCardsView.jsx, operator/relatedAssets/AssetDiagramView.jsx, operator/relatedAssets/elkLayout.js, operator/relatedAssets/relatedAssetRows.js | VIS-03, VIS-04, VIS-07 |  |
| operator/relatedAssets/ReadOnlyViews.jsx | OPS-AST, INV-02 |  |
| operator/canvas/ManualLayoutEditor.jsx, operator/canvas/ManualLayoutView.jsx, operator/canvas/manualLayout.js, operator/canvas/CanvasAlignControls.jsx, operator/canvas/canvasGeometry.js | VIS-08, SCR-09 |  |
| typeDisplayTemplatesStorage.js, typePropertyConfigsStorage.js, typePropertyOrderStorage.js, typeRelatedAssetConfigsStorage.js, typeRelatedAssetOrderStorage.js, relatedAssetsTemplatesStorage.js, allAssetsTemplateStorage.js | VIS (type level) |  |
| assetDisplayTemplatesStorage.js, assetPropertyConfigsStorage.js, assetPropertyOrderStorage.js, assetRelatedAssetConfigsStorage.js, assetRelatedAssetOrderStorage.js, assetRelatedAssetsTemplatesStorage.js | VIS-06 (asset level) |  |
| operator/styles/configurator.css, operator/styles/properties.css, operator/styles/canvas.css, operator/styles/relatedAssets.css | VIS |  |

### Operator Experience

| Files | Features | Notes |
| --- | --- | --- |
| operator/operatorViews/NowStrip.jsx | OPS-01 |  |
| operator/operatorViews/AttentionPanel.jsx | OPS-ATT |  |
| operator/operatorViews/InvestigatePanel.jsx, operator/operatorViews/evidenceWidgets.jsx | INV-01, INV-02 |  |
| operator/operatorViews/InvestigateStatCards.jsx | INV-03, INV-04 |  |
| operator/operatorViews/explanation/ExplanationView.jsx, operator/operatorViews/explanation/ExplanationChart.jsx | INV-03 |  |
| operator/operatorViews/AiInterpretationView.jsx | INV-04 |  |
| operator/operatorViews/WorkListPanel.jsx, operator/operatorViews/TaskDetailPanel.jsx, operator/operatorViews/workItems.js | OPS-WRK, INV-05 |  |
| operator/operatorViews/OperatorAssetsView.jsx | OPS-AST |  |
| operator/operatorViews/statusVocabulary.js | OPS-03 |  |
| operator/chrome/RightRail.jsx, operator/chrome/SidePanel.jsx | OPS-CHR, VIS (Details panel) |  |
| operator/chrome/ContactsPanel.jsx, operator/chrome/AiChatPanel.jsx | OPS-CHR | Mock data |
| operator/icons.jsx, operator/badges.jsx | All operator and Visualization UI | 51 icons; AI pill |
| operator/styles/base.css, operator/styles/operatorViews.css, operator/styles/chrome.css | OPS |  |

### Tests (rules worth carrying into acceptance criteria)

| Files | Cover |
| --- | --- |
| designer/screens/screenEdits.test.js, designer/screens/screenRepeat.test.js, designer/screens/screenProperty.test.js, designer/screens/widgetBindings.test.js, designer/screens/layoutPresetMapping.test.js, containerStyles.test.js | SCR-08, SCR-12, SCR-13, SCR-15 rules |
| coordinate/CoordinateCanvas.test.jsx, coordinate/coordinateMove.test.js, coordinate/coordinateArrange.test.js, coordinate/coordinatePlacement.test.js | SCR-09, VIS-08 |
| customWidgets/customWidgets.test.js, widgetCoverage.test.js | SCR-18, SCR-19 |
| designer/widgets/optionNaming.test.js, designer/widgets/widgetOptionCatalog.test.js, designer/widgets/widgetOptionsFile.test.js, designer/widgets/widgetPropertiesSource.test.js, designer/widgets/widgetPropertyDefs.test.js, designer/widgets/widgetPropertyEdits.test.js, designer/widgets/zipFile.test.js | WID-02–07 |
| model/assetPaths.test.js, model/assetSets.test.js, model/loadPackForTests.js | SCR-13, SET-03 |
| operator/configurator/OperatorFitCheck.test.js, operator/canvas/manualLayout.test.js, viewport/fitViewportMath.test.js | VIS-08, VIS-09, PLT-09 |
| setupTests.js | Test setup |

### Unmapped

| File | Why |
| --- | --- |
| dev\_extreme\_asset\_screen\_wizard.jsx | Unused older wizard mock, kept on purpose. Its global styles would break the shell if imported |
| designer/widgets/WidgetOptionsPanel.jsx, designer/widgets/ExposedPropertiesEditor.jsx | Dead older Widgets panels. The second is the only reorder UI that ever existed |
| designer/assetSets/assetSetOptions.js | Dead duplicate of modelOptions.js (APPLY-ME.txt says to delete it) |
| App.test.js, README.md, logo.svg, reportWebVitals.js | CRA boilerplate. App.test.js would fail |

Outside `src/`: the root `themeGalleryHtml.js` is a stale copy; `scripts/generateWidgetOptions.js` is WID-07 tooling; `ModelAndData/` holds the offline pack generators and detectors (tooling, not product); `public/data/` holds the 8 packs and the widget option catalog.

## Prototype scaffolding vs. product decisions

The specs should keep the decisions and replace the scaffolding with what it stands in for. Each scaffolding item below names the product requirement underneath it, so Pass 1 can write that instead of copying the shortcut.

### Scaffolding: don't carry over as-is

| Prototype behavior | Where | Product requirement underneath |
| --- | --- | --- |
| All persistence in browser localStorage (screens, definitions, templates, overrides) | Every `*Storage.js` | Server persistence with users, permissions, versioning, audit |
| Passwords, tokens and client secrets stored in plain text | DS-02 | Secret storage; never return secrets to the browser |
| External OpHub proxy on localhost:4000, not in the repo | CFG-QI, QRY-05/06 | A backend query service; decide where connectivity lives |
| Every query runs as an OpHub "run flow" call; SQL, OPC UA, Entity settings are descriptive only | QRY-02–04 | Native execution per query type, or a stated rule that OpHub executes everything |
| Fixed 5s poll for every query instance | CFG-QI | Triggers (on load, inputs satisfied, input change, user action) and per-instance poll interval, as `dataModel.js` already declares |
| Widgets area saves per browser, then exports a source file to commit | WID-05/06 | A shared, versioned widget property profile managed by an admin role |
| DevExtreme trial banner hidden by CSS, observer and poll | PLT | A licensed DevExtreme key |
| Theme previews load DevExtreme 25.1.5 from a CDN (app runs 25.2) | THM-03 | Self-hosted theme assets at the app's version |
| `window.prompt`, `confirm`, `alert` for create, rename, delete | SCR-01, CFG-DEF | Proper dialogs (the Visualization Save/Discard dialog is the model) |
| Expression bindings run with the JavaScript `Function` constructor | SCR-12 | A sandboxed expression language |
| Simulated industry packs with a fixed "now" | PLT-10, OPS | Live asset model and telemetry; packs stay as demo data |
| Mock contacts and canned AI chat replies | OPS-CHR | Real messaging and a context-aware assistant, or out of scope |
| Operator state (pins, new tasks, done ticks) in memory only | OPS-ATT, OPS-WRK | Persisted, shared operator state |
| Templates keyed by level + type name, not by model; a type represented by its first instance | VIS | Real type identity from the asset model |
| Copy Layout button, console logging, debug notes in Query config | VIS-07, CFG-QI, QRY-04 | Remove |
| Disabled "Not yet implemented" buttons (Test Connection, Choose Certificate, Discover) | DS-02 | Decide: build or drop |

### Product decisions: keep, and record the reason in the spec

- **Two experiences, one area registry.** Operator and Configuration, with areas listed once; one title-bar Save whose meaning changes per area.
- **Type defaults, asset overrides.** Resolved in one place. "Customized" means it *renders* differently. Match type / Update type with Undo instead of confirms.
- **Save rules.** Visibility and order apply immediately; templates wait for Save. Screens doesn't prompt on leave because the canvas survives.
- **One box, two engines.** Every view draws the same asset card; Cards and Diagram share data.
- **One coordinate engine** shared by Screens and Visualization manual layouts.
- **Fitted viewport.** Never above 100% at runtime; controls only when content doesn't fit; pan/zoom as a safety net for generated layouts.
- **Screens about a type**, bound by path so one screen works for every asset of the type; bindings are never auto-removed, broken ones are flagged.
- **Three screen sizes** (Tile, Card, Page); repeaters find a screen by type and size, then fall back to a generated card, so a type nobody designed still shows real values.
- **A KPI is two Text widgets**, not a widget: screens are how things combine.
- **Unsupported widgets stay visible**, greyed with a reason.
- **Definitions live at system level, instances on pages**; instance IDs restart per page to match OpHub's flowInstanceId.
- **OpHub-synced queries are read-only** except their data-source link, which is local wiring.
- **Asset sets are their own saved definitions**, tied to one model, with an optional start asset so one definition is reusable.
- **Explainable AI.** AI content is always marked; the "Why?" view has a fixed six-section order; packs without detectors fall back to plain interpretation.
- **Industry differences are data only.** No industry is named in code.

## Open questions for review

The questions in the first group change what Pass 1 writes, so they're worth answering before it starts. The likely bugs only need a yes/no on whether each one is a bug, so Pass 1 doesn't write it up as a requirement.

### Scope decisions

- [ ] **Breakpoint tiers vs. screen sizes.** Tiers work on the canvas but the runtime never applies them, and Tile/Card/Page now overlap. Keep tiers, drop them, or fold them into sizes?
- [ ] **Create wizard.** Save creates nothing and steps 3–4 are placeholders. What should it produce: a screen, a repeater, bindings? Or leave it out of the first release?
- [ ] **Theme.** Today it's browse-only. Is the requirement to pick and apply a base theme and data palette per app/project/screen?
- [ ] **Entities.** They aren't connected to entity data sources or entity queries. What's the intended relationship?
- [ ] **Query execution.** Does the product execute SQL, OPC UA and Entity queries natively, or does everything go through Operations Hub flows?
- [ ] **Data source import.** System-managed (read-only) sources exist in the UI, but nothing creates them. Should they come from OpHub sync, like queries?
- [ ] **Scripts and query-based asset sets.** Both are placeholders. In scope or later phase?
- [ ] **Operator collaboration.** Contacts chat and AI chat are mocks. In scope, out, or stated as "integration point only"?
- [ ] **Operator state.** Should acknowledging or resolving attention items, pins, and task editing/assignment exist? Today the list is read-only.
- [ ] **Canvas preview data.** The Screens canvas never runs queries, so bound widgets show static values while editing. Keep that rule?
- [ ] **Widget property ordering.** It used to be possible (dead code) and isn't now. Wanted back?
- [ ] **App concept.** Still deferred? It changes what "app-scoped" query instances mean.
- [ ] **Undo/redo, Delete key, nudge, rename and duplicate a screen.** Expected in the product?

### Likely bugs: confirm they're bugs, not behavior to specify

1. **Related-asset boxes show the wrong instance.** In Operator Assets, Investigate and Visualization (for an asset), each related box shows the first asset of that type in the model, not the selected asset's real neighbour. Example: WTG-05's gearbox shows WTG-01's drivetrain.
2. **Investigate box title click** silently changes Visualization's saved selection instead of opening the asset.
3. **Tasks created from Investigate** are tagged as AI, inflate the Work count, and can be duplicated.
4. **Grid reset and resize lose merges**, and reset drops existing cells from the grid.
5. **Paste in a manual layout** lands exactly on top of the original.
6. **Deleting the open screen** leaves it on the canvas; the next Save brings it back.
7. **Re-syncing from OpHub clears data-source links**, and auto-linking can never match.
8. **OPC UA write auth "Username/Password"** shows no credential fields.
9. **Visualization:** the visual hint says "Set on this asset only" on type rows; saving an untouched asset's Related Assets tab stops it following its type.
10. **Query instance IDs** can collide between page and app scope once app scope is reachable.

### Repo housekeeping (noticed along the way)

- `TODO.md` doesn't exist, although PROJECT\_CONTEXT.md and the code point to it. If it lived on your laptop, push it: it's input for Pass 1.
- `package-lock.json` is out of sync with `package.json` (a clean install fails); a regular install works.
- `docs/CODE_MAP.html` is stamped at an older commit (b552975).
- Seven dead files plus the root `themeGalleryHtml.js` could be deleted (see Traceability).
- Some labels are misleading in ways Pass 1 should fix rather than copy: "Group by Asset" groups by unit, the task detail zone says "Investigate", "No related alarms on this line" matches by type.

### How this was checked

Every file was read in full by six parallel readers, one per area. The app was then run in a headless browser, and every area was opened in both experiences. Every area matched the code walk. The browser started empty (no saved screens or definitions), so Pass 1 should click through each editor in depth while it writes that area's spec.
