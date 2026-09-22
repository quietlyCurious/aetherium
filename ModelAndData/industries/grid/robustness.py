#!/usr/bin/env python3
"""Robustness check for the grid detectors: do they still find each scenario,
and only that scenario, when the data is regenerated with different noise?

The detectors were written against the committed pack (seed 20260828). This
reruns generate.py with other seeds into a temporary folder, runs every
detector on each copy (nothing is written to public/data/), and counts:

  found    — a detector fired on the attention item's asset
  missed   — none did
  extra    — a detector fired on an asset no attention item covers

    python3 ModelAndData/industries/grid/robustness.py [N_SEEDS]

grid's generate.py always writes to <repo>/public/data/grid/, so the copy run
here has two lines substituted: its SEED, and its output folder (pointed at
the temporary folder). generate.py itself is never modified.

A detector that only works on the one committed dataset has learned the
generator's noise, not the failure. Standard library only.
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('grid_explain', os.path.join(HERE, 'explain.py'))
W = importlib.util.module_from_spec(spec)
spec.loader.exec_module(W)
from detectors.build import run_pack                   # noqa: E402  (path set up by explain.py)

BASE_SEED = 20260828
OUT_LINE = "out = os.path.join(repo, 'public', 'data', 'grid')"


def generate(seed, out_dir):
    src = open(os.path.join(HERE, 'generate.py'), encoding='utf-8').read()
    for old in (f'SEED = {BASE_SEED}', OUT_LINE):
        if src.count(old) != 1:
            sys.exit(f'robustness.py: expected exactly one "{old}" in generate.py; update this script')
    src = src.replace(f'SEED = {BASE_SEED}', f'SEED = {seed}', 1)
    src = src.replace(OUT_LINE, f'out = {out_dir!r}', 1)
    script = os.path.join(out_dir, 'generate_seed.py')
    with open(script, 'w', encoding='utf-8') as f:
        f.write(src)
    subprocess.run([sys.executable, script, '--repo', W.REPO], check=True, stdout=subprocess.DEVNULL)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    found, missed, extra = Counter(), Counter(), Counter()
    miss_seeds = defaultdict(list)
    at = defaultdict(list)
    levels = defaultdict(Counter)
    with tempfile.TemporaryDirectory() as tmp:
        for s in range(1, n + 1):
            seed = BASE_SEED + 1000 * s
            d = os.path.join(tmp, str(seed))
            os.makedirs(d)
            generate(seed, d)
            pack, out, report, _ = run_pack(W.REPO, 'grid', W.DETECTORS, pack_dir=d, write=False)
            for item in pack.attention:
                if item['id'] in out['items']:
                    found[item['id']] += 1
                    at[item['id']].append(out['items'][item['id']]['detectedAt'])
                    levels[item['id']][out['items'][item['id']]['confidence']['level']] += 1
                else:
                    missed[item['id']] += 1
                    miss_seeds[item['id']].append(seed)
            for w in report['warnings']:
                if 'no attention item covers it' in w:
                    extra[w.split(' fired on ')[0] + ' on ' + w.split(' fired on ')[1].split(' at ')[0]] += 1
            print(f'seed {seed}: {len(out["items"])}/{len(pack.attention)} explained, '
                  f'{sum(1 for w in report["warnings"] if "no attention item" in w)} extra')
    print()
    print(f'Across {n} regenerated datasets:')
    for iid in sorted(set(found) | set(missed)):
        line = f'  {iid}: found {found[iid]}/{n}'
        if at[iid]:
            line += f'   raised {min(at[iid])}–{max(at[iid])}   confidence ' + \
                    ', '.join(f'{k} ×{v}' for k, v in sorted(levels[iid].items()))
        if missed[iid]:
            line += f'   missed on seeds {miss_seeds[iid]}'
        print(line)
    if extra:
        print('Extra detections (no attention item):')
        for k, v in extra.most_common():
            print(f'  {k}: {v}/{n}')
    else:
        print('No extra detections.')


if __name__ == '__main__':
    main()
