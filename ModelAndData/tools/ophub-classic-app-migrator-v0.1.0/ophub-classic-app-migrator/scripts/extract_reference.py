"""Build src/reference/reference.json from sample Operations Hub packages.

Pulls three things out of real exports so the converter never hand-invents them:
  1. Structural templates for a new-designer page (root container, grid, flex card).
  2. The UISchema decorations the new designer injects into every plugin's pluginInfo.
  3. manifest.json for every plugin a classic native widget can be mapped onto.

Usage: python3 -I extract_reference.py <ModelAndData dir> <out json>
"""
import copy
import glob
import json
import os
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT, OUT = sys.argv[1], sys.argv[2]
NEW = os.path.join(ROOT, 'OH_Apps_NewDesigner')
OLD = os.path.join(ROOT, 'OH_Apps_OldDesigner')

# Plugins that classic native widgets are mapped onto (typeName as used in pages).
MAPPED_TARGETS = ['text', 'image', 'button', 'textbox', 'GEDropdown', 'DataGrid',
                  'chartLine', 'chartPie', 'gaugeLinear', 'GEHtmlEditor']


def pages(xml_path):
    root = ET.parse(xml_path).getroot()
    for p in root.findall('Pages/Page'):
        yield json.loads(p.findtext('components') or '[]')


def manifests():
    found = {}
    for z in sorted(glob.glob(os.path.join(NEW, '*', 'plugins', '*.zip'))) + \
            sorted(glob.glob(os.path.join(OLD, '*', 'plugins', '*.zip'))):
        try:
            zf = zipfile.ZipFile(z)
        except zipfile.BadZipFile:
            continue
        names = [n for n in zf.namelist() if n.lower().endswith('manifest.json') and n.count('/') <= 1]
        if not names:
            continue
        m = json.loads(zf.read(names[0]).decode('utf-8-sig'))
        tn = m.get('typeName')
        if tn in MAPPED_TARGETS and tn not in found:  # new-designer copies win (listed first)
            found[tn] = m
    missing = set(MAPPED_TARGETS) - set(found)
    if missing:
        sys.exit(f'missing manifests for {sorted(missing)}')
    return found


def templates():
    xml = glob.glob(os.path.join(NEW, '_Discrete+Industry+Demo+2025*', '*.xml'))[0]
    root_tpl = grid_tpl = card_tpl = ui_aug = None
    for comps in pages(xml):
        root = comps[0]
        grid = root['components'][0]
        for card in grid['components']:
            if card['type'] == 'flex_container' and card_tpl is None:
                card_tpl = copy.deepcopy(card)
            for w in card['components']:
                if w.get('typeName') == 'GEIFrame' and ui_aug is None:
                    ui = w['pluginInfo']['schema']['UISchema']
                    ui_aug = {k: ui[k] for k in ('conditions', 'responsiveStyle', 'widget', 'ui:order')}
        if root_tpl is None:
            root_tpl, grid_tpl = copy.deepcopy(root), copy.deepcopy(grid)
    # Strip content; the converter fills these.
    root_tpl['components'] = []
    grid_tpl['components'] = []
    card_tpl['components'] = []
    for k in ('id',):
        root_tpl.pop(k, None); card_tpl.pop(k, None)
    return {'rootContainer': root_tpl, 'gridContainer': grid_tpl, 'flexCard': card_tpl,
            'pluginUiSchemaAugment': ui_aug}


ref = templates()
ref['manifests'] = manifests()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(ref, f, indent=1)
print(OUT, os.path.getsize(OUT), 'bytes;', 'manifests:', sorted(ref['manifests']))
