// operator/configurator/OperatorFitCheck.test.js
//   npx react-scripts test --watchAll=false src/operator/configurator

import { OPERATOR_VIEWS, describeOperatorFit, fitCheckDisplays, operatorAreaFor } from './OperatorFitCheck';

test('displays: desktop-sized previews only, Full HD among them', () => {
  const displays = fitCheckDisplays();
  expect(displays.find(d => d.id === 'fhd')).toMatchObject({ width: 1920, height: 1080 });
  expect(displays.every(d => d.width >= 1024)).toBe(true);
});

test('each Operator view is the display minus the panels around that view', () => {
  Object.entries(OPERATOR_VIEWS).forEach(([view, { chrome }]) => {
    expect(operatorAreaFor({ width: 1920, height: 1080 }, view)).toEqual({ w: 1920 - chrome.w, h: 1080 - chrome.h });
  });
  // Related Assets' viewport sits 14px lower in the same panel.
  expect(OPERATOR_VIEWS.properties.chrome.h).toBeLessThan(OPERATOR_VIEWS.relatedAssets.chrome.h);
});

test('badge wording', () => {
  const fhd = { label: 'Full HD Monitor', width: 1920, height: 1080 };
  expect(describeOperatorFit({ fits: true, zoom: 1 }, fhd).tone).toBe('ok');
  expect(describeOperatorFit({ fits: false, zoom: 0.724 }, fhd).text).toMatch(/72%/);
  expect(describeOperatorFit(null, fhd).tone).toBe('pending');
  // A layout with no fit check (React Flow) just offers / shows the preview.
  expect(describeOperatorFit(null, fhd, { checkable: false })).toEqual({ tone: 'neutral', text: '▭ Preview on a display' });
  expect(describeOperatorFit(null, fhd, { checkable: false, showing: true }).text).toMatch(/Operator view · Full HD Monitor 1920×1080/);
});
