// operator/configurator/OperatorFitCheck.test.js
//   npx react-scripts test --watchAll=false src/operator/configurator

import { OPERATOR_RELATED_ASSETS_CHROME, describeOperatorFit, fitCheckDisplays, operatorAreaFor } from './OperatorFitCheck';

test('displays: desktop-sized previews only, Full HD among them', () => {
  const displays = fitCheckDisplays();
  expect(displays.find(d => d.id === 'fhd')).toMatchObject({ width: 1920, height: 1080 });
  expect(displays.every(d => d.width >= 1024)).toBe(true);
});

test('the Operator area is the display minus the panels around it', () => {
  expect(operatorAreaFor({ width: 1920, height: 1080 })).toEqual({
    w: 1920 - OPERATOR_RELATED_ASSETS_CHROME.w,
    h: 1080 - OPERATOR_RELATED_ASSETS_CHROME.h,
  });
});

test('badge wording', () => {
  const fhd = { label: 'Full HD Monitor', width: 1920, height: 1080 };
  expect(describeOperatorFit({ fits: true, zoom: 1 }, fhd).tone).toBe('ok');
  expect(describeOperatorFit({ fits: false, zoom: 0.724 }, fhd).text).toMatch(/72%/);
  expect(describeOperatorFit(null, fhd).tone).toBe('pending');
});
