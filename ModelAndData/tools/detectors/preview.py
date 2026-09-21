#!/usr/bin/env python3
"""Render a pack's explanations.json as one standalone HTML page, for
reviewing the content before (or without) the app.

    python3 ModelAndData/tools/detectors/preview.py wind [OUT.html]

Default output: ModelAndData/industries/<model>/explanations_preview.html.
The page embeds the data, so it opens straight from disk.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    model = sys.argv[1]
    data_dir = os.path.join(REPO, 'public', 'data', model)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, 'ModelAndData', 'industries', model,
                                                             'explanations_preview.html')
    load = lambda name: json.load(open(os.path.join(data_dir, name), encoding='utf-8'))
    payload = {
        'explanations': load('explanations.json'),
        'attention': load('attention-items.json'),
        'work': load('work-items.json'),
        'timestamps': load('asset-telemetry.json')['timestamps'],
    }
    html = open(os.path.join(HERE, 'preview_template.html'), encoding='utf-8').read()
    blob = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html.replace('__DATA__', blob))
    print(f'Wrote {os.path.relpath(out, REPO)} ({os.path.getsize(out) // 1024} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
