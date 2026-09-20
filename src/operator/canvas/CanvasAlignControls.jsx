// operator/canvas/CanvasAlignControls.jsx
// The align / distribute (/ arrange in grid) button groups every manual
// layout mode puts in its toolbar. They all do the same thing — call
// align(mode), distribute(axis) or arrangeGrid() on whichever canvas is
// below — so they take the canvas's imperative ref and nothing else.
//
// Four toolbars use this: property tiles, related-asset cards, the
// related-assets diagram and the All Assets diagram. The diagrams have no
// Arrange in Grid (an auto layout is what that would compete with), hence
// the flag.

import ButtonGroup, { Item as ButtonGroupItem } from 'devextreme-react/button-group';
import Button from 'devextreme-react/button';
import { IconButtonGroupItem } from '../icons';
import { RELATED_ASSETS_ALIGN_VERTICAL_ITEMS, RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS, RELATED_ASSETS_DISTRIBUTE_ITEMS } from '../settings/layoutOptions';

export function CanvasAlignControls({ canvasRef, withArrangeGrid }) {
  return (
    <>
      <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => canvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
        {RELATED_ASSETS_ALIGN_VERTICAL_ITEMS.map(item => (
          <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
        ))}
      </ButtonGroup>
      <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => canvasRef.current?.align(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
        {RELATED_ASSETS_ALIGN_HORIZONTAL_ITEMS.map(item => (
          <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
        ))}
      </ButtonGroup>
      <ButtonGroup keyExpr="value" selectedItemKeys={[]} onItemClick={e => canvasRef.current?.distribute(e.itemData.value)} stylingMode="outlined" className="op-dash-chart-toggle">
        {RELATED_ASSETS_DISTRIBUTE_ITEMS.map(item => (
          <ButtonGroupItem key={item.value} text={item.text} value={item.value} hint={item.text} render={() => <IconButtonGroupItem {...item} />} />
        ))}
      </ButtonGroup>
      {withArrangeGrid && <Button text="Arrange in Grid" onClick={() => canvasRef.current?.arrangeGrid()} stylingMode="outlined" />}
    </>
  );
}
