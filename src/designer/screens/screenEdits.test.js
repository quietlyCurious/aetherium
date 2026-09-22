// Tests for the Screens editor's tree edits. Run with:
//   npx react-scripts test --watchAll=false src/designer/screens
import { makeRootContainer, makeContainer, BASE_TIER_ID } from '../../containerModel';
import { findContainerById } from '../../containerTree';
import {
  moveContainerOnCanvas, moveContainerInTree, applyLayoutUpdate, dropIntoGridCell,
  mergeCellContainers, setAspectRatio, updateSlotForTier, applyStyle, pickUpStyle,
  resetPropertiesForParent, makeWidgetContainer, setBinding, clearBinding, setPageContext,
} from './screenEdits';
import { pageContextOf, assetBindingsOf, checkPageBindingsForType } from './screenAsset';
import { loadPackForTests } from '../../model/loadPackForTests';

// root ─ a ─ a1
//      └ b
//      └ w (NumberBox)
function sampleTree() {
  const root = makeRootContainer();
  const a = { ...makeContainer(root.id, 'A'), id: 'a' };
  const a1 = { ...makeContainer('a', 'A1'), id: 'a1' };
  const b = { ...makeContainer(root.id, 'B'), id: 'b' };
  const w = { ...makeWidgetContainer(root.id, 'NumberBox'), id: 'w' };
  return [{ ...root, children: [{ ...a, children: [a1] }, b, w] }];
}
const childIds = (tree, id) => findContainerById(tree, id).children.map(c => c.id);

describe('moving', () => {
  test('dropping onto a container makes it the last child', () => {
    const t = moveContainerOnCanvas(sampleTree(), 'b', 'a', null);
    expect(childIds(t, 'a')).toEqual(['a1', 'b']);
    expect(findContainerById(t, 'b').parentId).toBe('a');
  });

  test('dropping between items inserts before the sibling', () => {
    const t = moveContainerOnCanvas(sampleTree(), 'w', null, 'b');
    expect(childIds(t, 1)).toEqual(['a', 'w', 'b']);
  });

  test('inserting before a sibling inside a locked parent does nothing', () => {
    const tree = sampleTree();
    tree[0].children[0].locked = true; // a
    expect(moveContainerOnCanvas(tree, 'b', null, 'a1')).toBe(tree);
  });

  test('the tree view refuses widgets as targets and the current parent', () => {
    const tree = sampleTree();
    expect(moveContainerInTree(tree, 'b', 'w', null)).toBe(tree);
    expect(moveContainerInTree(tree, 'a1', 'a', null)).toBe(tree);
  });

  test('moving into a coordinate layout resets position but keeps size', () => {
    const tree = sampleTree();
    tree[0].children[0].layout = { ...tree[0].children[0].layout, layoutType: 'coordinate' };
    const b = { ...findContainerById(tree, 'b'), slot: { ...findContainerById(tree, 'b').slot, width: '120px', order: 3 } };
    const moved = resetPropertiesForParent(b, 'a', tree);
    expect(moved.slot.width).toBe('120px');
    expect(moved.slot.order).not.toBe(3);
  });
});

describe('grids', () => {
  test('switching to grid makes one cell container per cell and moves children into the first', () => {
    const t = applyLayoutUpdate(sampleTree(), 'a', { layoutType: 'grid', gridColumns: 2, gridRows: 1 });
    const a = findContainerById(t, 'a');
    expect(a.layout.gridCells).toHaveLength(2);
    expect(a.children).toHaveLength(2);
    expect(a.children[0].children.map(c => c.id)).toEqual(['a1']);
    expect(a.layout.gridCells.map(c => c.childIds[0])).toEqual(a.children.map(c => c.id));
  });

  test('shrinking a grid hands the removed cells to the last remaining cell', () => {
    let t = applyLayoutUpdate(sampleTree(), 'a', { layoutType: 'grid', gridColumns: 3, gridRows: 1 });
    const before = findContainerById(t, 'a').layout.gridCells.map(c => c.childIds[0]);
    t = applyLayoutUpdate(t, 'a', { gridColumns: 2 });
    const cells = findContainerById(t, 'a').layout.gridCells;
    expect(cells).toHaveLength(2);
    expect(cells[1].childIds).toEqual([before[1], before[2]]);
  });

  test('a widget dropped into a cell is listed in that cell', () => {
    let t = applyLayoutUpdate(sampleTree(), 'a', { layoutType: 'grid', gridColumns: 2, gridRows: 1 });
    t = dropIntoGridCell(t, 'a', 1, { widgetName: 'TextBox' });
    const a = findContainerById(t, 'a');
    const added = a.children[a.children.length - 1];
    expect(added.widgetName).toBe('TextBox');
    expect(a.layout.gridCells[1].childIds).toContain(added.id);
  });

  test('merging cells moves the absorbed contents and removes the empty container', () => {
    let t = applyLayoutUpdate(sampleTree(), 'a', { layoutType: 'grid', gridColumns: 2, gridRows: 1 });
    const [first, second] = findContainerById(t, 'a').children.map(c => c.id);
    t = mergeCellContainers(t, second, [first]); // first holds a1
    expect(findContainerById(t, first)).toBeNull();
    expect(childIds(t, second)).toEqual(['a1']);
  });
});

