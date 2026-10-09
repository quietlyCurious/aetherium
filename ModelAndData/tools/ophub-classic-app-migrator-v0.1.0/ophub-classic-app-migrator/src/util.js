// Small shared helpers with no Operations Hub knowledge.

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Random RFC-4122-style v4 id, the form both designers use for component and binding ids. */
export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  orange: '#ffa500', yellow: '#ffff00', gray: '#808080', grey: '#808080', purple: '#800080',
  transparent: 'rgba(0,0,0,0)',
};

/**
 * Convert a classic CSS color string ("#abc", "#aabbcc", "rgb(…)", "rgba(…)", a name)
 * into the {hex, rgb} object the new-designer plugins store. Returns null if unparseable.
 */
export function toPluginColor(css) {
  if (!css || typeof css !== 'string') return null;
  let s = css.trim().toLowerCase();
  if (NAMED_COLORS[s]) s = NAMED_COLORS[s];
  let r, g, b, a = 1;
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) [r, g, b] = m[1].split('').map((x) => parseInt(x + x, 16));
  else if ((m = s.match(/^#([0-9a-f]{6})$/))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const parts = m[1].split(',').map((x) => parseFloat(x));
    [r, g, b] = parts;
    if (parts.length > 3 && !Number.isNaN(parts[3])) a = parts[3];
  } else return null;
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  const hex = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, rgb: { r, g, b, a } };
}

/** Classic alignment strings ("left", "center", "right") to the new text plugin's enum. */
export function toTitleAlignment(classic, fallback = 'Left') {
  const v = String(classic || '').toLowerCase();
  if (v === 'center') return 'Center';
  if (v === 'right') return 'Right';
  if (v === 'left') return 'Left';
  return fallback;
}
