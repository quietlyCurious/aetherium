// designer/screens/ScreenView.jsx
// A saved screen, rendered read-only. The one component anything should
// use to show a screen outside the editor: the Launch runtime view today,
// and the obvious building block for showing a screen as an asset's
// visualization later.
//
// It renders through ContainerCard — the same component the editor canvas
// uses — so a screen looks identical wherever it appears. ContainerCard is
// an editor component with a long list of editing callbacks; every one of
// them is a no-op here (nothing in a read-only view selects, drags or
// resizes), and ScreenView is what keeps that list out of every host.
//
// Pass the page's `containers` and the data its bindings read — typically
// straight from usePageQueryResults. Without `queryResults`, query-bound
// properties keep their static values, the way the canvas shows them at
// design time. `assetId` is the asset a screen about a type shows (its
// "self"); its asset bindings resolve against it. `property` —
// { propertyKey, value? } — is set for a screen about a property
// (screenProperty.jsx): the property of `assetId` it shows.

import ContainerCard from '../../ContainerCard';
import { BASE_TIER_ID } from '../../containerModel';
import { ScreenAssetProvider } from './screenAsset';
import { ScreenPropertyProvider } from './screenProperty';
import { registerScreenRenderer } from './screenRenderer';

const NOOP = () => {};

export function ScreenView({ containers, queryResults = null, queries = null, assetId = null, property = null }) {
  return (
    <ScreenAssetProvider assetId={assetId}>
      <ScreenPropertyProvider assetId={assetId} propertyKey={property?.propertyKey} value={property?.value}>
        {(containers || []).map(c => (
          <ContainerCard
            key={c.id}
            container={c}
            containers={containers}
            selectedIds={[]}
            onSelect={NOOP}
            onDelete={NOOP}
            onDragStart={NOOP}
            onDragOver={NOOP}
            onDrop={NOOP}
            onWidgetDrop={NOOP}
            onUpdateLayout={NOOP}
            onUpdateSlot={NOOP}
            onUpdateCoord={NOOP}
            onGridCellDrop={NOOP}
            onSetSelectedGridCell={NOOP}
            onMergeCellContainers={NOOP}
            selectedGridCell={null}
            dragState={{}}
            draggingId={null}
            isDragging={false}
            coordMode="reposition"
            activeTierId={BASE_TIER_ID}
            snapEnabled={false}
            queryResults={queryResults}
            queries={queries}
            interactive={false}
          />
        ))}
      </ScreenPropertyProvider>
    </ScreenAssetProvider>
  );
}

// Repeaters and property tiles draw screens inside other screens; this is
// what they draw them with. Registered rather than imported — see
// screenRenderer.js.
registerScreenRenderer(ScreenView);
