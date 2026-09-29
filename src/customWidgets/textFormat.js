// customWidgets/textFormat.js
// What the Text widget shows, as a string: its value (often bound, often a
// number), rounded if asked, with an optional prefix and suffix. Kept
// separate from the component so it can be tested without a DOM.

// `decimals`: 'auto' leaves a number as it is; '0'–'4' rounds to that many
// places. Stored as a string because the details panel offers it as a
// choice ("auto" has to sit alongside the numbers).
export const DECIMALS_CHOICES = ['auto', '0', '1', '2', '3', '4'];

export function formatTextValue(value, { decimals = 'auto', prefix = '', suffix = '' } = {}) {
  if (value === null || value === undefined || value === '') return '';
  let text;
  const places = decimals === 'auto' || decimals === '' || decimals == null ? null : Number(decimals);
  const asNumber = typeof value === 'number' ? value
    : (places != null && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) ? Number(value)
    : null;
  if (asNumber != null && places != null && Number.isFinite(asNumber)) text = asNumber.toFixed(places);
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return `${prefix || ''}${text}${suffix || ''}`;
}
