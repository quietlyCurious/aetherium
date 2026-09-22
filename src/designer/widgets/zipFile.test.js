import { TextEncoder } from 'util';
import { buildZip, crc32 } from './zipFile';

// jsdom has no TextEncoder; the browser does.
global.TextEncoder = TextEncoder;

test('crc32 matches the reference value', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

test('zip has local header, central directory and end record', () => {
  const zip = buildZip([{ name: 'a.txt', content: 'hello' }]);
  const view = new DataView(zip.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
});
