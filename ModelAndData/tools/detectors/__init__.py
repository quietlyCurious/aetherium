"""Detector toolkit shared by every industry pack's explain.py.

- pack.py   — read-only access to a pack's runtime files
- blocks.py — signal building blocks (expected-value models, residuals,
              trends, persistence, peer ranges, episodes)
- build.py  — explanation/chart/check builders, the Detector base class
              and the runner that writes public/data/<model>/explanations.json

See INDUSTRY_PACK_SPEC.md §14.
"""