describe('sizing and style', () => {
  test('setting a ratio applies it to the coordinate size straight away', () => {
    const tree = sampleTree();
    tree[0].children[1].coord = { ...tree[0].children[1].coord, width: 320 };
    const b = findContainerById(setAspectRatio(tree, 'b', 16 / 9), 'b');
    expect(b.aspectRatio).toBeCloseTo(16 / 9);
    expect(b.coord.height).toBe(180);
  });

  // Every container carries a default numeric coord.width, so
  // setAspectRatio always takes its coordinate branch: a flex item keeps
  // its px height until its width is next edited.
  test.todo('setting a ratio resizes a flex item (px width) straight away');

  test('with a ratio set, editing a px width sets the height', () => {
    let t = setAspectRatio(sampleTree(), 'b', 16 / 9);
    t = updateSlotForTier(t, 'b', { width: '320px' }, BASE_TIER_ID);
    expect(findContainerById(t, 'b').slot.height).toBe('180px');
  });

  test('slot edits in a breakpoint tier go to that tier, not the base', () => {
    const t = updateSlotForTier(sampleTree(), 'b', { width: '99px' }, 'tablet');
    const b = findContainerById(t, 'b');
    expect(b.breakpointOverrides.tablet.slot.width).toBe('99px');
    expect(b.slot.width).toBe('');
    const base = findContainerById(updateSlotForTier(sampleTree(), 'b', { width: '99px' }, BASE_TIER_ID), 'b');
    expect(base.slot.width).toBe('99px');
  });

  test('the paintbrush copies widget props only onto the same kind of widget', () => {
    const tree = sampleTree();
    const w = findContainerById(tree, 'w');
    const brush = pickUpStyle({ ...w, widgetProps: { ...w.widgetProps, value: 5 }, slot: { ...w.slot, paddingTop: '4px' } });
    const onB = findContainerById(applyStyle(tree, 'b', brush), 'b');
    expect(onB.slot.paddingTop).toBe('4px');
    expect(onB.widgetProps).toBeUndefined();
  });

  test('bindings set and clear per property', () => {
    let t = setBinding(sampleTree(), 'w', 'value', { type: 'expression', expression: '6 * 7' });
    expect(findContainerById(t, 'w').bindings.value.expression).toBe('6 * 7');
    t = clearBinding(t, 'w', 'value');
    expect(findContainerById(t, 'w').bindings).toEqual({});
  });
});

describe('what a page is about', () => {
  beforeAll(() => loadPackForTests('wind'));
  const GEARED = 'TYPE_turbine_wtg_geared';
  const DIRECT = 'TYPE_turbine_wtg_direct_drive';

  test('set, change and clear the context; bindings are left alone', () => {
    let t = setBinding(sampleTree(), 'w', 'value', { type: 'asset', path: ['drivetrain', 'gearbox'], property: 'gearbox_oil_temp_c' });
    expect(pageContextOf(t)).toBeNull();
    t = setPageContext(t, { modelId: 'wind', typeId: GEARED });
    expect(pageContextOf(t)).toEqual({ modelId: 'wind', typeId: GEARED });
    t = setPageContext(t, null);
    expect(pageContextOf(t)).toBeNull();
    expect(assetBindingsOf(t)).toHaveLength(1);
  });

  test('checking the page\'s asset bindings against a type', () => {
    let t = setBinding(sampleTree(), 'w', 'value', { type: 'asset', path: ['drivetrain', 'gearbox'], property: 'gearbox_oil_temp_c' });
    t = setBinding(t, 'w', 'min', { type: 'asset', path: [], property: 'active_power_kw' });
    expect(checkPageBindingsForType(t, GEARED)).toMatchObject({ total: 2, broken: [], partial: [] });
    const onDirect = checkPageBindingsForType(t, DIRECT);
    expect(onDirect.broken.map(b => b.propName)).toEqual(['value']);
    expect(checkPageBindingsForType(t, null).broken).toHaveLength(2);
  });
});
