// ─────────────────────────────────────────────────────────────────────────────
// breakpointConfig.js
// Single source of truth for breakpoints, tiers, and devices.
// To add a new device: add an entry to DEVICES.
// To add a new tier: add an entry to TIERS and add devices that use it.
// ─────────────────────────────────────────────────────────────────────────────

// Tiers define the named breakpoint levels used by the override system.
// At runtime, the correct tier is selected based on screen width.
// Order matters — tiers are checked from smallest to largest.
export const TIERS = [
  {
    id: 'mobile',
    label: 'Mobile',
    icon: '📱',
    maxWidth: 767,       // screens <= 767px use this tier
    color: '#e67e22',
  },
  {
    id: 'tablet',
    label: 'Tablet',
    icon: '📟',
    maxWidth: 1199,      // screens 768–1199px use this tier
    color: '#8e44ad',
  },
  {
    id: 'desktop',
    label: 'Desktop',
    icon: '🖥',
    maxWidth: 1919,      // screens 1200–1919px use this tier
    color: '#2980b9',
  },
  {
    id: 'wide',
    label: 'Wide / 4K',
    icon: '📺',
    maxWidth: Infinity,  // screens >= 1920px use this tier
    color: '#27ae60',
  },
];

// Base / default tier — no overrides stored, always the source of truth
export const BASE_TIER_ID = 'desktop';

// Devices grouped by category.
// width/height: canvas preview dimensions in px (null = user-defined)
// tier: which override tier this device maps to
export const DEVICE_CATEGORIES = [
  {
    id: 'industrial',
    label: 'Industrial / HMI',
    devices: [
      { id: 'fhd',        label: 'Full HD Monitor',       width: 1920, height: 1080, tier: 'wide' },
      { id: '4k',         label: '4K Monitor',            width: 3840, height: 2160, tier: 'wide' },
      { id: 'panel21',    label: '21" Operator Panel',    width: 1920, height: 1080, tier: 'wide' },
      { id: 'panel15',    label: '15" Operator Panel',    width: 1366, height: 768,  tier: 'desktop' },
      { id: 'panel10',    label: '10" Operator Panel',    width: 1280, height: 800,  tier: 'desktop' },
      { id: 'panel7',     label: '7" Handheld Panel',     width: 800,  height: 480,  tier: 'tablet' },
    ],
  },
  {
    id: 'desktop',
    label: 'Desktop / Laptop',
    devices: [
      { id: 'desktop_xl', label: 'Desktop XL (1440)',     width: 1440, height: 900,  tier: 'desktop' },
      { id: 'desktop_md', label: 'Desktop (1280)',        width: 1280, height: 800,  tier: 'desktop' },
      { id: 'laptop_14',  label: 'Laptop 14"',            width: 1366, height: 768,  tier: 'desktop' },
      { id: 'laptop_13',  label: 'MacBook 13"',           width: 1280, height: 832,  tier: 'desktop' },
      { id: 'macbook_pro',label: 'MacBook Pro 16"',       width: 1728, height: 1117, tier: 'desktop' },
    ],
  },
  {
    id: 'tablet',
    label: 'Tablets',
    devices: [
      { id: 'ipad_pro_13',label: 'iPad Pro 12.9"',        width: 1024, height: 1366, tier: 'tablet' },
      { id: 'ipad_pro_11',label: 'iPad Pro 11"',          width: 834,  height: 1194, tier: 'tablet' },
      { id: 'ipad_air',   label: 'iPad Air',              width: 820,  height: 1180, tier: 'tablet' },
      { id: 'ipad_mini',  label: 'iPad Mini',             width: 768,  height: 1024, tier: 'tablet' },
      { id: 'samsung_tab',label: 'Samsung Galaxy Tab S8', width: 753,  height: 1037, tier: 'tablet' },
      { id: 'surface_pro',label: 'Surface Pro 9',         width: 1368, height: 912,  tier: 'desktop' },
    ],
  },
  {
    id: 'mobile',
    label: 'Mobile Phones',
    devices: [
      { id: 'iphone_15_pro',  label: 'iPhone 15 Pro',     width: 393,  height: 852,  tier: 'mobile' },
      { id: 'iphone_14',      label: 'iPhone 14',         width: 390,  height: 844,  tier: 'mobile' },
      { id: 'iphone_se',      label: 'iPhone SE',         width: 375,  height: 667,  tier: 'mobile' },
      { id: 'samsung_s23',    label: 'Samsung Galaxy S23',width: 360,  height: 780,  tier: 'mobile' },
      { id: 'pixel_7',        label: 'Google Pixel 7',    width: 412,  height: 915,  tier: 'mobile' },
    ],
  },
];

// Flat list of all devices for easy lookup
export const ALL_DEVICES = DEVICE_CATEGORIES.flatMap(cat => cat.devices);

// Special non-device entries shown at the top of the picker
export const SPECIAL_PRESETS = [
  { id: 'responsive', label: 'Responsive',  width: null, height: null, tier: null, special: true },
  { id: 'custom',     label: 'Custom...',   width: null, height: null, tier: null, special: true },
];

// Find tier for a given screen width
export function getTierForWidth(width) {
  for (const tier of TIERS) {
    if (width <= tier.maxWidth) return tier;
  }
  return TIERS[TIERS.length - 1];
}

// Get a tier by ID
export function getTierById(id) {
  return TIERS.find(t => t.id === id) || null;
}

// Get a device by ID
export function getDeviceById(id) {
  return ALL_DEVICES.find(d => d.id === id) || SPECIAL_PRESETS.find(d => d.id === id) || null;
}

// Merge base container props with breakpoint overrides for a given tier
export function applyBreakpointOverrides(container, tierId) {
  if (!tierId || tierId === BASE_TIER_ID) return container;
  const overrides = container.breakpointOverrides?.[tierId];
  if (!overrides) return container;
  return {
    ...container,
    slot: overrides.slot ? { ...container.slot, ...overrides.slot } : container.slot,
    layout: overrides.layout ? { ...container.layout, ...overrides.layout } : container.layout,
    coord: overrides.coord ? { ...container.coord, ...overrides.coord } : container.coord,
    widgetProps: overrides.widgetProps ? { ...container.widgetProps, ...overrides.widgetProps } : container.widgetProps,
    hidden: overrides.hidden ?? container.hidden ?? false,
  };
}
