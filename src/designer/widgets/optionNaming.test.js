import { labelForOption, groupForOption, groupOfDef } from './optionNaming';

test('labels read naturally', () => {
  expect(labelForOption('title.text')).toBe('Title');
  expect(labelForOption('tooltip.enabled')).toBe('Tooltip Enabled');
  expect(labelForOption('scale.tickInterval')).toBe('Tick Interval');
  expect(labelForOption('showBorders')).toBe('Show Borders');
});

test('the group is the first part of the path, General when there is none', () => {
  expect(groupForOption('scale.startValue')).toBe('Scale');
  expect(groupForOption('rangeContainer.width')).toBe('Range Container');
  expect(groupForOption('value')).toBe('General');
});

test("a definition's own group wins over the derived one", () => {
  expect(groupOfDef({ name: 'scale.startValue' })).toBe('Scale');
  expect(groupOfDef({ name: 'scale.startValue', group: 'Range' })).toBe('Range');
});
