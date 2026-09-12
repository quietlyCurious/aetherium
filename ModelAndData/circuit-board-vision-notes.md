# Circuit-board vision — design notes

Working notes for the longer-term direction: showing multiple assets on a
screen (like circuit components) with flow/hierarchy relationships between
them (like wires), auto-laid-out via a graph layout engine and rendered
interactively. Kept here so decisions and deferrals survive between sessions.

## The two paths to a screen

1. **Data-first**: start from an asset (or a set of assets/properties),
   generate the screen from each asset's saved template. Feeds an
   auto-layout engine (dagre/elk) with node dimensions + edges, gets
   positions back.
2. **Visual-first**: blank canvas, place things, map them to assets — the
   existing Aetherium screen-builder area, extended with an asset-bound
   widget type.

Both paths produce the same underlying artifact — a set of
`{ asset, representation, position }` tuples plus edges — they just differ
in how `position` gets filled in (computed vs. dragged). That's why they can
converge into a common editing environment later without being two separate
systems: turning on drag-to-reposition for an auto-generated layout doesn't
require new infrastructure, just interactivity on data that already exists.

Screen persistence is only needed for path 2 — path 1 can stay a pure
function of "asset id in, layout out" for a good while. Path 2 should
reuse the existing screen-builder's save mechanism rather than invent a new
one; the open item there is reconciling widget vocabulary between the two
paths so a generated view can be dropped into manual editing.

## Layout engine choice

React Flow (`@xyflow/react`) for rendering + **Dagre** (`@dagrejs/dagre`) for
layout, to start. Both are MIT, actively maintained, and this is the pairing
React Flow's own docs recommend for tree-shaped graphs. **ELK** (`elkjs`) is
the concrete upgrade path if/when a node's containment box and a flow edge
need to cross that box's boundary at the same time — Dagre has an open,
known limitation there (dagrejs/dagre#238). ELK is ~35x the bundle size and
meaningfully more complex to configure, so it's deliberately not the
starting choice.

## Gap tracker

| # | Gap | Status |
|---|---|---|
| 1 | Flow/relationship data between assets (not just containment) | **In progress — see below** |
| 2 | Per-type saved display template (view mode, flow direction, wrap, distribute/cluster) | Designed, not yet built. Confirmed all four dimensions belong in the template (wrap's omission earlier was unintentional). |
| 3 | Per-property dimensions, toward a node-sizing lookup table | Started — grounded in the actual `StatTile` CSS: Text 120×60, Indicator 60×(not yet fixed), All 128–258×60 depending on sparkline presence, Spark 110–240×(36 or 60). Two known open items: Indicator needs a fixed height; All/Spark aren't single values, they're conditional on whether a sparkline exists. |
| 4 | "Screen" as a persisted entity | Deferred for path 1 (computed on demand). Needed for path 2, via the existing screen-builder's save mechanism — not a new concept. |
| 5 | Space-budgeting algorithm (how many properties fit, given N assets and screen size) | Not started. Agreed to revisit once more of the above is in place, or evaluate an existing package. |

**Deferred decision, explicitly not forgotten**: whether containment itself
(`parentId`) should eventually become just another relationship layer,
rather than a first-class field, if a second competing containment scheme
(e.g., dividing the same assets a different way) ever shows up in real
data. Not needed today — there's exactly one hierarchy in use per model —
revisit only if/when a genuine second one appears.

## Relationship schema

```
{ sourceAssetId, targetAssetId, relationshipType, label, layer }
```

- `sourceAssetId` / `targetAssetId` — real asset ids; direction is implicit
  in source→target, so there's no separate `direction` field. Whether a
  `relationshipType` is inherently directional ("feeds_into") or not
  ("adjacent_to") is a property of the type, not repeated per edge.
- `relationshipType` — the category of relationship (`feeds_into` is the
  only one populated so far).
- `label` — freeform, per-edge, optional (e.g. "return activated sludge").
- `layer` — which relationship *network* this edge belongs to
  (`process_flow`, `chemical_dosing`, `air_flow`, `backwash`). Lets the
  same asset be a node in more than one network at once, and is what would
  eventually drive filtered views (e.g. "show me the air-flow network
  only").

Files: `public/data/{refinery,water,wastewater}/asset-relationships.json`.

## Validated against all three models — findings

- **Refinery** (54 edges): purely sequential station-to-station flow within
  each line — no ambiguity, both refineries (Aurelia, Ferrum) have their
  own fixed station order already in the data.
- **Water** (66 edges): raw-water process flow, a separate chemical-dosing
  sub-flow (coagulant, then chlorine) that *converges* onto the same basins
  the main flow passes through, and backwashing modeled as its own layer
  since it's a periodic, reverse-direction cleaning flow, not part of the
  continuous forward process.
- **Wastewater** (72 edges): same shape as water, plus two things water
  doesn't have — a genuine **cycle** (return activated sludge flows from
  the secondary clarifier back to aeration, an *earlier* stage — verified
  programmatically that water's process-flow graph has no cycle and
  wastewater's does), and an **air-flow layer** (blower → diffuser grid →
  aeration basin) that's a second, different-medium network converging on
  the same basin the wastewater itself flows through.
- **Equipment that gets no edge at all**: mixers (Paddle Mixer), sludge
  collectors, and scum skimmers don't feed a *different* downstream piece
  of equipment — they act on the vessel they're already inside. Their
  relationship to that vessel is already fully described by containment
  (`parentId`); giving them a `feeds_into` edge would manufacture a
  distinction that isn't really there.
- **Multi-layer convergence confirmed programmatically**, not just
  asserted: in water, Rapid Mix Basin, Filter Bed, and Chlorine Contact
  Basin each receive edges from two different layers; in wastewater,
  Aeration Basin and Chlorine Contact Basin do too.

All three files were validated for zero dangling references (every
`sourceAssetId`/`targetAssetId` resolves to a real asset in that model's
hierarchy).
