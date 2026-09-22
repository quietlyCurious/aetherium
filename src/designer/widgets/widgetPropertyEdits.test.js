import { exposeOption, hideOption, updateDef, setDefField, coerceDefault, changeDefType, setDefChoices, parseChoices } from './widgetPropertyEdits';

const base = [{ name: 'value', label: 'Value', type: 'number', default: 0 }];

test('exposing adds to the end and never twice', () => {
  const def = { name: 'title.text', label: 'Title', type: 'string', default: '' };
  expect(exposeOption(base, def).map(d => d.name)).toEqual(['value', 'title.text']);
  expect(exposeOption(exposeOption(base, def), def)).toHaveLength(2);
});

test('hiding removes just that one', () => {
  expect(hideOption(base, 'value')).toEqual([]);
  expect(hideOption(base, 'nope')).toEqual(base);
});

test('updateDef touches one definition', () => {
  expect(updateDef(base, 'value', d => ({ ...d, label: 'Reading' }))[0].label).toBe('Reading');
});

test('an empty field value removes the key', () => {
  expect(setDefField(base[0], 'group', 'Scale').group).toBe('Scale');
  expect('group' in setDefField({ ...base[0], group: 'Scale' }, 'group', '')).toBe(false);
  expect('bindable' in setDefField(base[0], 'bindable', undefined)).toBe(false);
  expect(setDefField(base[0], 'bindable', false).bindable).toBe(false);
});

test('defaults survive a type change where they can', () => {
  expect(coerceDefault('12', 'number')).toBe(12);
  expect(coerceDefault('nope', 'number')).toBe(0);
  expect(coerceDefault(5, 'string')).toBe('5');
  expect(coerceDefault('true', 'bool')).toBe(true);
  expect(coerceDefault('a', 'enum', ['a', 'b'])).toBe('a');
  expect(coerceDefault('z', 'enum', ['a', 'b'])).toBe('a');
});

test('changing type adds or drops choices', () => {
  const toEnum = changeDefType({ name: 'x', label: 'X', type: 'string', default: 'outside' }, 'enum');
  expect(toEnum).toMatchObject({ type: 'enum', options: ['outside'], default: 'outside' });
  const back = changeDefType(toEnum, 'string');
  expect('options' in back).toBe(false);
  expect(back.default).toBe('outside');
  expect(changeDefType({ name: 'x', label: 'X', type: 'string' }, 'enum').default).toBeUndefined();
});

test('setting choices keeps a default that is still one of them', () => {
  const def = { name: 'x', label: 'X', type: 'enum', options: ['a', 'b'], default: 'b' };
  expect(setDefChoices(def, ['a', 'b', 'c']).default).toBe('b');
  expect(setDefChoices(def, ['c', 'd']).default).toBe('c');
  expect(parseChoices(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
});

test('a json default only survives as a value, never as text', () => {
  expect(coerceDefault([{ a: 1 }], 'json')).toEqual([{ a: 1 }]);
  expect(coerceDefault('[1]', 'json')).toBeUndefined();
  expect(coerceDefault(undefined, 'json')).toBeUndefined();
});

test('changing to json drops a default that is not one', () => {
  expect('default' in changeDefType({ name: 'x', label: 'X', type: 'string', default: '' }, 'json')).toBe(false);
  expect(changeDefType({ name: 'x', label: 'X', type: 'json', default: [1] }, 'string').default).toBe('');
});
